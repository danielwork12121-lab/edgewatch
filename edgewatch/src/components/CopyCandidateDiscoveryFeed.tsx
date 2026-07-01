import { useCallback, useEffect, useState } from 'react'
import { discoverCopyCandidates, type CopyDiscoveryResult, type HotTraderEntry, type NearMissEntry } from '../api/traders'
import { formatUSD } from '../api/polymarket'
import { truncateAddress } from '../api/wallets'
import { cacheInvalidate, cacheTime, formatAge } from '../api/cache'

interface Props {
  onSelectWallet: (address: string) => void
}

const CACHE_KEY = 'copy-discovery:v5:8'

const REJECTION_LABELS: Record<string, string> = {
  too_little_history: 'too little history',
  negative_pnl: 'negative PnL',
  poor_win_rate: 'poor win rate',
  severe_losing_streak: 'severe losing streak',
  severe_drawdown: 'severe drawdown',
  weak_sample: 'weak sample',
  low_quality: 'low reliability score',
  lucky_win_risk: 'lucky win / outlier risk',
  outlier_driven: 'outlier-driven profit',
  open_exposure_risk: 'high open exposure',
  poor_profit_factor: 'weak profit factor',
  no_promising_signal: 'no promising signal',
  other: 'other',
}

const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug('[EdgeWatch][copy-discovery]', ...args)
}

function tierLabel(tier: HotTraderEntry['candidateTier']): string {
  switch (tier) {
    case 'reliable': return 'Reliable candidate'
    case 'watch': return 'Watchlist candidate'
    case 'emerging': return 'Emerging candidate — limited evidence'
    default: return 'Rejected'
  }
}

function tierBadge(tier: HotTraderEntry['candidateTier']): string {
  switch (tier) {
    case 'reliable': return 'badge-green'
    case 'watch': return 'badge-yellow'
    case 'emerging': return 'badge-orange'
    default: return 'badge-red'
  }
}

function CandidateCard({ trader, onSelectWallet }: { trader: HotTraderEntry; onSelectWallet: (address: string) => void }) {
  const reasons = trader.plainReasons.length > 0 ? trader.plainReasons : trader.reliabilityReasons

  return (
    <div className="trader-card hot-trader-card">
      <div className="trader-card-body">
        <div className="trader-card-top">
          <div>
            <span className="trader-card-name">{trader.label || truncateAddress(trader.address)}</span>
            <div className="estimate-label">{truncateAddress(trader.address)} · {trader.candidateSource}</div>
          </div>
          <div className="trader-card-badges">
            <span className={`confidence-badge ${tierBadge(trader.candidateTier)}`}>{tierLabel(trader.candidateTier)}</span>
            <span className={`confidence-badge ${trader.reliabilityScore >= 75 ? 'badge-green' : trader.reliabilityScore >= 60 ? 'badge-yellow' : 'badge-orange'}`}>
              Reliability {trader.reliabilityScore}/100
            </span>
            <span className={`confidence-badge ${trader.dataConfidence === 'High' ? 'badge-green' : trader.dataConfidence === 'Medium' ? 'badge-yellow' : 'badge-orange'}`}>
              {trader.dataConfidenceLabel}
            </span>
            {trader.profitFactor !== null && (
              <span className="confidence-badge badge-yellow">PF {trader.profitFactor.toFixed(2)}</span>
            )}
          </div>
        </div>

        <div className="trader-card-meta">
          <span className="stat date">{trader.reliabilityLabel}</span>
          <span className="stat date">{trader.recentTradeCount} recent · {trader.historicalTradeCount} historical</span>
          <span className="stat date">{trader.marketsTraded} markets</span>
          {trader.winRate !== null && (
            <span className="stat date">{(trader.winRate * 100).toFixed(0)}% win rate</span>
          )}
          {trader.realizedPnl !== null && (
            <span className={`stat ${trader.realizedPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
              {trader.realizedPnl >= 0 ? '+' : ''}{formatUSD(trader.realizedPnl)} realized
            </span>
          )}
          {trader.pnlExcludingLargestWin !== null && trader.realizedPnl !== null && trader.realizedPnl > 0 && (
            <span className="stat date">Ex-top-win {trader.pnlExcludingLargestWin >= 0 ? '+' : ''}{formatUSD(trader.pnlExcludingLargestWin)}</span>
          )}
          <span className="stat date">{trader.backtest.label}</span>
        </div>

        {trader.activeBets.length > 0 && (
          <div className="hot-trader-markets">
            {trader.activeBets.slice(0, 2).map(bet => (
              <span key={`${bet.title}-${bet.outcome}`} className="hot-trader-market">
                {bet.title} · {bet.followability}
              </span>
            ))}
          </div>
        )}

        <div className="hot-trader-markets">
          {trader.activeMarkets.slice(0, 3).map(market => (
            <span key={market} className="hot-trader-market">{market}</span>
          ))}
        </div>

        <ul className="hot-trader-reasons">
          {reasons.slice(0, 5).map((reason, index) => (
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
  const noCandidates =
    summary.reliableCandidates === 0 &&
    summary.watchCandidates === 0 &&
    summary.emergingCandidates === 0
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
          <span className="scan-summary-label">reliable</span>
        </div>
        <div className="scan-summary-stat">
          <span className="scan-summary-value">{summary.watchCandidates}</span>
          <span className="scan-summary-label">watchlist</span>
        </div>
        <div className="scan-summary-stat">
          <span className="scan-summary-value">{summary.emergingCandidates}</span>
          <span className="scan-summary-label">emerging</span>
        </div>
        <div className="scan-summary-stat">
          <span className="scan-summary-value">{summary.ignoredActiveTraders}</span>
          <span className="scan-summary-label">rejected</span>
        </div>
      </div>
      <p className="scan-summary-source">
        Source: {summary.scanSource}
        {summary.sourceLabels.length > 0 ? ` (${summary.sourceLabels.join(', ')})` : ''}
        {summary.apiNote ? ` · ${summary.apiNote}` : ''}
      </p>
      {noCandidates && breakdownEntries.length > 0 && (
        <div className="scan-summary-empty">
          <strong>Rejection breakdown</strong>
          <ul>
            {breakdownEntries.map(([key, count]) => (
              <li key={key}>{count} failed: {REJECTION_LABELS[key] ?? key}</li>
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
        devLog('candidate discovery loaded', { state: next.state, summary: next.summary })
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
  const showEmerging = (result?.emerging ?? []).length > 0
  const noStrongCandidates = !showReliable && !showWatch && !showEmerging
  const nearMisses = result?.nearMisses ?? []

  return (
    <section className="homepage-section hot-traders-section">
      <div className="section-heading">
        <div>
          <h2 className="section-title">Trader Reliability Discovery</h2>
          <p className="section-subtitle">
            Repeatable trader reliability scoring — consistency over lucky wins. Only genuinely promising wallets surface.
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

      {!loading && showReliable && (
        <div className="candidate-section">
          <div className="section-heading" style={{ marginBottom: 12 }}>
            <h3 className="markets-list-title">Reliable Candidates ({result?.reliable.length ?? 0})</h3>
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

      {!loading && showEmerging && (
        <div className="candidate-section">
          <div className="section-heading" style={{ marginBottom: 12 }}>
            <h3 className="markets-list-title">Emerging Traders ({result?.emerging.length ?? 0})</h3>
          </div>
          <p className="score-disclaimer" style={{ marginBottom: 12 }}>
            Limited evidence — clean recent signals but not enough history for reliable status.
          </p>
          <div className="trader-list">
            {result?.emerging.map(trader => (
              <CandidateCard key={trader.address} trader={trader} onSelectWallet={onSelectWallet} />
            ))}
          </div>
        </div>
      )}

      {!loading && noStrongCandidates && result && result.state !== 'error' && (
        <p className="empty-msg">No reliable or watchlist traders found in this scan.</p>
      )}

      {!loading && nearMisses.length > 0 && (
        <div className="ignored-traders-block">
          <button type="button" className="ignored-toggle" onClick={() => setShowNearMisses(v => !v)}>
            {showNearMisses ? 'Hide near misses' : `Why no candidates? (${nearMisses.length} near misses)`}
          </button>
          {showNearMisses && (
            <div className="near-miss-list" style={{ marginTop: 12 }}>
              <p className="score-disclaimer" style={{ marginBottom: 10 }}>
                Closest wallets that still failed quality gates — not recommended.
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
