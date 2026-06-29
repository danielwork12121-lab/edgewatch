import { useState, useEffect } from 'react'
import type { PricePoint, WalletTrade } from '../types'
import { fetchPriceHistory } from '../api/priceHistory'

interface Props {
  tokenId: string
  trades: WalletTrade[]  // entry markers
  title: string
}

const W = 520
const H = 140
const PX = 28  // padding x
const PY = 14  // padding y
const IW = W - 2 * PX
const IH = H - 2 * PY

function buildPath(history: PricePoint[]): string {
  if (history.length < 2) return ''
  const minT = history[0].t
  const maxT = history[history.length - 1].t
  const tRange = maxT - minT || 1
  return history.map((pt, i) => {
    const x = PX + (pt.t - minT) / tRange * IW
    const y = PY + (1 - pt.p) * IH
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function tickLabels(history: PricePoint[]): { x: number; label: string }[] {
  if (history.length < 2) return []
  const minT = history[0].t
  const maxT = history[history.length - 1].t
  const tRange = maxT - minT || 1
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  return ticks.map(f => ({
    x: PX + f * IW,
    label: new Date((minT + f * tRange) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }))
}

export default function PriceChart({ tokenId, trades, title }: Props) {
  const [history, setHistory] = useState<PricePoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchPriceHistory(tokenId)
      .then(points => {
        if (!cancelled) setHistory(points)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [tokenId])

  if (loading) return <div className="chart-loading">Loading price chart…</div>
  if (history.length < 2) return <div className="chart-empty">No price history available</div>

  const minT = history[0].t
  const maxT = history[history.length - 1].t
  const tRange = maxT - minT || 1

  const toX = (t: number) => PX + (t - minT) / tRange * IW
  const toY = (p: number) => PY + (1 - p) * IH

  const path = buildPath(history)
  const ticks = tickLabels(history)

  // Y-axis labels: 0%, 25%, 50%, 75%, 100%
  const yTicks = [0, 0.25, 0.5, 0.75, 1]

  // Entry markers: trades within the chart time window
  const markers = trades.filter(t => t.timestamp >= minT && t.timestamp <= maxT)

  return (
    <div className="price-chart-wrap">
      <p className="chart-title">{title}</p>
      <div className="chart-legend">
        <span className="legend-dot buy-dot" /> BUY entry
        <span className="legend-dot sell-dot" style={{ marginLeft: 12 }} /> SELL entry
        <span className="estimate-label" style={{ marginLeft: 12 }}>
          Source: Polymarket CLOB · {history.length} data points
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="price-chart-svg"
        role="img"
        aria-label={`Price chart for ${title}`}
      >
        {/* Y gridlines */}
        {yTicks.map(v => (
          <g key={v}>
            <line
              x1={PX} y1={toY(v)} x2={W - PX} y2={toY(v)}
              stroke="var(--border)" strokeWidth="0.5"
            />
            <text x={PX - 4} y={toY(v) + 4} textAnchor="end" fontSize="8" fill="var(--text)">
              {(v * 100).toFixed(0)}
            </text>
          </g>
        ))}

        {/* Price line */}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />

        {/* Entry/exit markers */}
        {markers.map((t, i) => {
          const cx = toX(t.timestamp)
          const cy = toY(t.price ?? 0)
          const isBuy = t.side === 'BUY'
          const color = isBuy ? '#22c55e' : '#ef4444'
          return (
            <g key={i}>
              <line
                x1={cx} y1={PY} x2={cx} y2={H - PY}
                stroke={color} strokeWidth="1" strokeDasharray="3,2" opacity="0.6"
              />
              <circle cx={cx} cy={cy} r="4" fill={color} stroke="#fff" strokeWidth="1" />
            </g>
          )
        })}

        {/* X axis ticks */}
        {ticks.map(({ x, label }) => (
          <text key={x} x={x} y={H - 2} textAnchor="middle" fontSize="8" fill="var(--text)">
            {label}
          </text>
        ))}
      </svg>
    </div>
  )
}
