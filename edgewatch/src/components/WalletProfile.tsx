import { useState, useEffect } from 'react'
import type { WalletTrade, WalletPosition } from '../types'
import {
  getWalletActivity,
  getWalletPositions,
  filterNoise,
  truncateAddress,
} from '../api/wallets'
import { formatUSD, formatDate } from '../api/polymarket'
import { computeEntryScore, type EdgeScore } from '../api/scoring'
import { loadPortfolio, createPortfolio, addSimulatedTrade, savePortfolio } from '../api/simulation'
import { watchWallet, unwatchWallet, isWatchingWallet } from '../api/watchlist'
import EdgeScoreCard from './EdgeScoreCard'

interface Props {
  address: string
  onBack: () => void
  onViewPortfolio?: () => void
}

function TradeRow({ trade, onFollow }: { trade: WalletTrade; onFollow: (t: WalletTrade) => void }) {
  const isBuy = trade.side === 'BUY'
  const time = new Date(trade.timestamp * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return (
    <div className="trade-row">
      <div className="trade-row-top">
        <span className={`side-badge ${isBuy ? 'buy' : 'sell'}`}>{trade.side}</span>
        <span className="trade-title">{trade.title}</span>
        <button className="follow-btn" onClick={() => onFollow(trade)}>
          + Paper follow
        </button>
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

export default function WalletProfile({ address, onBack, onViewPortfolio }: Props) {
  const [trades, setTrades] = useState<WalletTrade[]>([])
  const [positions, setPositions] = useState<WalletPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minSize, setMinSize] = useState(1)
  const [followMsg, setFollowMsg] = useState<string | null>(null)
  const [watching, setWatching] = useState(() => isWatchingWallet(address))
  const [score, setScore] = useState<EdgeScore | null>(null)
  const [scoreLoading, setScoreLoading] = useState(false)

  const handleToggleWatch = () => {
    const pseudonym = trades[0]?.pseudonym ?? ''
    const name = trades[0]?.name ?? ''
    if (watching) {
      unwatchWallet(address)
      setWatching(false)
    } else {
      watchWallet(address, pseudonym, name)
      setWatching(true)
    }
  }

  const handleFollow = (trade: WalletTrade) => {
    let p = loadPortfolio()
    if (!p) p = createPortfolio(1000)
    // Default paper size: 10 USDC or 1/10 of original trade, whichever is smaller
    const paperSize = Math.min(10, (trade.usdcSize ?? 10) / 10)
    const updated = addSimulatedTrade(p, trade, Math.max(1, paperSize))
    savePortfolio(updated)
    setFollowMsg(`Added to paper portfolio: ${trade.title} (${formatUSD(Math.max(1, paperSize))})`)
    setTimeout(() => setFollowMsg(null), 3000)
  }

  useEffect(() => {
    setLoading(true)
    setError(null)
    setScore(null)
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

  // Compute entry-based score after trades load (async — fetches live prices)
  useEffect(() => {
    const noisy = filterNoise(trades, minSize)
    if (noisy.length === 0) { setScore(null); return }
    setScoreLoading(true)
    computeEntryScore(noisy)
      .then(setScore)
      .catch(() => setScore(null))
      .finally(() => setScoreLoading(false))
  }, [address, minSize, trades.length])

  const filtered = filterNoise(trades, minSize)
  const marketCount = new Set(filtered.map(t => t.conditionId)).size
  const totalVol = filtered.reduce((s, t) => s + (t.usdcSize ?? 0), 0)
  const pseudonym = trades[0]?.pseudonym || ''
  const name = trades[0]?.name || ''

  const openPnl = positions.reduce((s, p) => s + (p.currentValue ?? 0), 0)
  const realizedPnl = positions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0)

  return (
    <div className="detail-page">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="back-btn" onClick={onBack}>← Back</button>
        <button
          className={`back-btn ${watching ? 'watching-active' : ''}`}
          onClick={handleToggleWatch}
        >
          {watching ? '★ Watching' : '☆ Watch wallet'}
        </button>
        {onViewPortfolio && (
          <button className="back-btn" onClick={onViewPortfolio} style={{ marginLeft: 'auto' }}>
            Paper Portfolio
          </button>
        )}
      </div>

      {followMsg && (
        <div className="follow-toast">{followMsg}</div>
      )}

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

          {(score || scoreLoading) && (
            <EdgeScoreCard score={score ?? {
              overall: 0, entryEdgeScore: 0, repeatabilityScore: 0,
              sampleConfidence: 'very_low', sampleSize: 0, pricesResolved: 0,
              marketsTraded: 0, totalVolumeUSDC: 0, avgDeltaCents: 0,
              breakdown: { positiveDeltaTrades: 0, negativeDeltaTrades: 0, unresolvedTrades: 0 }
            }} loading={scoreLoading} />
          )}

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
              <TradeRow key={`${t.transactionHash ?? i}`} trade={t} onFollow={handleFollow} />
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
