import { useState, useEffect } from 'react'
import type { PolyEvent, TraderRankEntry } from '../types'
import { rankTradersForEvents, enrichWithPnL } from '../api/traders'
import { formatUSD } from '../api/polymarket'
import { truncateAddress } from '../api/wallets'

interface Props {
  events: PolyEvent[]
  categoryLabel: string
  onSelectWallet: (address: string) => void
  autoLoad?: boolean  // if true, triggers load on mount without button click
}

function confidenceBadge(timingScore: number, resolved: number): { cls: string; label: string } {
  if (resolved < 3) return { cls: 'badge-red', label: 'Low data' }
  const pct = timingScore * 100
  if (pct >= 60) return { cls: 'badge-green', label: 'High' }
  if (pct >= 45) return { cls: 'badge-yellow', label: 'Medium' }
  return { cls: 'badge-orange', label: 'Low' }
}

function TraderCard({ entry, rank, onSelect }: {
  entry: TraderRankEntry
  rank: number
  onSelect: () => void
}) {
  const display = entry.pseudonym || entry.name || truncateAddress(entry.address)
  const timingPct = (entry.timingScore * 100).toFixed(0)
  const conf = confidenceBadge(entry.timingScore, entry.totalResolved)
  const edgeScore = Math.round(entry.timingScore * 100)

  return (
    <div className="trader-card">
      <div className="trader-card-rank">#{rank}</div>
      <div className="trader-card-body">
        <div className="trader-card-top">
          <span className="trader-card-name">{display}</span>
          <div className="trader-card-badges">
            <span className={`confidence-badge ${conf.cls}`}>
              Confidence: {conf.label}
            </span>
            {entry.totalResolved >= 3 && (
              <span className="confidence-badge badge-green" style={{ background: 'none', border: '1px solid var(--border)' }}>
                Edge {edgeScore}/100
              </span>
            )}
          </div>
        </div>

        <div className="trader-card-meta">
          <span className="stat vol">{formatUSD(entry.totalVolumeUSDC)} vol</span>
          <span className="stat date">{entry.tradeCount} trades</span>
          <span className="stat date">{entry.marketsTraded} markets</span>
          {entry.winRate !== null && (
            <span className={`stat ${entry.winRate >= 0.5 ? '' : 'pnl-neg'}`}>
              {(entry.winRate * 100).toFixed(0)}% win rate
            </span>
          )}
          {entry.pnl !== null && (
            <span className={`stat ${entry.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
              {entry.pnl >= 0 ? '+' : ''}{formatUSD(entry.pnl)} PnL
            </span>
          )}
          {entry.pnl === null && entry.winRate === null && (
            <span className="stat date estimate-label">PnL fetching…</span>
          )}
        </div>

        {entry.totalResolved >= 3 && (
          <div className="timing-bar-wrap">
            <div className="timing-bar-track">
              <div
                className="timing-bar-fill"
                style={{
                  width: `${timingPct}%`,
                  background: Number(timingPct) >= 55 ? '#22c55e' : '#f59e0b',
                }}
              />
            </div>
            <span className="timing-bar-label">
              {entry.positiveDelta}/{entry.totalResolved} trades where price moved in their direction
            </span>
          </div>
        )}

        <div className="trader-card-actions">
          <button
            className="search-btn"
            style={{ fontSize: '0.8rem', padding: '5px 14px' }}
            onClick={onSelect}
          >
            View Full Profile →
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TraderRanking({ events, categoryLabel, onSelectWallet, autoLoad }: Props) {
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

  // Reset when events change
  useEffect(() => {
    setLoaded(false)
    setTraders([])
    setError(null)
  }, [events.map(e => e.id).join(',')])

  // Auto-load if prop set
  useEffect(() => {
    if (autoLoad && !loaded && !loading) load()
  }, [autoLoad, events.map(e => e.id).join(',')])

  if (!loaded && !loading && !autoLoad) {
    return (
      <div className="trader-ranking-panel">
        <h3 className="markets-list-title">Top {categoryLabel} Traders</h3>
        <p className="score-disclaimer" style={{ marginBottom: 12 }}>
          Ranked by volume + entry timing edge. Timing score = % trades where price moved
          in their direction after entry.
        </p>
        <button className="search-btn" onClick={load}>Load Top Traders</button>
        {error && <p className="error-msg" style={{ marginTop: 10 }}>{error}</p>}
      </div>
    )
  }

  return (
    <div className="trader-ranking-panel">
      <div className="ranking-header">
        <h3 className="markets-list-title">Top {categoryLabel} Traders</h3>
        {(loading || enriching) && (
          <span className="score-loading-badge">
            {loading ? 'Analyzing traders…' : 'Fetching PnL data…'}
          </span>
        )}
      </div>

      {!loading && loaded && (
        <div className="data-source-label" style={{ marginBottom: 12 }}>
          {traders.length} unique wallets · ranked by volume + entry timing ·
          live CLOB prices (real) · PnL from positions API
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}
      {loaded && traders.length === 0 && <p className="empty-msg">No traders found for these markets.</p>}

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
