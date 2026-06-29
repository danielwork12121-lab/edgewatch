import type { WalletPosition } from '../types'
import { formatUSD } from '../api/polymarket'

interface Props {
  positions: WalletPosition[]
}

interface StreakResult {
  maxWin: number
  maxLoss: number
  currentStreak: number
  currentType: 'win' | 'loss' | null
}

function computeStreak(positions: WalletPosition[]): StreakResult {
  const sorted = [...positions]
    .filter(p => (p.initialValue ?? 0) > 0)
    .sort((a, b) => new Date(a.endDate || 0).getTime() - new Date(b.endDate || 0).getTime())

  if (sorted.length === 0) return { maxWin: 0, maxLoss: 0, currentStreak: 0, currentType: null }

  let maxWin = 0, maxLoss = 0, cur = 0
  let curType: 'win' | 'loss' | null = null

  for (const pos of sorted) {
    const type: 'win' | 'loss' = (pos.cashPnl ?? 0) >= 0 ? 'win' : 'loss'
    if (type === curType) {
      cur++
    } else {
      cur = 1
      curType = type
    }
    if (type === 'win') maxWin = Math.max(maxWin, cur)
    else maxLoss = Math.max(maxLoss, cur)
  }

  return { maxWin, maxLoss, currentStreak: cur, currentType: curType }
}

const W = 520, H = 130, PX = 32, PY = 12
const IW = W - 2 * PX, IH = H - 2 * PY

export default function PnLGraph({ positions }: Props) {
  const sorted = [...positions]
    .filter(p => (p.initialValue ?? 0) > 0)
    .sort((a, b) => new Date(a.endDate || 0).getTime() - new Date(b.endDate || 0).getTime())

  if (sorted.length === 0) {
    return <p className="empty-msg">No position history available.</p>
  }

  // Compute per-position data with running cumulative PnL and drawdown.
  const series = sorted.reduce<{
    data: Array<{
      pnl: number
      cumPnl: number
      drawdown: number
      title: string
    }>
    running: number
    peak: number
  }>((acc, pos) => {
    const pnl = pos.cashPnl ?? 0
    const running = acc.running + pnl
    const peak = Math.max(acc.peak, running)
    return {
      data: [
        ...acc.data,
        {
          pnl,
          cumPnl: running,
          drawdown: running - peak,
          title: pos.title,
        },
      ],
      running,
      peak,
    }
  }, { data: [], running: 0, peak: 0 })

  const data = series.data
  const totalPnl = series.running
  const wins = sorted.filter(p => (p.cashPnl ?? 0) >= 0).length
  const losses = sorted.length - wins
  const streak = computeStreak(positions)
  const maxAbsBar = Math.max(...data.map(d => Math.abs(d.pnl)), 0.01)
  const maxAbsCum = Math.max(...data.map(d => Math.abs(d.cumPnl)), 0.01)
  const midY = PY + IH / 2
  const n = data.length

  // Bar dimensions
  const gap = 1
  const barW = Math.max(2, (IW - gap * (n - 1)) / n)

  // Cumulative PnL line path
  const linePts = data.map((d, i) => {
    const x = PX + (i / Math.max(n - 1, 1)) * IW
    const y = midY - (d.cumPnl / maxAbsCum) * (IH / 2 - 2)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  // Drawdown fill path (below mid line)
  const ddPts = data.map((d, i) => {
    const x = PX + (i / Math.max(n - 1, 1)) * IW
    const y = midY - (d.drawdown / maxAbsCum) * (IH / 2 - 2)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  })
  const ddPath = `${ddPts.join(' ')} L${(PX + IW).toFixed(1)},${midY} L${PX},${midY} Z`

  return (
    <div className="pnl-graph-wrap">
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
            {streak.currentType === 'win' ? 'W' : streak.currentType === 'loss' ? 'L' : '—'} streak
          </span>
          <span className="pnl-sum-label">Current</span>
        </div>
        <div className="pnl-sum-stat">
          <span className="pnl-sum-val pnl-pos">{streak.maxWin}W</span>
          <span className="pnl-sum-label">Best win streak</span>
        </div>
        <div className="pnl-sum-stat">
          <span className="pnl-sum-val pnl-neg">{streak.maxLoss}L</span>
          <span className="pnl-sum-label">Worst loss streak</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="pnl-svg">
        {/* Zero / mid line */}
        <line x1={PX} y1={midY} x2={W - PX} y2={midY} stroke="var(--border)" strokeWidth="1" />

        {/* PnL bars */}
        {data.map((d, i) => {
          const x = PX + i * (barW + gap)
          const barHeight = Math.max(1, (Math.abs(d.pnl) / maxAbsBar) * (IH / 2 - 4))
          const y = d.pnl >= 0 ? midY - barHeight : midY
          return (
            <rect
              key={i}
              x={x.toFixed(1)}
              y={y.toFixed(1)}
              width={barW.toFixed(1)}
              height={barHeight.toFixed(1)}
              fill={d.pnl >= 0 ? '#22c55e' : '#ef4444'}
              opacity="0.65"
            />
          )
        })}

        {/* Drawdown fill */}
        <path d={ddPath} fill="#ef4444" opacity="0.12" />

        {/* Cumulative PnL line */}
        <path d={linePts} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      </svg>

      <p className="pnl-graph-note">
        Green/red bars = per-position PnL · Purple line = cumulative PnL ·
        Red fill = drawdown from peak · {sorted.length} positions, sorted by close date
      </p>
    </div>
  )
}
