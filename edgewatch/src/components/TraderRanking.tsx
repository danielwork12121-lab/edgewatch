import { useState, useEffect } from 'react'
import type { PolyEvent, TraderRankEntry } from '../types'
import { rankTradersForEvents, enrichWithPnL } from '../api/traders'
import { formatUSD } from '../api/polymarket'
import { truncateAddress } from '../api/wallets'

interface Props {
  events: PolyEvent[]
  categoryLabel: string
  onSelectWallet: (address: string) => void
}

function TraderCard({ entry, rank, onSelect }: {
  entry: TraderRankEntry
  rank: number
  onSelect: () => void
}) {
  const display = entry.pseudonym || entry.name || truncateAddress(entry.address)
  const timingPct = (entry.timingScore * 100).toFixed(0)
  const hasTimingData = entry.totalResolved >= 3

  return (
    <div className="trader-card">
      <div className="trader-card-rank">#{rank}</div>
      <div className="trader-card-body">
        <div className="trader-card-top">
          <span className="trader-card-name">{display}</span>
          <div className="trader-card-badges">
            {hasTimingData && (
              <span className={`confidence-badge ${Number(timingPct) >= 60 ? 'badge-green' : Number(timingPct) >= 45 ? 'badge-yellow' : 'badge-orange'}`}>
                {timingPct}% edge
              </span>
            )}
          </div>
        </div>
        <div className="trader-card-meta">
          <span className="stat vol">{formatUSD(entry.totalVolumeUSDC)} vol</span>
          <span className="stat date">{entry.tradeCount} trades</span>
          <span className="stat date">{entry.marketsTraded} markets</span>
          {entry.pnl !== null && (
            <span className={`stat ${entry.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
              {entry.pnl >= 0 ? '+' : ''}{formatUSD(entry.pnl)} PnL
            </span>
          )}
          {entry.winRate !== null && (
            <span className="stat date">{(entry.winRate * 100).toFixed(0)}% win rate</span>
          )}
        </div>
        {hasTimingData && (
          <div className="timing-bar-wrap">
            <div className="timing-bar-track">
              <div
                className="timing-bar-fill"
                style={{ width: `${timingPct}%`, background: Number(timingPct) >= 55 ? '#22c55e' : '#f59e0b' }}
              />
            </div>
            <span className="timing-bar-label">
              {entry.positiveDelta}/{entry.totalResolved} favorable entries
            </span>
          </div>
        )}
        <div className="trader-card-actions">
          <button className="search-btn" style={{ fontSize: '0.8rem', padding: '5px 14px' }} onClick={onSelect}>
            View Profile →
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TraderRanking({ events, categoryLabel, onSelectWallet }: Props) {
  const [traders, setTraders] = useState<TraderRankEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const ranked = await rankTradersForEvents(events)
      setTraders(ranked)
      setLoaded(true)
      // Enrich top 5 with PnL in background
      if (ranked.length > 0) {
        setEnriching(true)
        enrichWithPnL(ranked, 5)
          .then(setTraders)
          .finally(() => setEnriching(false))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load traders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoaded(false)
    setTraders([])
  }, [events.map(e => e.id).join(',')])

  if (!loaded) {
    return (
      <div className="trader-ranking-panel">
        <div className="ranking-header">
          <h3 className="markets-list-title">Top {categoryLabel} Traders</h3>
          <p className="score-disclaimer" style={{ marginBottom: 12 }}>
            Ranked by volume and entry edge across top markets in this category.
            Timing score = % of trades where price moved in their direction.
          </p>
          <button className="search-btn" onClick={load} disabled={loading}>
            {loading ? 'Analyzing traders…' : 'Load Top Traders'}
          </button>
          {error && <p className="error-msg" style={{ marginTop: 10 }}>{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="trader-ranking-panel">
      <div className="ranking-header">
        <h3 className="markets-list-title">Top {categoryLabel} Traders</h3>
        {enriching && (
          <span className="score-loading-badge">Fetching PnL data…</span>
        )}
      </div>
      <div className="data-source-label">
        {traders.length} unique wallets from recent trades in top {Math.min(4, events.length)} markets ·
        Timing scores from live CLOB prices (real)
      </div>
      {traders.length === 0 && <p className="empty-msg">No traders found for these markets.</p>}
      {traders.map((t, i) => (
        <TraderCard
          key={t.address}
          entry={t}
          rank={i + 1}
          onSelect={() => onSelectWallet(t.address)}
        />
      ))}
    </div>
  )
}
