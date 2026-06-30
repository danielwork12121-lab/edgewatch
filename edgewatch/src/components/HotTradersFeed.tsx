import { useEffect, useState } from 'react'
import { fetchHotTraders, type HotTraderEntry, type HotTraderLoadResult } from '../api/traders'
import { formatUSD } from '../api/polymarket'
import { truncateAddress } from '../api/wallets'
import { cacheTime, formatAge } from '../api/cache'

interface Props {
  onSelectWallet: (address: string) => void
}

const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug('[EdgeWatch]', ...args)
}

function HotTraderCard({ trader, rank, onSelectWallet }: { trader: HotTraderEntry; rank: number; onSelectWallet: (address: string) => void }) {
  const confidence = trader.hotScore >= 65 ? 'High' : trader.hotScore >= 35 ? 'Medium' : 'Low'
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
            <span className={`confidence-badge ${confidence === 'High' ? 'badge-green' : confidence === 'Medium' ? 'badge-yellow' : 'badge-orange'}`}>
              {confidence} · Hot {Math.round(trader.hotScore)}/100
            </span>
            {trader.winRate !== null && (
              <span className="confidence-badge badge-yellow">
                {(trader.winRate * 100).toFixed(0)}% win rate
              </span>
            )}
          </div>
        </div>

        <div className="trader-card-meta">
          <span className="stat vol">Vol {formatUSD(trader.recentVolumeUSDC)}</span>
          <span className="stat date">{trader.recentTradeCount} trades</span>
          <span className="stat date">{trader.marketsTraded} markets</span>
          {trader.pnl !== null && (
            <span className={`stat ${trader.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
              {trader.pnl >= 0 ? '+' : ''}{formatUSD(trader.pnl)} PnL
            </span>
          )}
          {trader.timingEdge !== null && (
            <span className="stat date">Timing {trader.timingEdge.toFixed(0)}%</span>
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
          {trader.scoreReasons.map((reason, index) => (
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

export default function HotTradersFeed({ onSelectWallet }: Props) {
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
      fetchHotTraders(8)
        .then(result => {
          if (cancelled) return
          setFeedResult(result)
          setTraders(result.traders)
          setLastUpdated(Date.now())
          devLog('hot traders loaded', {
            state: result.state,
            message: result.message,
            rawCount: result.diagnostics.rawTradeCount,
            normalizedCount: result.diagnostics.normalizedTradeCount,
            walletGroups: result.diagnostics.walletGroupCount,
            finalCount: result.diagnostics.finalHotTraderCount,
            discardedReasons: result.diagnostics.discardedReasons,
            titles: result.traders.slice(0, 5).map(trader => trader.label),
          })
          if (result.state === 'error') setError('Could not load hot traders')
          else if (result.state === 'no-trades') setError('No recent public trades returned')
          else if (result.state === 'filtered-out') setError('Trades found, but none passed filters')
        })
        .catch(err => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : 'Could not load hot traders')
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
          <h2 className="section-title">Hot Traders Right Now</h2>
          <p className="section-subtitle">
            Real public Polymarket wallets with recent activity. Scores are explainable and cached.
          </p>
        </div>
        <div className="refresh-bar">
          {lastUpdated && <span className="last-updated">{formatAge(cacheTime('hot-traders:v2:8') ?? lastUpdated)}</span>}
        </div>
      </div>

      {loading && <p className="empty-msg">Loading hot traders…</p>}
      {error && <p className="error-msg">{error}</p>}
      {!loading && !error && traders.length === 0 && (
        <p className="empty-msg">
          {feedResult?.message ?? 'No active hot traders found right now.'}
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
            <HotTraderCard
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
