import { useState, useEffect } from 'react'
import {
  loadPortfolio,
  createPortfolio,
  clearPortfolio,
  computePortfolioSummary,
  type PaperPortfolio as Portfolio,
  type SimulatedTrade,
} from '../api/simulation'
import { formatUSD, formatDate } from '../api/polymarket'

interface Props {
  onBack: () => void
}

function TradeCard({ trade }: { trade: SimulatedTrade }) {
  const isBuy = trade.originalTrade.side === 'BUY'
  const pnlPos = trade.unrealizedPnlUSDC >= 0
  const entryDate = new Date(trade.simulatedAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return (
    <div className="sim-trade-card">
      <div className="trade-row-top">
        <span className={`side-badge ${isBuy ? 'buy' : 'sell'}`}>{trade.originalTrade.side}</span>
        <span className="trade-title">{trade.originalTrade.title}</span>
        <span className={`pnl-badge ${pnlPos ? 'pnl-pos' : 'pnl-neg'}`}>
          {pnlPos ? '+' : ''}{formatUSD(trade.unrealizedPnlUSDC)} ({trade.unrealizedPnlPct.toFixed(1)}%)
        </span>
      </div>
      <div className="trade-row-meta">
        <span className="trade-outcome">{trade.originalTrade.outcome}</span>
        <span className="stat vol">Paper: {formatUSD(trade.simulatedSizeUSDC)}</span>
        <span className="stat prob">Entry @ {(trade.entryPrice * 100).toFixed(0)}¢</span>
        <span className="stat prob">Now @ {(trade.currentPrice * 100).toFixed(0)}¢ <span className="estimate-label">(estimated)</span></span>
        <span className="stat date">{entryDate}</span>
      </div>
      <div className="sim-value-row">
        <span className="stat vol">Est. value: {formatUSD(trade.estimatedValue)} <span className="estimate-label">(simulated)</span></span>
      </div>
    </div>
  )
}

export default function PaperPortfolioPage({ onBack }: Props) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [balance, setBalance] = useState('1000')
  const [showSetup, setShowSetup] = useState(false)

  useEffect(() => {
    const p = loadPortfolio()
    if (p) setPortfolio(p)
    else setShowSetup(true)
  }, [])

  const handleCreate = () => {
    const b = parseFloat(balance)
    if (!b || b <= 0) return
    const p = createPortfolio(b)
    setPortfolio(p)
    setShowSetup(false)
  }

  const handleClear = () => {
    if (!confirm('Reset paper portfolio? All simulated trades will be lost.')) return
    clearPortfolio()
    setPortfolio(null)
    setShowSetup(true)
  }

  if (showSetup || !portfolio) {
    return (
      <div className="detail-page">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h2 className="detail-title">Paper Portfolio Setup</h2>
        <div className="sim-setup-card">
          <p className="score-disclaimer">
            Paper mode lets you simulate following wallet trades without real money.
            <br />
            <strong>Simulated only — no real trades, no real funds, no wallet connection.</strong>
          </p>
          <div className="setup-row">
            <label className="filter-label">Starting balance (USDC):</label>
            <input
              className="search-input"
              style={{ maxWidth: 140 }}
              type="number"
              min="10"
              max="100000"
              value={balance}
              onChange={e => setBalance(e.target.value)}
            />
          </div>
          <button className="search-btn" style={{ marginTop: 12 }} onClick={handleCreate}>
            Create Paper Portfolio
          </button>
        </div>
      </div>
    )
  }

  const summary = computePortfolioSummary(portfolio)
  const pnlPos = summary.totalPnl >= 0

  return (
    <div className="detail-page">
      <button className="back-btn" onClick={onBack}>← Back</button>

      <div className="detail-header">
        <div>
          <h2 className="detail-title">{portfolio.label}</h2>
          <div className="detail-meta">
            <span className="stat date">Started {formatDate(new Date(portfolio.createdAt).toISOString())}</span>
          </div>
        </div>
      </div>

      <div className="data-source-label">
        <strong>Simulated paper portfolio</strong> · No real money · No wallet connection
      </div>

      <div className="wallet-stats-row">
        <div className="wallet-stat">
          <span className="wallet-stat-val">{formatUSD(portfolio.startingBalance)}</span>
          <span className="wallet-stat-label">Starting Balance</span>
        </div>
        <div className="wallet-stat">
          <span className="wallet-stat-val">{formatUSD(summary.totalInvested)}</span>
          <span className="wallet-stat-label">Invested</span>
        </div>
        <div className="wallet-stat">
          <span className="wallet-stat-val">{formatUSD(summary.remainingBalance)}</span>
          <span className="wallet-stat-label">Remaining</span>
        </div>
        <div className="wallet-stat">
          <span className={`wallet-stat-val ${pnlPos ? 'pnl-pos' : 'pnl-neg'}`}>
            {pnlPos ? '+' : ''}{formatUSD(summary.totalPnl)}
          </span>
          <span className="wallet-stat-label">Est. PnL <span className="estimate-label">(sim)</span></span>
        </div>
        <div className="wallet-stat">
          <span className={`wallet-stat-val ${pnlPos ? 'pnl-pos' : 'pnl-neg'}`}>
            {pnlPos ? '+' : ''}{summary.pnlPct.toFixed(1)}%
          </span>
          <span className="wallet-stat-label">Return</span>
        </div>
      </div>

      <p className="score-footnote" style={{ marginBottom: 24 }}>
        All values are simulated estimates using entry price at time of "follow". Current prices
        reflect the entry price (no live refresh). PnL is estimated, not real.
      </p>

      <div className="section-header" style={{ marginBottom: 12 }}>
        <h3 className="markets-list-title">
          Open Positions ({summary.openPositions})
        </h3>
        <button className="back-btn" style={{ fontSize: '0.8rem' }} onClick={handleClear}>
          Reset portfolio
        </button>
      </div>

      {portfolio.trades.length === 0 && (
        <p className="empty-msg">
          No simulated trades yet. Browse markets → Traders → open a wallet and click "Follow trade (paper)".
        </p>
      )}

      {portfolio.trades.map((t, i) => (
        <TradeCard key={i} trade={t} />
      ))}
    </div>
  )
}
