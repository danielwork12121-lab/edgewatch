import type { EdgeScore } from '../api/scoring'
import type { WalletTrade } from '../types'
import { formatUSD } from '../api/polymarket'
import type { TraderQualityEvaluation } from '../api/traderQuality'
import { loadPortfolio, createPortfolio, addSimulatedTrade, savePortfolio } from '../api/simulation'

interface Props {
  score: EdgeScore | null
  trades: WalletTrade[]
  traderQuality: TraderQualityEvaluation | null
  onViewPortfolio?: () => void
  onFollowMsg: (msg: string) => void
}

interface Recommendation {
  action: 'COPY' | 'WATCH' | 'IGNORE'
  dataConfidence: 'High' | 'Medium' | 'Low'
  allocationPct: number
  reasons: string[]
}

function computeRecommendation(
  score: EdgeScore,
  evaluation: TraderQualityEvaluation | null,
): Recommendation {
  const reliabilityScore = evaluation?.reliabilityScore ?? 0
  const allocationPct = Math.min(10, Math.max(0.5, 1 + reliabilityScore / 12))

  const reasons: string[] = []
  if (evaluation) {
    for (const reason of evaluation.rejectionReasons.slice(0, 3)) reasons.push(`⚠ ${reason}`)
    for (const label of evaluation.riskLabels) reasons.push(`⚠ ${label}`)
    for (const reason of evaluation.positiveReasons.slice(0, 4)) reasons.push(`✓ ${reason}`)
    reasons.push(`✓ Reliability ${evaluation.reliabilityScore}/100`)
    reasons.push(`✓ ${evaluation.dataConfidenceLabel}`)
    reasons.push(`✓ Copy signal ${evaluation.copySignal}`)
    reasons.push(
      evaluation.metrics.currentLosingStreak > 0
        ? `✓ Current streak losing ${evaluation.metrics.currentLosingStreak}`
        : '✓ Current streak not losing',
    )
    reasons.push(`✓ Worst losing streak ${evaluation.metrics.worstLosingStreak}`)
    if (evaluation.winRate !== null) {
      reasons.push(`✓ ${(evaluation.winRate * 100).toFixed(0)}% win rate on resolved positions`)
    }
    if (evaluation.metrics.realizedPnl !== null) {
      reasons.push(
        `✓ Realized PnL ${evaluation.metrics.realizedPnl >= 0 ? '+' : ''}${formatUSD(Math.abs(evaluation.metrics.realizedPnl))}`,
      )
    }
  }

  if (score.sampleSize < 5) reasons.push(`⚠ Only ${score.sampleSize} trades in entry-timing sample`)
  if (score.sampleSize >= 20) reasons.push(`✓ ${score.sampleSize} trades in entry-timing sample`)
  if (score.entryEdgeScore >= 60) {
    reasons.push(`✓ Entry timing ${score.entryEdgeScore}/100 (timing only — not overall reliability)`)
  }
  if (score.avgDeltaCents > 3) reasons.push(`✓ +${score.avgDeltaCents.toFixed(1)}¢ avg price move after entry`)
  if (score.avgDeltaCents < -3) {
    reasons.push(`⚠ −${Math.abs(score.avgDeltaCents).toFixed(1)}¢ avg — price tends to move against entries`)
  }
  if (score.pricesResolved < score.sampleSize * 0.5) {
    reasons.push(`⚠ Only ${score.pricesResolved}/${score.sampleSize} trades had live prices for entry timing`)
  }

  return {
    action: evaluation?.copySignal ?? 'IGNORE',
    dataConfidence: evaluation?.confidenceLevel ?? 'Low',
    allocationPct,
    reasons,
  }
}

const ACTION_STYLES = {
  COPY:   { badge: 'copy-action-copy',    label: '✓ COPY' },
  WATCH:  { badge: 'copy-action-monitor', label: '~ WATCH' },
  IGNORE: { badge: 'copy-action-avoid',   label: '✗ IGNORE' },
}

export default function CopyTradingModule({ score, trades, traderQuality, onViewPortfolio, onFollowMsg }: Props) {
  if (!score) return null

  const rec = computeRecommendation(score, traderQuality)
  const { badge, label } = ACTION_STYLES[rec.action]
  const latestTrade = trades.find(t => t.type === 'TRADE')

  const handleFollow = () => {
    if (!latestTrade) return
    let p = loadPortfolio()
    if (!p) p = createPortfolio(1000)
    const paperSize = Math.max(1, (p.startingBalance * rec.allocationPct) / 100)
    const updated = addSimulatedTrade(p, latestTrade, paperSize)
    savePortfolio(updated)
    onFollowMsg(`Added to paper portfolio: ${latestTrade.title} (${formatUSD(paperSize)} = ${rec.allocationPct.toFixed(1)}% of balance)`)
  }

  return (
    <div className="copy-module">
      <div className="copy-module-top">
        <div className="copy-action-left">
          <span className={`copy-action-badge ${badge}`}>{label}</span>
          <span className="copy-confidence-label">Data confidence: <strong>{rec.dataConfidence}</strong></span>
        </div>
        <div className="copy-alloc-box">
          <span className="copy-alloc-pct">{rec.allocationPct.toFixed(1)}%</span>
          <span className="copy-alloc-sub">per trade of portfolio</span>
        </div>
      </div>

      <ul className="copy-reasons">
        {rec.reasons.map((r, i) => <li key={i}>{r}</li>)}
      </ul>

      {rec.action === 'COPY' && latestTrade && (
        <div className="copy-cta-row">
          <button className="search-btn" onClick={handleFollow}>
            + Copy Latest Trade (Paper ${formatUSD((1000 * rec.allocationPct) / 100)} default)
          </button>
          {onViewPortfolio && (
            <button className="back-btn" onClick={onViewPortfolio}>View Portfolio</button>
          )}
        </div>
      )}

      <p className="copy-disclaimer">
        Simulated only. Not financial advice. Copy signal is based on realized reliability — entry timing does not override poor performance.
      </p>
    </div>
  )
}
