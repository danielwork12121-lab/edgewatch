import { useState, useEffect, useCallback } from 'react'
import type { WalletTrade, WalletPosition } from '../types'
import { getWalletActivity, getWalletPositions, filterNoise, truncateAddress } from '../api/wallets'
import { formatUSD, formatDate, formatPercent, toFiniteNumber } from '../api/polymarket'
import { computeEntryScore, type EdgeScore } from '../api/scoring'
import { batchFetchPrices } from '../api/priceTracker'
import { analyzeTraderReliability } from '../api/traders'
import { assessPositionFollowability, computeRepeatableTraderQuality } from '../api/traderQuality'
import { getClosedPositions } from '../api/wallets'
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
  currentPrice,
}: {
  trade: WalletTrade
  onFollow: (t: WalletTrade) => void
  allTradesForMarket: WalletTrade[]
  currentPrice: number | null
}) {
  const [chartOpen, setChartOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const isBuy = trade.side === 'BUY'
  const time = new Date(trade.timestamp * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const tokenId = trade.asset ?? ''
  const entryPrice = toFiniteNumber(trade.price, Number.NaN)
  const current = currentPrice !== null ? currentPrice : null
  const delta = current !== null && Number.isFinite(entryPrice)
    ? (isBuy ? current - entryPrice : entryPrice - current)
    : null
  const helpedReliability = delta !== null ? delta > 0 : null
  const marketLabel = trade.eventSlug || trade.slug || trade.title
  const currentLabel = current !== null ? formatPercent(current, 1).replace('%', '¢') : '—'

  return (
    <div
      className="trade-row trade-row-clickable"
      role="button"
      tabIndex={0}
      onClick={() => setExpanded(o => !o)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setExpanded(o => !o)
        }
      }}
    >
      <div className="trade-row-top">
        <span className={`side-badge ${isBuy ? 'buy' : 'sell'}`}>{trade.side}</span>
        <span className="trade-title">{trade.title}</span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
          <button className="follow-btn" onClick={e => { e.stopPropagation(); onFollow(trade) }}>+ Follow</button>
          {tokenId && (
            <button
              className="follow-btn"
              style={{ background: 'none', borderColor: 'var(--border)', color: 'var(--text)' }}
              onClick={e => { e.stopPropagation(); setChartOpen(o => !o) }}
            >
              {chartOpen ? '▲' : '▼'} Chart
            </button>
          )}
        </div>
      </div>
      <div className="trade-row-meta">
        <span className="trade-outcome">{trade.outcome}</span>
        <span className="stat vol">{formatUSD(trade.usdcSize ?? 0)}</span>
        <span className="stat prob">@ {formatPercent(trade.price, 0).replace('%', '¢')}</span>
        <span className="stat date">{time}</span>
      </div>
      {expanded && (
        <div className="trade-row-details">
          <div className="trade-detail-line"><strong>Market:</strong> {marketLabel}</div>
          <div className="trade-detail-line">
            <strong>Entry:</strong> {formatPercent(entryPrice, 1).replace('%', '¢')} · <strong>Current:</strong> {currentLabel}
          </div>
          <div className="trade-detail-line">
            <strong>Reliability impact:</strong> {helpedReliability === null ? 'Unavailable' : helpedReliability ? 'Helped reliability' : 'Hurt reliability'}
          </div>
          {delta !== null && (
            <div className={`trade-detail-line ${delta >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
              <strong>Estimated PnL:</strong> {delta >= 0 ? '+' : ''}{formatUSD(Math.abs(delta) * (trade.usdcSize ?? 0))}
            </div>
          )}
        </div>
      )}
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

function CurrentPositionRow({
  position,
  copyRiskLabel,
}: {
  position: WalletPosition
  copyRiskLabel: string
}) {
  const shares = toFiniteNumber(position.size, 0)
  const entry = formatPercent(position.avgPrice, 1).replace('%', '¢')
  const current = position.curPrice !== undefined ? formatPercent(position.curPrice, 1).replace('%', '¢') : '—'
  const value = formatUSD(position.currentValue ?? 0)
  const pnl = toFiniteNumber(position.cashPnl ?? position.realizedPnl, 0)
  const pnlPos = pnl >= 0
  const label = position.redeemable ? 'Open position' : 'Active bet'

  return (
    <div className="position-row">
      <div className="position-top">
        <span className="trade-title">{position.title}</span>
        <span className={`pnl-badge ${pnlPos ? 'pnl-pos' : 'pnl-neg'}`}>
          {pnlPos ? '+' : ''}{formatUSD(pnl)}
        </span>
      </div>
      <div className="trade-row-meta">
        <span className="trade-outcome">{position.outcome}</span>
        <span className="stat vol">{shares.toFixed(0)} shares</span>
        <span className="stat prob">Entry {entry}</span>
        <span className="stat prob">Current {current}</span>
        <span className="stat vol">Value {value}</span>
        <span className="stat date">Closes {formatDate(position.endDate)}</span>
        <span className="stat date">{label}</span>
        <span className={`stat date ${pnlPos ? 'pnl-pos' : 'pnl-neg'}`}>{copyRiskLabel}</span>
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
  const [tab, setTab] = useState<ProfileTab>('overview')
  const [followMsg, setFollowMsg] = useState<string | null>(null)
  const [watching, setWatching] = useState(() => isWatchingWallet(address))
  const [score, setScore] = useState<EdgeScore | null>(null)
  const [scoreLoading, setScoreLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [livePrices, setLivePrices] = useState<Map<string, number>>(new Map())
  const [positionsError, setPositionsError] = useState<string | null>(null)
  const [closedPositions, setClosedPositions] = useState<Awaited<ReturnType<typeof getClosedPositions>>>([])

  const actKey = `wallet:${address}:activity`
  const posKey = `wallet:${address}:positions`

  const loadWalletData = useCallback((forceRefresh = false) => {
    if (!forceRefresh) {
      const cachedAct = cacheGet<WalletTrade[]>(actKey, TTL.wallet)
      const cachedPos = cacheGet<WalletPosition[]>(posKey, TTL.wallet)
      if (cachedAct !== null && cachedPos !== null) {
        setTrades(cachedAct)
        setPositions(cachedPos)
        setPositionsError(null)
        setLastUpdated(Math.min(cacheTime(actKey) ?? Date.now(), cacheTime(posKey) ?? Date.now()))
        setLoading(false)
        return
      }
    }
    setLoading(true)
    setError(null)
    setPositionsError(null)
    Promise.allSettled([
      getWalletActivity(address, 200),
      getWalletPositions(address, 100),
      getClosedPositions(address, 100),
    ])
      .then(([actsResult, posResult, closedResult]) => {
        if (actsResult.status === 'fulfilled') {
          cacheSet(actKey, actsResult.value)
          setTrades(actsResult.value)
        } else {
          setError('Wallet activity unavailable from public API.')
        }

        if (posResult.status === 'fulfilled') {
          cacheSet(posKey, posResult.value)
          setPositions(posResult.value)
          setPositionsError(null)
        } else {
          setPositions([])
          setPositionsError('Current positions unavailable from public API.')
        }

        if (closedResult.status === 'fulfilled') {
          setClosedPositions(closedResult.value)
        } else {
          setClosedPositions([])
        }
        setLastUpdated(Date.now())
      })
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

  useEffect(() => {
    const assets = [...new Set(filtered.map(t => t.asset).filter(Boolean))].slice(0, 20)
    if (assets.length === 0) return
    let cancelled = false
    batchFetchPrices(assets)
      .then(map => {
        if (!cancelled) setLivePrices(map)
      })
      .catch(() => {
        if (!cancelled) setLivePrices(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [filtered])

  const reliability = analyzeTraderReliability(filtered, positions, livePrices)
  const traderQuality = computeRepeatableTraderQuality({
    trades: filtered,
    recentTrades: filtered.slice(0, 40),
    positions,
    closedPositions,
    priceMap: livePrices,
  })

  const positionsWithValue = positions.filter(p => (p.initialValue ?? 0) > 0)
  const realizedPnl = positions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0)
  const openValue = positions.reduce((s, p) => s + (p.currentValue ?? 0), 0)
  const wins = positionsWithValue.filter(p => (p.cashPnl ?? 0) >= 0).length
  const winRate = positionsWithValue.length > 0 ? wins / positionsWithValue.length : null
  const activePositions = positions.filter(p => (p.initialValue ?? 0) > 0 || (p.currentValue ?? 0) > 0 || p.redeemable === false)
  const positionFollowLabel = (position: WalletPosition) =>
    assessPositionFollowability(position, traderQuality)

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
      {positionsError && <p className="error-msg">{positionsError}</p>}

      {!loading && !error && (
        <>
          <section className="wallet-section">
            <div className="section-header">
              <h3 className="markets-list-title">Current Open Positions ({activePositions.length})</h3>
              <span className="estimate-label">Active bets held right now</span>
            </div>
            {activePositions.length === 0 && !positionsError && (
              <p className="empty-msg">No current open positions found from public API.</p>
            )}
            {activePositions.length > 0 && (
              <>
                {(reliability?.realizedPnl ?? 0) < 0 && openValue > Math.abs(reliability?.realizedPnl ?? 0) * 2 && (
                  <p className="score-disclaimer" style={{ marginBottom: 10 }}>
                    Large exposure with poor realized history.
                  </p>
                )}
                {activePositions.slice(0, 12).map(position => (
                  <CurrentPositionRow
                    key={position.asset}
                    position={position}
                    copyRiskLabel={positionFollowLabel(position)}
                  />
                ))}
                {activePositions.length > 12 && (
                  <p className="empty-msg">Showing first 12 active positions.</p>
                )}
              </>
            )}
          </section>

          {/* ── Copy Trading Module — top of page ── */}
          <CopyTradingModule
            score={score}
            trades={filtered}
            winRate={winRate}
            reliability={reliability}
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
                  {formatPercent(winRate, 0)}
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
            <span className="wallet-stat-label">Open Value (unresolved exposure)</span>
          </div>
          </div>

          <p className="score-disclaimer" style={{ marginTop: -4, marginBottom: 12 }}>
            Win Rate = percentage of closed positions that ended profitable. Realized PnL = profit/loss from closed positions.
            Open Value = current value of unresolved/open positions, not profit. Entry Edge = estimated price movement after entry.
            Live-priced trades = trades where current CLOB price was available.
          </p>

          <div className="data-source-label" style={{ marginBottom: 16 }}>
            <strong>{traderQuality.tier === 'reliable' ? 'Reliable candidate' : traderQuality.tier === 'watch' ? 'Strong watch candidate' : traderQuality.tier === 'emerging' ? 'Emerging trader' : traderQuality.rejectionReason || reliability?.reliabilityLabel}</strong>
            {' · '}
            Quality {traderQuality.qualityScore}/100
            {' · '}
            {traderQuality.backtest.label}
            {traderQuality.luckyWinRisk ? ' · Lucky win risk flagged' : ''}
            {traderQuality.outlierDriven ? ' · Outlier-driven profit' : ''}
          </div>

          {traderQuality.plainReasons.length > 0 && (
            <ul className="hot-trader-reasons" style={{ marginBottom: 16 }}>
              {traderQuality.plainReasons.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          )}

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
                  currentPrice={livePrices.get(t.asset) ?? null}
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
