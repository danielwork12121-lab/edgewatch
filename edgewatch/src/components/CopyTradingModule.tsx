import type { EdgeScore } from '../api/scoring'
import type { WalletTrade } from '../types'
import { formatUSD } from '../api/polymarket'
import type { TraderReliability } from '../api/traders'
import { loadPortfolio, createPortfolio, addSimulatedTrade, savePortfolio } from '../api/simulation'

interface Props {
  score: EdgeScore | null
  trades: WalletTrade[]
  winRate: number | null
  reliability: TraderReliability | null
  onViewPortfolio?: () => void
  onFollowMsg: (msg: string) => void
}

interface Recommendation {
  action: 'COPY' | 'WATCH' | 'IGNORE'
  confidence: 'High' | 'Medium' | 'Low'
  allocationPct: number
  reasons: string[]
}

function computeRecommendation(score: EdgeScore, winRate: number | null, reliability: TraderReliability | null): Recommendation {
  const reliabilityScore = reliability?.reliabilityScore ?? 0
  const allocationPct = Math.min(10, Math.max(0.5, Math.min(10, 1 + reliabilityScore / 12)))

  const reasons: string[] = []
  if (reliability) {
    for (const reason of reliability.hardFailReasons.slice(0, 3)) reasons.push(reason)
    reasons.push(`✓ Reliability ${reliability.reliabilityScore}/100`)
    reasons.push(`✓ ${reliability.reliabilityLabel}`)
    reasons.push(`✓ Current streak ${reliability.currentLosingStreak > 0 ? `losing ${reliability.currentLosingStreak}` : 'not losing'}`)
    reasons.push(`✓ Worst losing streak ${reliability.worstLosingStreak}`)
    if (reliability.winRate !== null) reasons.push(`✓ ${(reliability.winRate * 100).toFixed(0)}% win rate on resolved positions`)
    if (reliability.realizedPnl !== null) reasons.push(`✓ Realized PnL ${reliability.realizedPnl >= 0 ? '+' : ''}${formatUSD(Math.abs(reliability.realizedPnl))}`)
    if (reliability.totalPnl !== null) reasons.push(`✓ Total PnL ${reliability.totalPnl >= 0 ? '+' : ''}${formatUSD(Math.abs(reliability.totalPnl))}`)
  }
  if (score.sampleSize < 5) reasons.push(`⚠ Only ${score.sampleSize} trades — signal unreliable`)
  if (score.sampleSize >= 20) reasons.push(`✓ ${score.sampleSize} trades — meaningful sample`)
  if (score.entryEdgeScore >= 60) reasons.push(`✓ Consistently enters before price moves (${score.entryEdgeScore}/100 entry edge)`)
  if (score.repeatabilityScore >= 65) reasons.push(`✓ Active across ${score.marketsTraded} markets — not a one-off`)
  if (winRate !== null && winRate >= 0.6) reasons.push(`✓ ${(winRate * 100).toFixed(0)}% win rate on resolved positions`)
  if (score.avgDeltaCents > 3) reasons.push(`✓ +${score.avgDeltaCents.toFixed(1)}¢ avg price move after entry`)
  if (score.avgDeltaCents < -3) reasons.push(`⚠ −${Math.abs(score.avgDeltaCents).toFixed(1)}¢ avg — price tends to move against entries`)
  if (score.overall < 30) reasons.push(`⚠ Low overall score (${score.overall}/100)`)
  if (score.pricesResolved < score.sampleSize * 0.5) reasons.push(`⚠ Only ${score.pricesResolved}/${score.sampleSize} trades had live prices`)

  let action: Recommendation['action']
  let confidence: Recommendation['confidence']

  if (reliability?.copySignal === 'COPY' && reliabilityScore >= 75 && (reliability.winRate ?? 0) >= 0.45 && (reliability.realizedPnl ?? 0) >= 0) {
    action = 'COPY'
    confidence = reliability?.confidence === 'High' ? 'High' : 'Medium'
  } else if (reliability && reliability.reliabilityScore >= 50 && reliability.hardFailReasons.length === 0) {
    action = 'WATCH'
    confidence = 'Low'
  } else {
    action = 'IGNORE'
    confidence = 'Low'
  }

  return { action, confidence, allocationPct, reasons }
}

const ACTION_STYLES = {
  COPY:   { badge: 'copy-action-copy',    label: '✓ COPY' },
  WATCH:  { badge: 'copy-action-monitor', label: '~ WATCH' },
  IGNORE: { badge: 'copy-action-avoid',   label: '✗ IGNORE' },
}

export default function CopyTradingModule({ score, trades, winRate, reliability, onViewPortfolio, onFollowMsg }: Props) {
  if (!score) return null

  const rec = computeRecommendation(score, winRate, reliability)
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
          <span className="copy-confidence-label">Confidence: <strong>{rec.confidence}</strong></span>
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
        Simulated only. Not financial advice. Past entry timing does not guarantee future performance.
      </p>
    </div>
  )
}
