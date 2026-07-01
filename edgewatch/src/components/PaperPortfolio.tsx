import { useState } from 'react'
import {
  loadPortfolio,
  createPortfolio,
  clearPortfolio,
  computePortfolioSummary,
  refreshPortfolioPrices,
  type PaperPortfolio as Portfolio,
  type SimulatedTrade,
} from '../api/simulation'
import { buildPolymarketMarketUrl, formatUSD, formatDate, formatPercent } from '../api/polymarket'

function formatMaybe(value: string | null | undefined, fallback = '—'): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed ? trimmed : fallback
}

function formatId(value: string | null | undefined): string {
  if (!value) return '—'
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

interface Props {
  onBack: () => void
}

function TradeCard({ trade }: { trade: SimulatedTrade }) {
  const source = trade.followMeta
  const sourceTrade = trade.originalTrade
  const isBuy = sourceTrade.side === 'BUY'
  const pnlPos = trade.unrealizedPnlUSDC >= 0
  const entryDate = new Date(trade.simulatedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const refreshed = trade.lastRefreshedAt
    ? new Date(trade.lastRefreshedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null
  const priceChanged = trade.currentPrice !== trade.entryPrice
  const sourceWallet = source?.sourceWallet ?? sourceTrade.proxyWallet
  const marketUrl = source?.polymarketUrl ?? buildPolymarketMarketUrl(sourceTrade.slug || sourceTrade.eventSlug || null)

  return (
    <div className="sim-trade-card">
      <div className="trade-row-top">
        <span className={`side-badge ${isBuy ? 'buy' : 'sell'}`}>{trade.originalTrade.side}</span>
        <span className="trade-title">{source?.marketTitle ?? trade.originalTrade.title}</span>
        <span className={`pnl-badge ${pnlPos ? 'pnl-pos' : 'pnl-neg'}`}>
          {pnlPos ? '+' : ''}{formatUSD(trade.unrealizedPnlUSDC)} ({formatPercent(trade.unrealizedPnlPct, 1)})
        </span>
      </div>
      <div className="trade-row-meta">
        <span className="trade-outcome">{source?.outcome ?? trade.originalTrade.outcome}</span>
        <span className="stat vol">Paper: {formatUSD(trade.simulatedSizeUSDC)}</span>
        <span className="stat prob">Entry @ {formatPercent(trade.entryPrice, 1).replace('%', '¢')} <span className="estimate-label">(real)</span></span>
        <span className={`stat prob ${priceChanged ? (pnlPos ? 'price-up' : 'price-down') : ''}`}>
          Now @ {formatPercent(trade.currentPrice, 1).replace('%', '¢')}
          {refreshed
            ? <span className="estimate-label"> (live, {refreshed})</span>
            : <span className="estimate-label"> (not refreshed)</span>
          }
        </span>
        <span className="stat date">{entryDate}</span>
      </div>
      <div className="sim-value-row">
        <span className="stat vol">
          Est. value: {formatUSD(trade.estimatedValue)} <span className="estimate-label">(simulated)</span>
        </span>
      </div>
      <div className="trade-row-details">
        <div className="trade-detail-line">
          <strong>Source type:</strong> {source?.sourceKind ?? 'trade'}
        </div>
        <div className="trade-detail-line">
          <strong>Source trader:</strong> {sourceWallet}
          {source?.closeDate && (
            <>
              {' '}· <strong>Close date:</strong> {formatDate(source.closeDate)}
            </>
          )}
        </div>
        {marketUrl ? (
          <div className="trade-detail-line">
            <strong>Polymarket:</strong>{' '}
            <a className="poly-link" href={marketUrl} target="_blank" rel="noopener noreferrer">
              Open market ↗
            </a>
          </div>
        ) : (
          <div className="trade-detail-line">
            <strong>Polymarket:</strong> market URL unavailable, showing IDs below
          </div>
        )}
        <div className="trade-detail-line">
          <strong>Condition:</strong> {formatId(source?.conditionId ?? sourceTrade.conditionId)}
        </div>
        <div className="trade-detail-line">
          <strong>Token / asset:</strong> {formatId(source?.tokenId ?? sourceTrade.asset)}
        </div>
        <div className="trade-detail-line">
          <strong>Source label:</strong> {formatMaybe(source?.sourceLabel ?? 'Polymarket public API')}
        </div>
        <div className="trade-detail-line">
          <strong>Source endpoint:</strong> {formatMaybe(source?.sourceEndpoint)}
        </div>
      </div>
    </div>
  )
}

export default function PaperPortfolioPage({ onBack }: Props) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(loadPortfolio)
  const [balance, setBalance] = useState('1000')
  const [refreshing, setRefreshing] = useState(false)
  const showSetup = portfolio === null

  const handleCreate = () => {
    const b = parseFloat(balance)
    if (!b || b <= 0) return
    const p = createPortfolio(b)
    setPortfolio(p)
  }

  const handleClear = () => {
    if (!confirm('Reset paper portfolio? All simulated trades will be lost.')) return
    clearPortfolio()
    setPortfolio(null)
  }

  const handleRefresh = async () => {
    if (!portfolio || refreshing) return
    setRefreshing(true)
    try {
      const updated = await refreshPortfolioPrices(portfolio)
      setPortfolio(updated)
    } finally {
      setRefreshing(false)
    }
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
  const lastRefreshTime = summary.lastRefreshedAt
    ? new Date(summary.lastRefreshedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null

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
        <strong>Simulated paper portfolio</strong> · No real money · No wallet connection ·
        PnL uses live CLOB prices after refresh · Simulated only, not financial advice
      </div>

      <div className="wallet-stats-row">
        <div className="wallet-stat">
          <span className="wallet-stat-val">{formatUSD(portfolio.startingBalance)}</span>
          <span className="wallet-stat-label">Starting</span>
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
          <span className="wallet-stat-label">Mark-to-Market PnL</span>
        </div>
        <div className="wallet-stat">
          <span className={`wallet-stat-val ${pnlPos ? 'pnl-pos' : 'pnl-neg'}`}>
            {pnlPos ? '+' : ''}{formatPercent(summary.pnlPct, 1)}
          </span>
          <span className="wallet-stat-label">Return</span>
        </div>
      </div>

      <p className="score-footnote" style={{ marginBottom: 16 }}>
        Mark-to-market PnL = (current CLOB price × shares) − invested.
        Entry prices are real (from the trade you followed). Current prices are fetched live on refresh.
        Values are simulated — no real funds involved.
      </p>

      <div className="section-header" style={{ marginBottom: 12 }}>
        <h3 className="markets-list-title">
          Active paper follows ({summary.openPositions})
          {lastRefreshTime && (
            <span className="estimate-label" style={{ fontWeight: 400, marginLeft: 8 }}>
              · prices as of {lastRefreshTime}
            </span>
          )}
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="search-btn"
            style={{ fontSize: '0.8rem', padding: '5px 12px' }}
            onClick={handleRefresh}
            disabled={refreshing || summary.openPositions === 0}
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh prices'}
          </button>
          <button className="back-btn" style={{ fontSize: '0.8rem' }} onClick={handleClear}>
            Reset
          </button>
        </div>
      </div>

      {portfolio.trades.length === 0 && (
        <p className="empty-msg">
          No simulated follows yet. Browse markets → Traders → open a wallet and click "+ Paper follow this position".
        </p>
      )}

      {portfolio.trades.map((t, i) => (
        <TradeCard key={i} trade={t} />
      ))}
    </div>
  )
}
