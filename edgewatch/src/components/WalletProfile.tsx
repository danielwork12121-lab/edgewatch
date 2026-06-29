import { useState, useEffect, useCallback } from 'react'
import type { WalletTrade, WalletPosition } from '../types'
import { getWalletActivity, getWalletPositions, filterNoise, truncateAddress } from '../api/wallets'
import { formatUSD, formatDate } from '../api/polymarket'
import { computeEntryScore, type EdgeScore } from '../api/scoring'
import { loadPortfolio, createPortfolio, addSimulatedTrade, savePortfolio } from '../api/simulation'
import { watchWallet, unwatchWallet, isWatchingWallet } from '../api/watchlist'
import { cacheGet, cacheSet, cacheTime, cacheInvalidate, TTL, formatAge } from '../api/cache'
import EdgeScoreCard from './EdgeScoreCard'
import PriceChart from './PriceChart'
import PnLGraph from './PnLGraph'
import CopyTradingModule from './CopyTradingModule'

interface Props {
  address: string
  onBack: () => void
  onViewPortfolio?: () => void
}

type ProfileTab = 'overview' | 'trades' | 'charts'

// Lazy chart — only mounts PriceChart (and triggers fetchPriceHistory) when user opens it
function LazyChart({ tokenId, trades, title }: { tokenId: string; trades: WalletTrade[]; title: string }) {
  const [opened, setOpened] = useState(false)
  return (
    <div className="lazy-chart-wrap">
      <button
        type="button"
        className="lazy-chart-trigger"
        onClick={() => setOpened(o => !o)}
      >
        <span className="lazy-chart-arrow">{opened ? '▲' : '▼'}</span>
        <span className="lazy-chart-title">{title}</span>
        {!opened && <span className="estimate-label"> · click to load</span>}
      </button>
      {opened && (
        <PriceChart tokenId={tokenId} trades={trades} title={title} />
      )}
    </div>
  )
}

function TradeRow({
  trade,
  onFollow,
  allTradesForMarket,
}: {
  trade: WalletTrade
  onFollow: (t: WalletTrade) => void
  allTradesForMarket: WalletTrade[]
}) {
  const [chartOpen, setChartOpen] = useState(false)
  const isBuy = trade.side === 'BUY'
  const time = new Date(trade.timestamp * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const tokenId = trade.asset ?? ''

  return (
    <div className="trade-row">
      <div className="trade-row-top">
        <span className={`side-badge ${isBuy ? 'buy' : 'sell'}`}>{trade.side}</span>
        <span className="trade-title">{trade.title}</span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
          <button className="follow-btn" onClick={() => onFollow(trade)}>+ Follow</button>
          {tokenId && (
            <button
              className="follow-btn"
              style={{ background: 'none', borderColor: 'var(--border)', color: 'var(--text)' }}
              onClick={() => setChartOpen(o => !o)}
            >
              {chartOpen ? '▲' : '▼'} Chart
            </button>
          )}
        </div>
      </div>
      <div className="trade-row-meta">
        <span className="trade-outcome">{trade.outcome}</span>
        <span className="stat vol">{formatUSD(trade.usdcSize ?? 0)}</span>
        <span className="stat prob">@ {((trade.price ?? 0) * 100).toFixed(0)}¢</span>
        <span className="stat date">{time}</span>
      </div>
      {chartOpen && tokenId && (
        <div style={{ marginTop: 12 }}>
          <PriceChart
            tokenId={tokenId}
            trades={allTradesForMarket}
            title={`${trade.outcome} — ${trade.title}`}
          />
        </div>
      )}
    </div>
  )
}

export default function WalletProfile({ address, onBack, onViewPortfolio }: Props) {
  const [trades, setTrades] = useState<WalletTrade[]>([])
  const [positions, setPositions] = useState<WalletPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minSize, setMinSize] = useState(1)
  const [tab, setTab] = useState<ProfileTab>('overview')
  const [followMsg, setFollowMsg] = useState<string | null>(null)
  const [watching, setWatching] = useState(() => isWatchingWallet(address))
  const [score, setScore] = useState<EdgeScore | null>(null)
  const [scoreLoading, setScoreLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  const actKey = `wallet:${address}:activity`
  const posKey = `wallet:${address}:positions`

  const loadWalletData = useCallback((forceRefresh = false) => {
    if (!forceRefresh) {
      const cachedAct = cacheGet<WalletTrade[]>(actKey, TTL.wallet)
      const cachedPos = cacheGet<WalletPosition[]>(posKey, TTL.wallet)
      if (cachedAct !== null && cachedPos !== null) {
        setTrades(cachedAct)
        setPositions(cachedPos)
        setLastUpdated(Math.min(cacheTime(actKey) ?? Date.now(), cacheTime(posKey) ?? Date.now()))
        setLoading(false)
        return
      }
    }
    setLoading(true)
    setError(null)
    Promise.all([
      getWalletActivity(address, 200),
      getWalletPositions(address, 100),
    ])
      .then(([acts, pos]) => {
        cacheSet(actKey, acts)
        cacheSet(posKey, pos)
        setTrades(acts)
        setPositions(pos)
        setLastUpdated(Date.now())
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [address, actKey, posKey])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadWalletData()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadWalletData])

  // 30-second polling — only re-fetches when TTL expires (3min); otherwise uses cache
  useEffect(() => {
    const timer = setInterval(() => loadWalletData(), 30_000)
    return () => clearInterval(timer)
  }, [loadWalletData])

  // Re-score whenever trades or size filter changes (prices may be cached for 30s)
  useEffect(() => {
    const noisy = filterNoise(trades, minSize)
    const timer = window.setTimeout(() => {
      if (noisy.length === 0) {
        setScore(null)
        setScoreLoading(false)
        return
      }
      setScoreLoading(true)
      computeEntryScore(noisy)
        .then(setScore)
        .catch(() => setScore(null))
        .finally(() => setScoreLoading(false))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [minSize, trades])

  const handleRefresh = useCallback(() => {
    cacheInvalidate(actKey, posKey)
    setScore(null)
    loadWalletData(true)
  }, [actKey, posKey, loadWalletData])

  const handleToggleWatch = () => {
    const pseudonym = trades[0]?.pseudonym ?? ''
    const name = trades[0]?.name ?? ''
    if (watching) { unwatchWallet(address); setWatching(false) }
    else { watchWallet(address, pseudonym, name); setWatching(true) }
  }

  const handleFollow = (trade: WalletTrade) => {
    let p = loadPortfolio()
    if (!p) p = createPortfolio(1000)
    const paperSize = Math.max(1, Math.min(10, (trade.usdcSize ?? 10) / 10))
    savePortfolio(addSimulatedTrade(p, trade, paperSize))
    setFollowMsg(`Followed: ${trade.title} (Paper ${formatUSD(paperSize)})`)
    setTimeout(() => setFollowMsg(null), 3500)
  }

  const filtered = filterNoise(trades, minSize)
  const marketCount = new Set(filtered.map(t => t.conditionId)).size
  const totalVol = filtered.reduce((s, t) => s + (t.usdcSize ?? 0), 0)
  const pseudonym = trades[0]?.pseudonym || ''
  const name = trades[0]?.name || ''

  const positionsWithValue = positions.filter(p => (p.initialValue ?? 0) > 0)
  const realizedPnl = positions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0)
  const openValue = positions.reduce((s, p) => s + (p.currentValue ?? 0), 0)
  const wins = positionsWithValue.filter(p => (p.cashPnl ?? 0) >= 0).length
  const winRate = positionsWithValue.length > 0 ? wins / positionsWithValue.length : null

  return (
    <div className="detail-page">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="back-btn" onClick={onBack}>← Back</button>
        <button
          type="button"
          className={`back-btn ${watching ? 'watching-active' : ''}`}
          onClick={handleToggleWatch}
        >
          {watching ? '★ Watching' : '☆ Watch wallet'}
        </button>
        <div className="refresh-bar" style={{ marginLeft: 'auto' }}>
          {lastUpdated && <span className="last-updated">{formatAge(lastUpdated)}</span>}
          <button
            type="button"
            className="refresh-btn"
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh wallet data"
          >
            {loading ? '↻' : '↻ Refresh'}
          </button>
        </div>
        {onViewPortfolio && (
          <button className="back-btn" onClick={onViewPortfolio} style={{ marginLeft: 'auto' }}>
            Portfolio
          </button>
        )}
      </div>

      {followMsg && <div className="follow-toast">{followMsg}</div>}

      <div className="wallet-header">
        <h2 className="detail-title">{pseudonym || name || truncateAddress(address)}</h2>
        {(pseudonym || name) && <p className="wallet-address">{truncateAddress(address)}</p>}
      </div>

      {loading && <p className="empty-msg">Loading wallet data…</p>}
      {error && <p className="error-msg">{error}</p>}

      {!loading && !error && (
        <>
          {/* ── Copy Trading Module — top of page ── */}
          <CopyTradingModule
            score={score}
            trades={filtered}
            winRate={winRate}
            onViewPortfolio={onViewPortfolio}
            onFollowMsg={msg => { setFollowMsg(msg); setTimeout(() => setFollowMsg(null), 4000) }}
          />

          <div className="data-source-label">
            Polymarket public API · {filtered.length} trades · {positionsWithValue.length} positions
          </div>

          {/* ── Stats row ── */}
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
            {winRate !== null && (
              <div className="wallet-stat">
                <span className={`wallet-stat-val ${winRate >= 0.5 ? 'pnl-pos' : 'pnl-neg'}`}>
                  {(winRate * 100).toFixed(0)}%
                </span>
                <span className="wallet-stat-label">Win Rate</span>
              </div>
            )}
            <div className="wallet-stat">
              <span className={`wallet-stat-val ${realizedPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
                {realizedPnl >= 0 ? '+' : ''}{formatUSD(realizedPnl)}
              </span>
              <span className="wallet-stat-label">Realized PnL</span>
            </div>
            <div className="wallet-stat">
              <span className={`wallet-stat-val ${openValue >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
                {formatUSD(openValue)}
              </span>
              <span className="wallet-stat-label">Open Value</span>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div className="tab-bar">
            <button className={`tab-btn ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
              Performance
            </button>
            <button type="button" className={`tab-btn ${tab === 'trades' ? 'active' : ''}`} onClick={() => setTab('trades')}>
              Trade History ({filtered.length})
            </button>
            <button type="button" className={`tab-btn ${tab === 'charts' ? 'active' : ''}`} onClick={() => setTab('charts')}>
              Entry Charts
            </button>
          </div>

          {/* ── Performance tab: EdgeScore + PnL graph + positions ── */}
          {tab === 'overview' && (
            <>
              {(score || scoreLoading) && (
                <EdgeScoreCard
                  score={score ?? {
                    overall: 0, entryEdgeScore: 0, repeatabilityScore: 0,
                    sampleConfidence: 'very_low', sampleSize: 0, pricesResolved: 0,
                    marketsTraded: 0, totalVolumeUSDC: 0, avgDeltaCents: 0,
                    breakdown: { positiveDeltaTrades: 0, negativeDeltaTrades: 0, unresolvedTrades: 0 },
                  }}
                  loading={scoreLoading}
                />
              )}

              {positionsWithValue.length > 0 && (
                <section className="wallet-section">
                  <h3 className="markets-list-title">PnL History ({positionsWithValue.length} positions)</h3>
                  <PnLGraph positions={positionsWithValue} />
                </section>
              )}

              {positions.length > 0 && (
                <section className="wallet-section">
                  <h3 className="markets-list-title">Open Positions ({positions.length})</h3>
                  {positions.map(pos => (
                    <div key={pos.asset} className="position-row">
                      <div className="position-top">
                        <span className="trade-title">{pos.title}</span>
                        <span className={`pnl-badge ${(pos.cashPnl ?? 0) >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
                          {(pos.cashPnl ?? 0) >= 0 ? '+' : ''}{formatUSD(pos.cashPnl ?? 0)}
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
            </>
          )}

          {/* ── Trade History tab ── */}
          {tab === 'trades' && (
            <section className="wallet-section">
              <div className="section-header">
                <h3 className="markets-list-title">Trade History</h3>
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
              {filtered.length === 0 && <p className="empty-msg">No trades above the size filter.</p>}
              {filtered.slice(0, 100).map((t, i) => (
                <TradeRow
                  key={t.transactionHash ?? i}
                  trade={t}
                  onFollow={handleFollow}
                  allTradesForMarket={filtered.filter(x => x.conditionId === t.conditionId)}
                />
              ))}
              {filtered.length > 100 && (
                <p className="empty-msg">Showing first 100 of {filtered.length} trades.</p>
              )}
            </section>
          )}

          {/* ── Entry Charts tab: lazy-loaded per market ── */}
          {tab === 'charts' && (
            <section className="wallet-section">
              <p className="score-disclaimer" style={{ marginBottom: 12 }}>
                Charts load individually on click. Price history is cached for 10 minutes.
              </p>
              {(() => {
                const seen = new Set<string>()
                const markets: { conditionId: string; asset: string; title: string; trades: WalletTrade[] }[] = []
                for (const t of filtered) {
                  if (!seen.has(t.conditionId) && t.asset) {
                    seen.add(t.conditionId)
                    markets.push({
                      conditionId: t.conditionId,
                      asset: t.asset,
                      title: t.title,
                      trades: filtered.filter(x => x.conditionId === t.conditionId),
                    })
                  }
                }
                if (markets.length === 0) return <p className="empty-msg">No chart data available.</p>
                return markets.slice(0, 10).map(m => (
                  <LazyChart
                    key={m.conditionId}
                    tokenId={m.asset}
                    trades={m.trades}
                    title={m.title}
                  />
                ))
              })()}
            </section>
          )}
        </>
      )}
    </div>
  )
}
