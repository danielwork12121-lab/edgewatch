import type { EdgeScore } from '../api/scoring'
import { confidenceLabel } from '../api/scoring'
import { formatUSD } from '../api/polymarket'

interface Props {
  score: EdgeScore
}

function ScoreRing({ value, label }: { value: number; label: string }) {
  const r = 30
  const circ = 2 * Math.PI * r
  const offset = circ - (value / 100) * circ
  const color = value >= 65 ? '#22c55e' : value >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <div className="score-ring-wrap">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
        <circle
          cx="40" cy="40" r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 40 40)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
        <text x="40" y="44" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--text-h)">
          {value}
        </text>
      </svg>
      <span className="score-ring-label">{label}</span>
    </div>
  )
}

function ConfidenceBadge({ level }: { level: EdgeScore['sampleConfidence'] }) {
  const colors = {
    very_low: 'badge-red',
    low: 'badge-orange',
    medium: 'badge-yellow',
    high: 'badge-green',
  }
  return (
    <span className={`confidence-badge ${colors[level]}`}>
      {confidenceLabel(level)}
    </span>
  )
}

export default function EdgeScoreCard({ score }: Props) {
  const { breakdown } = score
  const edgeDir = score.estimatedEdge >= 0 ? '+' : ''

  return (
    <div className="edge-score-card">
      <div className="edge-score-header">
        <h3 className="edge-score-title">EdgeScore</h3>
        <ConfidenceBadge level={score.sampleConfidence} />
      </div>

      <div className="score-disclaimer">
        Estimated signal strength based on {score.sampleSize} trades across {score.marketsTraded} markets.
        <br />
        <strong>Not financial advice. Estimated, not guaranteed.</strong>
      </div>

      <div className="score-rings">
        <ScoreRing value={score.overall} label="Overall" />
        <ScoreRing value={score.clvScore} label="CLV Score" />
        <ScoreRing value={score.repeatabilityScore} label="Repeatability" />
      </div>

      <div className="score-details">
        <div className="score-detail-row">
          <span className="score-detail-label">Estimated Edge</span>
          <span className={`score-detail-val ${score.estimatedEdge >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
            {edgeDir}{score.estimatedEdge.toFixed(1)}¢ avg price move after entry
          </span>
        </div>
        <div className="score-detail-row">
          <span className="score-detail-label">Total Volume</span>
          <span className="score-detail-val">{formatUSD(score.totalVolumeUSDC)} <span className="estimate-label">(real)</span></span>
        </div>
        <div className="score-detail-row">
          <span className="score-detail-label">Realized PnL</span>
          <span className={`score-detail-val ${breakdown.realizedPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
            {breakdown.realizedPnl >= 0 ? '+' : ''}{formatUSD(breakdown.realizedPnl)} <span className="estimate-label">(real)</span>
          </span>
        </div>
        <div className="score-detail-row">
          <span className="score-detail-label">Open Value</span>
          <span className="score-detail-val">{formatUSD(breakdown.unrealizedPnl)} <span className="estimate-label">(estimated)</span></span>
        </div>
        <div className="score-detail-row">
          <span className="score-detail-label">Positions Won / Lost</span>
          <span className="score-detail-val">
            <span className="pnl-pos">{breakdown.winningPositions}W</span>
            {' / '}
            <span className="pnl-neg">{breakdown.losingPositions}L</span>
          </span>
        </div>
        <div className="score-detail-row">
          <span className="score-detail-label">Confidence</span>
          <span className="score-detail-val">{confidenceLabel(score.sampleConfidence)}</span>
        </div>
      </div>

      <p className="score-footnote">
        CLV Score: measures if price moved in wallet's favor after entry (estimated from positions).
        Repeatability: rewards wallets active across many markets, not one-off bets.
        Low confidence scores should be treated as noise.
      </p>
    </div>
  )
}
