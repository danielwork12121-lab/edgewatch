import { useEffect, useState } from 'react'
import { fetchReliableCopyCandidates, type HotTraderEntry, type HotTraderLoadResult } from '../api/traders'
import { formatUSD } from '../api/polymarket'
import { truncateAddress } from '../api/wallets'
import { cacheTime, formatAge } from '../api/cache'

interface Props {
  onSelectWallet: (address: string) => void
}

const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug('[EdgeWatch][reliable-traders]', ...args)
}

function ReliableTraderCard({ trader, rank, onSelectWallet }: { trader: HotTraderEntry; rank: number; onSelectWallet: (address: string) => void }) {
  const reliabilityBadge =
    trader.reliabilityScore >= 75 ? 'badge-green' :
    trader.reliabilityScore >= 50 ? 'badge-yellow' : 'badge-orange'

  return (
    <div className="trader-card hot-trader-card">
      <div className="trader-card-rank">#{rank}</div>
      <div className="trader-card-body">
        <div className="trader-card-top">
          <div>
            <span className="trader-card-name">{trader.label || truncateAddress(trader.address)}</span>
            <div className="estimate-label">{truncateAddress(trader.address)}</div>
          </div>
          <div className="trader-card-badges">
            <span className={`confidence-badge ${reliabilityBadge}`}>Reliability {Math.round(trader.reliabilityScore)}/100</span>
            <span className={`confidence-badge ${trader.copySignal === 'COPY' ? 'badge-green' : trader.copySignal === 'WATCH' ? 'badge-yellow' : 'badge-red'}`}>
              {trader.copySignal}
            </span>
            <span className={`confidence-badge ${trader.confidence === 'High' ? 'badge-green' : trader.confidence === 'Medium' ? 'badge-yellow' : 'badge-orange'}`}>
              {trader.confidence} confidence
            </span>
          </div>
        </div>

        <div className="trader-card-meta">
          <span className="stat date">{trader.reliabilityLabel}</span>
          <span className="stat vol">Vol {formatUSD(trader.recentVolumeUSDC)}</span>
          <span className="stat date">{trader.recentTradeCount} trades</span>
          <span className="stat date">{trader.marketsTraded} markets</span>
          <span className="stat date">Streak {trader.currentLosingStreak > 0 ? `Losing ${trader.currentLosingStreak}` : 'Even'}</span>
          <span className="stat date">Worst loss streak {trader.worstLosingStreak}</span>
          {trader.winRate !== null && (
            <span className="stat date">{(trader.winRate * 100).toFixed(0)}% win rate</span>
          )}
          {trader.realizedPnl !== null && (
            <span className={`stat ${trader.realizedPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
              {trader.realizedPnl >= 0 ? '+' : ''}{formatUSD(trader.realizedPnl)} realized
            </span>
          )}
        </div>

        <div className="hot-trader-markets">
          {trader.activeMarkets.slice(0, 3).map(market => (
            <span key={market} className="hot-trader-market">
              {market}
            </span>
          ))}
        </div>

        <ul className="hot-trader-reasons">
          {trader.reliabilityReasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>

        <div className="trader-card-actions">
          <button type="button" className="search-btn" style={{ fontSize: '0.8rem', padding: '5px 14px' }} onClick={() => onSelectWallet(trader.address)}>
            View Trader →
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ReliableCandidatesFeed({ onSelectWallet }: Props) {
  const [traders, setTraders] = useState<HotTraderEntry[]>([])
  const [feedResult, setFeedResult] = useState<HotTraderLoadResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      fetchReliableCopyCandidates(8)
        .then(result => {
          if (cancelled) return
          setFeedResult(result)
          setTraders(result.traders)
          setLastUpdated(Date.now())
          devLog('reliable candidates loaded', {
            state: result.state,
            message: result.message,
            rawCount: result.diagnostics.rawTradeCount,
            normalizedCount: result.diagnostics.normalizedTradeCount,
            walletGroups: result.diagnostics.walletGroupCount,
            finalCount: result.diagnostics.finalHotTraderCount,
            titles: result.traders.slice(0, 5).map(trader => trader.label),
          })
          if (result.state === 'error') setError('Could not load reliable candidates')
        })
        .catch(err => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : 'Could not load reliable candidates')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <section className="homepage-section hot-traders-section">
      <div className="section-heading">
        <div>
          <h2 className="section-title">Reliable Copy Candidates</h2>
          <p className="section-subtitle">
            Wallets with enough history to evaluate for copying. Weak history stays out.
          </p>
        </div>
        <div className="refresh-bar">
          {lastUpdated && <span className="last-updated">{formatAge(cacheTime('reliable-traders:v1:8') ?? lastUpdated)}</span>}
        </div>
      </div>

      {loading && <p className="empty-msg">Loading reliable candidates…</p>}
      {error && <p className="error-msg">{error}</p>}
      {!loading && !error && traders.length === 0 && (
        <p className="empty-msg">
          {feedResult?.message ?? 'No reliable copy candidates found right now.'}
        </p>
      )}

      {!loading && import.meta.env.DEV && feedResult && feedResult.state !== 'ok' && (
        <div className="data-source-label" style={{ marginBottom: 12 }}>
          <strong>Debug</strong> · raw {feedResult.diagnostics.rawTradeCount} · normalized {feedResult.diagnostics.normalizedTradeCount} · wallets {feedResult.diagnostics.walletGroupCount} · final {feedResult.diagnostics.finalHotTraderCount}
        </div>
      )}

      {traders.length > 0 && (
        <div className="trader-list">
          {traders.map((trader, index) => (
            <ReliableTraderCard
              key={trader.address}
              trader={trader}
              rank={index + 1}
              onSelectWallet={onSelectWallet}
            />
          ))}
        </div>
      )}
    </section>
  )
}
