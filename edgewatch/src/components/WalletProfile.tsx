import { useState, useEffect } from 'react'
import type { WalletTrade, WalletPosition, PolyEvent } from '../types'
import {
  getWalletActivity,
  getWalletPositions,
  filterNoise,
  groupTradesByMarket,
  truncateAddress,
} from '../api/wallets'
import { formatUSD, formatDate } from '../api/polymarket'
import { scoreWallet } from '../api/scoring'
import EdgeScoreCard from './EdgeScoreCard'

interface Props {
  address: string
  onBack: () => void
  onSelectEvent?: (event: PolyEvent) => void
}

function TradeRow({ trade }: { trade: WalletTrade }) {
  const isBuy = trade.side === 'BUY'
  const time = new Date(trade.timestamp * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return (
    <div className="trade-row">
      <div className="trade-row-top">
        <span className={`side-badge ${isBuy ? 'buy' : 'sell'}`}>{trade.side}</span>
        <span className="trade-title">{trade.title}</span>
      </div>
      <div className="trade-row-meta">
        <span className="trade-outcome">{trade.outcome}</span>
        <span className="stat vol">{formatUSD(trade.usdcSize ?? 0)}</span>
        <span className="stat prob">@ {((trade.price ?? 0) * 100).toFixed(0)}¢</span>
        <span className="stat date">{time}</span>
      </div>
    </div>
  )
}

export default function WalletProfile({ address, onBack }: Props) {
  const [trades, setTrades] = useState<WalletTrade[]>([])
  const [positions, setPositions] = useState<WalletPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minSize, setMinSize] = useState(1)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      getWalletActivity(address, 200),
      getWalletPositions(address, 50),
    ])
      .then(([acts, pos]) => {
        setTrades(acts)
        setPositions(pos)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [address])

  const filtered = filterNoise(trades, minSize)
  const byMarket = groupTradesByMarket(filtered)
  const marketCount = byMarket.size
  const totalVol = filtered.reduce((s, t) => s + (t.usdcSize ?? 0), 0)
  const pseudonym = trades[0]?.pseudonym || ''
  const name = trades[0]?.name || ''

  const openPnl = positions.reduce((s, p) => s + (p.currentValue ?? 0), 0)
  const realizedPnl = positions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0)

  return (
    <div className="detail-page">
      <button className="back-btn" onClick={onBack}>← Back</button>

      <div className="wallet-header">
        <div>
          <h2 className="detail-title">
            {pseudonym || name || truncateAddress(address)}
          </h2>
          {(pseudonym || name) && (
            <p className="wallet-address">{truncateAddress(address)}</p>
          )}
        </div>
      </div>

      {loading && <p className="empty-msg">Loading wallet data…</p>}
      {error && <p className="error-msg">{error}</p>}

      {!loading && !error && (
        <>
          <div className="data-source-label">
            Data source: <strong>Polymarket public activity API</strong> · Real trade history
          </div>

          <EdgeScoreCard score={scoreWallet(filtered, positions)} />

          <div className="wallet-stats-row">
            <div className="wallet-stat">
              <span className="wallet-stat-val">{filtered.length}</span>
              <span className="wallet-stat-label">Trades</span>
            </div>
            <div className="wallet-stat">
              <span className="wallet-stat-val">{marketCount}</span>
              <span className="wallet-stat-label">Markets</span>
            </div>
            <div className="wallet-stat">
              <span className="wallet-stat-val">{formatUSD(totalVol)}</span>
              <span className="wallet-stat-label">Volume</span>
            </div>
            <div className="wallet-stat">
              <span className={`wallet-stat-val ${realizedPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
                {realizedPnl >= 0 ? '+' : ''}{formatUSD(realizedPnl)}
              </span>
              <span className="wallet-stat-label">Realized PnL</span>
            </div>
            <div className="wallet-stat">
              <span className={`wallet-stat-val ${openPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
                {openPnl >= 0 ? '+' : ''}{formatUSD(openPnl)}
              </span>
              <span className="wallet-stat-label">Open Value</span>
            </div>
          </div>

          {positions.length > 0 && (
            <section className="wallet-section">
              <h3 className="markets-list-title">Open Positions ({positions.length})</h3>
              {positions.map(pos => (
                <div key={pos.asset} className="position-row">
                  <div className="position-top">
                    <span className="trade-title">{pos.title}</span>
                    <span className={`pnl-badge ${pos.cashPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
                      {pos.cashPnl >= 0 ? '+' : ''}{formatUSD(pos.cashPnl)}
                    </span>
                  </div>
                  <div className="trade-row-meta">
                    <span className="trade-outcome">{pos.outcome}</span>
                    <span className="stat vol">{pos.size.toFixed(0)} shares @ {((pos.avgPrice ?? 0) * 100).toFixed(0)}¢</span>
                    <span className="stat date">Closes {formatDate(pos.endDate)}</span>
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="wallet-section">
            <div className="section-header">
              <h3 className="markets-list-title">Trade History ({filtered.length})</h3>
              <div className="filter-row">
                <label className="filter-label">Min size:</label>
                <select
                  className="filter-select"
                  value={minSize}
                  onChange={e => setMinSize(Number(e.target.value))}
                >
                  <option value={0}>All</option>
                  <option value={1}>$1+</option>
                  <option value={10}>$10+</option>
                  <option value={50}>$50+</option>
                  <option value={100}>$100+</option>
                </select>
              </div>
            </div>
            {filtered.length === 0 && (
              <p className="empty-msg">No trades above the size filter.</p>
            )}
            {filtered.slice(0, 100).map((t, i) => (
              <TradeRow key={`${t.transactionHash ?? i}`} trade={t} />
            ))}
            {filtered.length > 100 && (
              <p className="empty-msg">Showing first 100 of {filtered.length} trades.</p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
