import { useState } from 'react'
import type { WalletPosition } from '../types'
import { formatUSD } from '../api/polymarket'

interface Props {
  positions: WalletPosition[]
}

type GraphViewMode = 'raw' | 'balanced'

interface StreakResult {
  maxWin: number
  maxLoss: number
  currentStreak: number
  currentType: 'win' | 'loss' | null
}

interface PositionPoint {
  pnl: number
  cumPnl: number
  drawdown: number
  title: string
}

function computeStreak(positions: WalletPosition[]): StreakResult {
  const sorted = [...positions]
    .filter(p => (p.initialValue ?? 0) > 0)
    .sort((a, b) => new Date(a.endDate || 0).getTime() - new Date(b.endDate || 0).getTime())

  if (sorted.length === 0) return { maxWin: 0, maxLoss: 0, currentStreak: 0, currentType: null }

  let maxWin = 0
  let maxLoss = 0
  let cur = 0
  let curType: 'win' | 'loss' | null = null

  for (const pos of sorted) {
    const type: 'win' | 'loss' = (pos.cashPnl ?? 0) >= 0 ? 'win' : 'loss'
    if (type === curType) {
      cur += 1
    } else {
      cur = 1
      curType = type
    }
    if (type === 'win') maxWin = Math.max(maxWin, cur)
    else maxLoss = Math.max(maxLoss, cur)
  }

  return { maxWin, maxLoss, currentStreak: cur, currentType: curType }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function buildSeries(positions: WalletPosition[]): PositionPoint[] {
  const sorted = [...positions]
    .filter(p => (p.initialValue ?? 0) > 0)
    .sort((a, b) => new Date(a.endDate || 0).getTime() - new Date(b.endDate || 0).getTime())

  let running = 0
  let peak = 0
  return sorted.map(pos => {
    const pnl = pos.cashPnl ?? 0
    running += pnl
    peak = Math.max(peak, running)
    return {
      pnl,
      cumPnl: running,
      drawdown: running - peak,
      title: pos.title,
    }
  })
}

function barVisualMagnitude(pnl: number, mode: GraphViewMode, maxAbsBar: number): number {
  const abs = Math.abs(pnl)
  if (abs <= 0) return 0
  if (mode === 'raw') return abs / maxAbsBar
  const scaled = Math.sqrt(abs)
  const maxScaled = Math.sqrt(maxAbsBar)
  return scaled / maxScaled
}

const W = 520
const H = 150
const PX = 32
const PY = 14
const IW = W - 2 * PX
const IH = H - 2 * PY

export default function PnLGraph({ positions }: Props) {
  const [viewMode, setViewMode] = useState<GraphViewMode>('balanced')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const data = buildSeries(positions)

  if (data.length === 0) {
    return <p className="empty-msg">No position history available.</p>
  }

  const totalPnl = data[data.length - 1]?.cumPnl ?? 0
  const wins = data.filter(d => d.pnl >= 0).length
  const losses = data.length - wins
  const streak = computeStreak(positions)
  const pnls = data.map(d => d.pnl)
  const positivePnls = pnls.filter(p => p > 0)
  const largestWin = positivePnls.length > 0 ? Math.max(...positivePnls) : 0
  const totalPositive = positivePnls.reduce((sum, value) => sum + value, 0)
  const pnlExLargestWin = totalPnl - largestWin
  const medianPnl = median(pnls)
  const maxDrawdown = Math.min(...data.map(d => d.drawdown), 0)
  const outlierContributionPct = totalPositive > 0 ? (largestWin / totalPositive) * 100 : null
  const luckyWinRisk = totalPnl > 0 && pnlExLargestWin < 0

  const maxAbsBar = Math.max(...data.map(d => Math.abs(d.pnl)), 0.01)
  const maxAbsCum = Math.max(...data.map(d => Math.abs(d.cumPnl)), 0.01)
  const midY = PY + IH / 2
  const n = data.length
  const gap = 1
  const barW = Math.max(2, (IW - gap * (n - 1)) / n)

  const linePts = data.map((d, i) => {
    const x = PX + (i / Math.max(n - 1, 1)) * IW
    const y = midY - (d.cumPnl / maxAbsCum) * (IH / 2 - 2)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const ddPts = data.map((d, i) => {
    const x = PX + (i / Math.max(n - 1, 1)) * IW
    const y = midY - (d.drawdown / maxAbsCum) * (IH / 2 - 2)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  })
  const ddPath = `${ddPts.join(' ')} L${(PX + IW).toFixed(1)},${midY} L${PX},${midY} Z`

  const hovered = hoveredIndex !== null ? data[hoveredIndex] : null

  return (
    <div className="pnl-graph-wrap">
      <div className="pnl-graph-toolbar">
        <h3 className="markets-list-title" style={{ margin: 0 }}>Performance Graph</h3>
        <div className="pnl-view-toggle" role="group" aria-label="Graph view mode">
          <button
            type="button"
            className={`pnl-view-btn ${viewMode === 'raw' ? 'active' : ''}`}
            onClick={() => setViewMode('raw')}
          >
            Raw
          </button>
          <button
            type="button"
            className={`pnl-view-btn ${viewMode === 'balanced' ? 'active' : ''}`}
            onClick={() => setViewMode('balanced')}
          >
            Balanced
          </button>
        </div>
      </div>

      <div className="pnl-graph-summary">
        <div className="pnl-sum-stat">
          <span className={`pnl-sum-val ${totalPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
            {totalPnl >= 0 ? '+' : ''}{formatUSD(totalPnl)}
          </span>
          <span className="pnl-sum-label">Total PnL</span>
        </div>
        <div className="pnl-sum-stat">
          <span className="pnl-sum-val">
            <span className="pnl-pos">{wins}W</span>
            {' / '}
            <span className="pnl-neg">{losses}L</span>
          </span>
          <span className="pnl-sum-label">Win / Loss</span>
        </div>
        <div className="pnl-sum-stat">
          <span className={`pnl-sum-val ${streak.currentType === 'win' ? 'pnl-pos' : 'pnl-neg'}`}>
            {streak.currentStreak}
            {streak.currentType === 'win' ? 'W' : streak.currentType === 'loss' ? 'L' : '—'}
          </span>
          <span className="pnl-sum-label">Current streak</span>
        </div>
        <div className="pnl-sum-stat">
          <span className="pnl-sum-val pnl-pos">{streak.maxWin}W</span>
          <span className="pnl-sum-label">Best win streak</span>
        </div>
        <div className="pnl-sum-stat">
          <span className="pnl-sum-val pnl-neg">{streak.maxLoss}L</span>
          <span className="pnl-sum-label">Worst loss streak</span>
        </div>
        <div className="pnl-sum-stat">
          <span className="pnl-sum-val pnl-neg">{formatUSD(maxDrawdown)}</span>
          <span className="pnl-sum-label">Max drawdown</span>
        </div>
        {medianPnl !== null && (
          <div className="pnl-sum-stat">
            <span className={`pnl-sum-val ${medianPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
              {medianPnl >= 0 ? '+' : ''}{formatUSD(medianPnl)}
            </span>
            <span className="pnl-sum-label">Median position</span>
          </div>
        )}
        {totalPnl > 0 && (
          <div className="pnl-sum-stat">
            <span className={`pnl-sum-val ${pnlExLargestWin >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
              {pnlExLargestWin >= 0 ? '+' : ''}{formatUSD(pnlExLargestWin)}
            </span>
            <span className="pnl-sum-label">Ex-largest win</span>
          </div>
        )}
        {outlierContributionPct !== null && outlierContributionPct > 0 && (
          <div className="pnl-sum-stat">
            <span className={`pnl-sum-val ${outlierContributionPct > 55 ? 'pnl-neg' : ''}`}>
              {outlierContributionPct.toFixed(0)}%
            </span>
            <span className="pnl-sum-label">Top win share</span>
          </div>
        )}
      </div>

      {luckyWinRisk && (
        <p className="pnl-graph-alert">
          Outlier-driven profit — total PnL is positive but PnL excluding the largest win is negative.
        </p>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="pnl-svg"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <line x1={PX} y1={midY} x2={W - PX} y2={midY} stroke="var(--border)" strokeWidth="1" />

        {data.map((d, i) => {
          const x = PX + i * (barW + gap)
          const visual = barVisualMagnitude(d.pnl, viewMode, maxAbsBar)
          const minHeight = viewMode === 'balanced' && d.pnl !== 0 ? 3 : 1
          const barHeight = Math.max(minHeight, visual * (IH / 2 - 4))
          const y = d.pnl >= 0 ? midY - barHeight : midY
          return (
            <rect
              key={i}
              x={x.toFixed(1)}
              y={y.toFixed(1)}
              width={barW.toFixed(1)}
              height={barHeight.toFixed(1)}
              fill={d.pnl >= 0 ? '#22c55e' : '#ef4444'}
              opacity={hoveredIndex === i ? 0.95 : 0.65}
              onMouseEnter={() => setHoveredIndex(i)}
            />
          )
        })}

        <path d={ddPath} fill="#ef4444" opacity="0.12" />
        <path d={linePts} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      </svg>

      {hovered && (
        <div className="pnl-graph-tooltip">
          <strong>{hovered.title}</strong>
          <span>Raw PnL: {hovered.pnl >= 0 ? '+' : ''}{formatUSD(hovered.pnl)}</span>
          <span>Cumulative: {hovered.cumPnl >= 0 ? '+' : ''}{formatUSD(hovered.cumPnl)}</span>
          <span>Drawdown: {formatUSD(hovered.drawdown)}</span>
        </div>
      )}

      <div className="pnl-graph-legend">
        <span><span className="pnl-legend-swatch pnl-legend-bar-pos" /> Per-position PnL</span>
        <span><span className="pnl-legend-swatch pnl-legend-line" /> Cumulative PnL</span>
        <span><span className="pnl-legend-swatch pnl-legend-dd" /> Drawdown from peak</span>
      </div>

      <p className="pnl-graph-note">
        {viewMode === 'balanced'
          ? 'Balanced view uses signed √ scaling so smaller trades stay visible. Hover bars for raw values.'
          : 'Raw view uses true proportional bar heights. Hover bars for exact values.'}
        {' · '}{data.length} positions, sorted by close date
      </p>
    </div>
  )
}
