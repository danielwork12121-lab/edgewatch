import { useCallback, useEffect, useState } from 'react'
import { discoverCopyCandidates, type CopyDiscoveryResult, type HotTraderEntry } from '../api/traders'
import { formatUSD } from '../api/polymarket'
import { truncateAddress } from '../api/wallets'
import { cacheInvalidate, cacheTime, formatAge } from '../api/cache'

interface Props {
  onSelectWallet: (address: string) => void
}

const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug('[EdgeWatch][copy-discovery]', ...args)
}

function CandidateCard({ trader, onSelectWallet }: { trader: HotTraderEntry; onSelectWallet: (address: string) => void }) {
  const label =
    trader.candidateTier === 'reliable' ? 'Copy-ready' :
    trader.candidateTier === 'watch' ? 'Worth watching' :
    'Ignored active trader'
  const badge =
    trader.candidateTier === 'reliable' ? 'badge-green' :
    trader.candidateTier === 'watch' ? 'badge-yellow' : 'badge-red'

  return (
    <div className="trader-card hot-trader-card">
      <div className="trader-card-body">
        <div className="trader-card-top">
          <div>
            <span className="trader-card-name">{trader.label || truncateAddress(trader.address)}</span>
            <div className="estimate-label">{truncateAddress(trader.address)}</div>
          </div>
          <div className="trader-card-badges">
            <span className={`confidence-badge ${badge}`}>{label}</span>
            <span className={`confidence-badge ${trader.copySignal === 'COPY' ? 'badge-green' : trader.copySignal === 'WATCH' ? 'badge-yellow' : 'badge-red'}`}>
              {trader.copySignal}
            </span>
            <span className={`confidence-badge ${trader.reliabilityScore >= 75 ? 'badge-green' : trader.reliabilityScore >= 50 ? 'badge-yellow' : 'badge-orange'}`}>
              Reliability {Math.round(trader.reliabilityScore)}/100
            </span>
          </div>
        </div>

        <div className="trader-card-meta">
          <span className="stat date">{trader.reliabilityLabel}</span>
          <span className="stat date">{trader.recentTradeCount} trades</span>
          <span className="stat date">{trader.marketsTraded} markets</span>
          <span className="stat date">Streak {trader.currentLosingStreak > 0 ? `Losing ${trader.currentLosingStreak}` : 'Even'}</span>
          <span className="stat date">Worst loss streak {trader.worstLosingStreak}</span>
          {trader.winRate !== null ? (
            <span className="stat date">{(trader.winRate * 100).toFixed(0)}% win rate</span>
          ) : (
            <span className="stat date">Win rate unavailable</span>
          )}
          {trader.realizedPnl !== null ? (
            <span className={`stat ${trader.realizedPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
              {trader.realizedPnl >= 0 ? '+' : ''}{formatUSD(trader.realizedPnl)} realized
            </span>
          ) : (
            <span className="stat date">Realized PnL unavailable</span>
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
          {trader.reliabilityReasons.slice(0, 5).map((reason, index) => (
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

export default function CopyCandidateDiscoveryFeed({ onSelectWallet }: Props) {
  const [result, setResult] = useState<CopyDiscoveryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [showIgnored, setShowIgnored] = useState(false)

  const load = useCallback((forceRefresh = false) => {
    setLoading(true)
    setError(null)
    if (forceRefresh) cacheInvalidate('copy-discovery:v2:8')
    discoverCopyCandidates(8)
      .then(next => {
        setResult(next)
        setLastUpdated(Date.now())
        devLog('candidate discovery loaded', {
          state: next.state,
          message: next.message,
          summary: next.summary,
          titles: [...next.reliable, ...next.watchlist].slice(0, 5).map(trader => trader.label),
        })
        if (next.state === 'error') setError('Could not scan candidate wallets')
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Could not scan candidate wallets')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const summary = result?.summary
  const showReliable = (result?.reliable ?? []).length > 0
  const showWatch = (result?.watchlist ?? []).length > 0
  const ignoredCount = (result?.ignored ?? []).length

  return (
    <section className="homepage-section hot-traders-section">
      <div className="section-heading">
        <div>
          <h2 className="section-title">Copy Candidate Discovery</h2>
          <p className="section-subtitle">
            Broad scan of recent trades, active markets, and positions. Copy-ready wallets stay separate from watch-only and ignored traders.
          </p>
        </div>
        <div className="refresh-bar">
          {lastUpdated && <span className="last-updated">{formatAge(cacheTime('copy-discovery:v2:8') ?? lastUpdated)}</span>}
          <button type="button" className="refresh-btn" onClick={() => load(true)} disabled={loading} title="Rescan candidate wallets">
            ↻
          </button>
        </div>
      </div>

      {loading && <p className="empty-msg">Scanning for candidate wallets…</p>}
      {error && <p className="error-msg">{error}</p>}

      {summary && (
        <div className="scan-summary">
          <span>Scanned {summary.scannedTrades} trades</span>
          <span>{summary.scannedWallets} wallets</span>
          <span>{summary.enrichedWallets} enriched</span>
          <span>{summary.reliableCandidates} reliable</span>
          <span>{summary.watchCandidates} watch</span>
          <span>{summary.ignoredActiveTraders} ignored</span>
        </div>
      )}

      {!loading && !error && result && result.message && (
        <p className="score-disclaimer" style={{ marginBottom: 12 }}>
          {result.message}
        </p>
      )}

      {!loading && showReliable && (
        <div className="candidate-section">
          <div className="section-heading" style={{ marginBottom: 12 }}>
            <h3 className="markets-list-title">Reliable Copy Candidates ({result?.reliable.length ?? 0})</h3>
          </div>
          <div className="trader-list">
            {result?.reliable.map(trader => (
              <CandidateCard key={trader.address} trader={trader} onSelectWallet={onSelectWallet} />
            ))}
          </div>
        </div>
      )}

      {!loading && showWatch && (
        <div className="candidate-section">
          <div className="section-heading" style={{ marginBottom: 12 }}>
            <h3 className="markets-list-title">Watchlist Candidates ({result?.watchlist.length ?? 0})</h3>
          </div>
          <div className="trader-list">
            {result?.watchlist.map(trader => (
              <CandidateCard key={trader.address} trader={trader} onSelectWallet={onSelectWallet} />
            ))}
          </div>
        </div>
      )}

      {!loading && !showReliable && showWatch && (
        <p className="empty-msg">No copy-ready wallets found in current scan. Showing watchlist candidates below.</p>
      )}

      {!loading && ignoredCount > 0 && (
        <div className="ignored-traders-block">
          <button
            type="button"
            className="ignored-toggle"
            onClick={() => setShowIgnored(v => !v)}
          >
            {showIgnored ? 'Hide ignored active traders' : `Show ignored active traders (${ignoredCount})`}
          </button>
          {showIgnored && (
            <div className="trader-list" style={{ marginTop: 12 }}>
              {result?.ignored.map(trader => (
                <CandidateCard key={trader.address} trader={trader} onSelectWallet={onSelectWallet} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
