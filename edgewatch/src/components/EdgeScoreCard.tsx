import type { EdgeScore } from '../api/scoring'
import { confidenceLabel } from '../api/scoring'
import { formatUSD } from '../api/polymarket'

interface Props {
  score: EdgeScore
  loading?: boolean
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
  const colors = { very_low: 'badge-red', low: 'badge-orange', medium: 'badge-yellow', high: 'badge-green' }
  return <span className={`confidence-badge ${colors[level]}`}>{confidenceLabel(level)}</span>
}

export default function EdgeScoreCard({ score, loading }: Props) {
  const deltaSign = score.avgDeltaCents >= 0 ? '+' : ''
  const resolved = score.pricesResolved
  const total = score.sampleSize
  const coveragePct = total > 0 ? Math.round((resolved / total) * 100) : 0

  return (
    <div className="edge-score-card">
      <div className="edge-score-header">
        <h3 className="edge-score-title">EdgeScore</h3>
        <ConfidenceBadge level={score.sampleConfidence} />
        {loading && <span className="score-loading-badge">Fetching live prices…</span>}
      </div>

      <div className="score-disclaimer">
        Entry-based edge: measures whether market price moved in this wallet's direction
        after each trade entry. Size-weighted across {score.sampleSize} trades / {score.marketsTraded} markets.
        <br />
        <strong>Not financial advice. Estimated signal only.</strong>
      </div>

      <div className="score-rings">
        <ScoreRing value={score.overall} label="Overall" />
        <ScoreRing value={score.entryEdgeScore} label="Entry Edge" />
        <ScoreRing value={score.repeatabilityScore} label="Repeatability" />
      </div>

      <div className="score-details">
        <div className="score-detail-row">
          <span className="score-detail-label">Avg delta after entry</span>
          <span className={`score-detail-val ${score.avgDeltaCents >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
            {deltaSign}{score.avgDeltaCents.toFixed(1)}¢ <span className="estimate-label">(estimated)</span>
          </span>
        </div>
        <div className="score-detail-row">
          <span className="score-detail-label">Trades with live price</span>
          <span className="score-detail-val">
            {resolved} / {total} ({coveragePct}%) <span className="estimate-label">(real)</span>
          </span>
        </div>
        <div className="score-detail-row">
          <span className="score-detail-label">Favorable / Unfavorable</span>
          <span className="score-detail-val">
            <span className="pnl-pos">{score.breakdown.positiveDeltaTrades}↑</span>
            {' / '}
            <span className="pnl-neg">{score.breakdown.negativeDeltaTrades}↓</span>
            {score.breakdown.unresolvedTrades > 0 && (
              <span className="estimate-label"> ({score.breakdown.unresolvedTrades} no price)</span>
            )}
          </span>
        </div>
        <div className="score-detail-row">
          <span className="score-detail-label">Total volume</span>
          <span className="score-detail-val">{formatUSD(score.totalVolumeUSDC)} <span className="estimate-label">(real)</span></span>
        </div>
        <div className="score-detail-row">
          <span className="score-detail-label">Confidence</span>
          <span className="score-detail-val">{confidenceLabel(score.sampleConfidence)}</span>
        </div>
      </div>

      <p className="score-footnote">
        Entry Edge: (currentPrice − entryPrice) × sizeUSDC per trade, normalized.
        Current price = latest CLOB trade for the specific outcome token.
        Repeatability: rewards wallets active across many markets with multiple entries each.
        Score is meaningless at very_low confidence — fewer than 5 trades.
      </p>
    </div>
  )
}
