import { useCallback, useEffect, useState } from 'react'
import { discoverCopyCandidates, type CopyDiscoveryResult, type HotTraderEntry, type NearMissEntry } from '../api/traders'
import { formatUSD } from '../api/polymarket'
import { truncateAddress } from '../api/wallets'
import { cacheInvalidate, cacheTime, formatAge } from '../api/cache'

interface Props {
  onSelectWallet: (address: string) => void
}

const CACHE_KEY = 'copy-discovery:v4:8'

const REJECTION_LABELS: Record<string, string> = {
  too_little_history: 'too little history',
  negative_pnl: 'negative PnL',
  poor_win_rate: 'poor win rate',
  severe_losing_streak: 'severe losing streak',
  weak_sample: 'weak sample',
  low_reliability: 'low reliability',
  no_promising_signal: 'no promising signal',
  concentration_risk: 'concentration risk',
  hard_fail: 'hard failure',
  other: 'other',
}

const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug('[EdgeWatch][copy-discovery]', ...args)
}

function CandidateCard({ trader, onSelectWallet }: { trader: HotTraderEntry; onSelectWallet: (address: string) => void }) {
  const label =
    trader.candidateTier === 'reliable' ? 'Copy-ready' :
    trader.candidateTier === 'watch' ? 'Worth watching' :
    'Rejected'
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
            <span className={`confidence-badge ${trader.reliabilityScore >= 75 ? 'badge-green' : trader.reliabilityScore >= 55 ? 'badge-yellow' : 'badge-orange'}`}>
              Reliability {Math.round(trader.reliabilityScore)}/100
            </span>
          </div>
        </div>

        <div className="trader-card-meta">
          <span className="stat date">{trader.reliabilityLabel}</span>
          <span className="stat date">{trader.recentTradeCount} recent trades</span>
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

function NearMissRow({ entry, onSelectWallet }: { entry: NearMissEntry; onSelectWallet: (address: string) => void }) {
  return (
    <div className="near-miss-row">
      <div className="near-miss-main">
        <button type="button" className="near-miss-wallet" onClick={() => onSelectWallet(entry.address)}>
          {entry.label || truncateAddress(entry.address)}
        </button>
        <span className="near-miss-stat">Reliability {entry.reliabilityScore}/100</span>
        <span className="near-miss-stat">
          {entry.winRate !== null ? `${(entry.winRate * 100).toFixed(0)}% win rate` : 'Win rate n/a'}
        </span>
        <span className="near-miss-stat">
          {entry.realizedPnl !== null ? `${entry.realizedPnl >= 0 ? '+' : ''}${formatUSD(entry.realizedPnl)} PnL` : 'PnL n/a'}
        </span>
        <span className="near-miss-stat">{entry.tradeCount} trades</span>
      </div>
      <p className="near-miss-reason">Rejected: {entry.rejectionReason}</p>
    </div>
  )
}

function ScanSummaryPanel({ result }: { result: CopyDiscoveryResult }) {
  const { summary } = result
  const noCandidates = summary.reliableCandidates === 0 && summary.watchCandidates === 0
  const breakdownEntries = Object.entries(summary.rejectionBreakdown).filter(([, count]) => count > 0)

  return (
    <div className="scan-summary-panel">
      <div className="scan-summary-grid">
        <div className="scan-summary-stat">
          <span className="scan-summary-value">{summary.scannedTrades.toLocaleString()}</span>
          <span className="scan-summary-label">trades scanned</span>
        </div>
        <div className="scan-summary-stat">
          <span className="scan-summary-value">{summary.scannedWallets}</span>
          <span className="scan-summary-label">wallets checked</span>
        </div>
        <div className="scan-summary-stat">
          <span className="scan-summary-value">{summary.enrichedWallets}</span>
          <span className="scan-summary-label">wallets enriched</span>
        </div>
        <div className="scan-summary-stat">
          <span className="scan-summary-value">{summary.reliableCandidates}</span>
          <span className="scan-summary-label">copy-ready</span>
        </div>
        <div className="scan-summary-stat">
          <span className="scan-summary-value">{summary.watchCandidates}</span>
          <span className="scan-summary-label">watchlist</span>
        </div>
        <div className="scan-summary-stat">
          <span className="scan-summary-value">{summary.ignoredActiveTraders}</span>
          <span className="scan-summary-label">rejected</span>
        </div>
      </div>
      <p className="scan-summary-source">
        Source: {summary.scanSource}
        {summary.apiNote ? ` · ${summary.apiNote}` : ''}
      </p>
      {noCandidates && breakdownEntries.length > 0 && (
        <div className="scan-summary-empty">
          <strong>Rejection breakdown</strong>
          <ul>
            {breakdownEntries.map(([key, count]) => (
              <li key={key}>
                {count} failed: {REJECTION_LABELS[key] ?? key}
              </li>
            ))}
          </ul>
        </div>
      )}
      {noCandidates && summary.emptyReasons.length > 0 && (
        <div className="scan-summary-empty">
          <strong>Scan notes</strong>
          <ul>
            {summary.emptyReasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function CopyCandidateDiscoveryFeed({ onSelectWallet }: Props) {
  const [result, setResult] = useState<CopyDiscoveryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [showNearMisses, setShowNearMisses] = useState(false)

  const load = useCallback((forceRefresh = false) => {
    setLoading(true)
    setError(null)
    if (forceRefresh) cacheInvalidate(CACHE_KEY)
    discoverCopyCandidates(8)
      .then(next => {
        setResult(next)
        setLastUpdated(Date.now())
        devLog('candidate discovery loaded', {
          state: next.state,
          message: next.message,
          summary: next.summary,
          nearMisses: next.nearMisses.length,
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

  const showReliable = (result?.reliable ?? []).length > 0
  const showWatch = (result?.watchlist ?? []).length > 0
  const noStrongCandidates = !showReliable && !showWatch
  const nearMisses = result?.nearMisses ?? []

  return (
    <section className="homepage-section hot-traders-section">
      <div className="section-heading">
        <div>
          <h2 className="section-title">Copy Candidate Discovery</h2>
          <p className="section-subtitle">
            Broad scan of recent trades, active markets, and wallet history. Only genuinely promising wallets surface as candidates.
          </p>
        </div>
        <div className="refresh-bar">
          {lastUpdated && <span className="last-updated">{formatAge(cacheTime(CACHE_KEY) ?? lastUpdated)}</span>}
          <button type="button" className="refresh-btn" onClick={() => load(true)} disabled={loading} title="Rescan candidate wallets">
            ↻
          </button>
        </div>
      </div>

      {loading && <p className="empty-msg">Scanning for candidate wallets…</p>}
      {error && <p className="error-msg">{error}</p>}

      {result && !loading && <ScanSummaryPanel result={result} />}

      {!loading && !error && result && result.message && showReliable && (
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
          {!showReliable && (
            <p className="score-disclaimer" style={{ marginBottom: 12 }}>
              No copy-ready wallets found in this scan. Showing watchlist candidates below.
            </p>
          )}
          <div className="trader-list">
            {result?.watchlist.map(trader => (
              <CandidateCard key={trader.address} trader={trader} onSelectWallet={onSelectWallet} />
            ))}
          </div>
        </div>
      )}

      {!loading && noStrongCandidates && result && result.state !== 'error' && (
        <p className="empty-msg">
          No strong copy candidates found in this scan.
        </p>
      )}

      {!loading && nearMisses.length > 0 && (
        <div className="ignored-traders-block">
          <button
            type="button"
            className="ignored-toggle"
            onClick={() => setShowNearMisses(v => !v)}
          >
            {showNearMisses ? 'Hide why no candidates?' : `Why no candidates? (${nearMisses.length} near misses)`}
          </button>
          {showNearMisses && (
            <div className="near-miss-list" style={{ marginTop: 12 }}>
              <p className="score-disclaimer" style={{ marginBottom: 10 }}>
                These wallets were closest to passing but were rejected — not recommended.
              </p>
              {nearMisses.map(entry => (
                <NearMissRow key={entry.address} entry={entry} onSelectWallet={onSelectWallet} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
