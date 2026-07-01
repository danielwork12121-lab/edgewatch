import { useState, useEffect, useCallback } from 'react'
import type { WalletTrade, WalletPosition } from '../types'
import { getWalletActivity, getWalletPositions, filterNoise, truncateAddress } from '../api/wallets'
import { buildPolymarketMarketUrl, formatUSD, formatDate, formatPercent, toFiniteNumber } from '../api/polymarket'
import { computeEntryScore, type EdgeScore } from '../api/scoring'
import { batchFetchPrices } from '../api/priceTracker'
import { assessPositionFollowability, buildTraderPerformanceSnapshot, evaluateTraderQualityFromSnapshot } from '../api/traderQuality'
import { getClosedPositions } from '../api/wallets'
import { loadPortfolio, createPortfolio, addSimulatedTrade, addSimulatedPositionFollow, savePortfolio } from '../api/simulation'
import { watchWallet, unwatchWallet, isWatchingWallet } from '../api/watchlist'
import { cacheGet, cacheSet, cacheTime, cacheInvalidatePrefix, TTL, formatAge } from '../api/cache'
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

interface ProofField {
  label: string
  value: string
  href?: string | null
}

function truncateHash(value: string | null | undefined): string {
  if (!value) return '—'
  if (value.length <= 16) return value
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

function proofRow(field: ProofField, index: number) {
  return (
    <div className="trade-detail-line" key={`${field.label}-${index}`}>
      <strong>{field.label}:</strong>{' '}
      {field.href ? (
        <a className="poly-link" href={field.href} target="_blank" rel="noopener noreferrer">
          {field.value} ↗
        </a>
      ) : (
        <span>{field.value}</span>
      )}
    </div>
  )
}

function buildTradeProofFields(trade: WalletTrade, sourceWallet: string): ProofField[] {
  const marketUrl = buildPolymarketMarketUrl(trade.slug || trade.eventSlug || null)
  return [
    { label: 'Source label', value: 'Polymarket public API /activity' },
    { label: 'Source wallet', value: sourceWallet },
    { label: 'Timestamp', value: new Date(trade.timestamp * 1000).toLocaleString('en-US') },
    { label: 'Market link', value: marketUrl ? 'Open market' : 'URL unavailable', href: marketUrl },
    { label: 'Condition ID', value: trade.conditionId },
    { label: 'Token / asset ID', value: trade.asset },
    { label: 'Transaction hash', value: truncateHash(trade.transactionHash) },
    { label: 'Source endpoint', value: 'https://data-api.polymarket.com/activity' },
  ]
}

function buildPositionProofFields(position: WalletPosition, sourceWallet: string): ProofField[] {
  const marketUrl = buildPolymarketMarketUrl(position.slug || null)
  return [
    { label: 'Source label', value: 'Polymarket public API /positions' },
    { label: 'Source wallet', value: sourceWallet },
    { label: 'Timestamp', value: 'Available from current snapshot only' },
    { label: 'Market link', value: marketUrl ? 'Open market' : 'URL unavailable', href: marketUrl },
    { label: 'Condition ID', value: position.conditionId },
    { label: 'Token / asset ID', value: position.asset },
    { label: 'Source endpoint', value: 'https://data-api.polymarket.com/positions' },
  ]
}

function buildClosedPositionProofFields(position: Awaited<ReturnType<typeof getClosedPositions>>[number], sourceWallet: string): ProofField[] {
  const marketUrl = buildPolymarketMarketUrl(position.slug || null)
  return [
    { label: 'Source label', value: 'Polymarket public API /closed-positions' },
    { label: 'Source wallet', value: sourceWallet },
    { label: 'Close date', value: formatDate(position.endDate) },
    { label: 'Market link', value: marketUrl ? 'Open market' : 'URL unavailable', href: marketUrl },
    { label: 'Condition ID', value: position.conditionId },
    { label: 'Token / asset ID', value: position.asset },
    { label: 'Source endpoint', value: 'https://data-api.polymarket.com/closed-positions' },
  ]
}

function TradeRow({
  trade,
  onFollow,
  allTradesForMarket,
  currentPrice,
  proofFields,
}: {
  trade: WalletTrade
  onFollow: (t: WalletTrade) => void
  allTradesForMarket: WalletTrade[]
  currentPrice: number | null
  proofFields: ProofField[]
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
          {proofFields.map(proofRow)}
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
  sourceWallet,
  onPaperFollow,
  proofFields,
}: {
  position: WalletPosition
  copyRiskLabel: string
  sourceWallet: string
  onPaperFollow: (position: WalletPosition) => void
  proofFields: ProofField[]
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="follow-btn" onClick={() => onPaperFollow(position)}>Paper follow this position</button>
          <span className={`pnl-badge ${pnlPos ? 'pnl-pos' : 'pnl-neg'}`}>
            {pnlPos ? '+' : ''}{formatUSD(pnl)}
          </span>
        </div>
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
      <div className="trade-row-details">
        <div className="trade-detail-line"><strong>Source trader:</strong> {truncateAddress(sourceWallet)}</div>
        <div className="trade-detail-line"><strong>Open exposure:</strong> {formatUSD(position.currentValue ?? 0)} not profit</div>
        {proofFields.map(proofRow)}
      </div>
    </div>
  )
}

export default function WalletProfile({ address, onBack, onViewPortfolio }: Props) {
  const normalizedAddress = address.toLowerCase()
  const overviewLimit = 60
  const initialHistoryLimit = 100
  const chartLimit = 120

  const [overviewTrades, setOverviewTrades] = useState<WalletTrade[]>([])
  const [historyTrades, setHistoryTrades] = useState<WalletTrade[]>([])
  const [chartTrades, setChartTrades] = useState<WalletTrade[]>([])
  const [positions, setPositions] = useState<WalletPosition[]>([])
  const [closedPositions, setClosedPositions] = useState<Awaited<ReturnType<typeof getClosedPositions>>>([])
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [chartsLoading, setChartsLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [chartsLoaded, setChartsLoaded] = useState(false)
  const [positionsLoading, setPositionsLoading] = useState(true)
  const [closedLoading, setClosedLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [positionsError, setPositionsError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [chartsError, setChartsError] = useState<string | null>(null)
  const [minSize, setMinSize] = useState(1)
  const [tab, setTab] = useState<ProfileTab>('overview')
  const [followMsg, setFollowMsg] = useState<string | null>(null)
  const [watching, setWatching] = useState(() => isWatchingWallet(normalizedAddress))
  const [score, setScore] = useState<EdgeScore | null>(null)
  const [scoreLoading, setScoreLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [livePrices, setLivePrices] = useState<Map<string, number>>(new Map())
  const [historyLimit, setHistoryLimit] = useState(initialHistoryLimit)

  const overviewKey = `wallet:${normalizedAddress}:overview:${overviewLimit}`
  const positionsKey = `wallet:${normalizedAddress}:positions`
  const closedKey = `wallet:${normalizedAddress}:closed`

  const loadOverview = useCallback((forceRefresh = false) => {
    if (!forceRefresh) {
      const cachedTrades = cacheGet<WalletTrade[]>(overviewKey, TTL.wallet)
      const cachedPositions = cacheGet<WalletPosition[]>(positionsKey, TTL.wallet)
      const cachedClosed = cacheGet<Awaited<ReturnType<typeof getClosedPositions>>>(closedKey, TTL.wallet)
      if (cachedTrades && cachedPositions && cachedClosed) {
        setOverviewTrades(cachedTrades)
        setPositions(cachedPositions)
        setClosedPositions(cachedClosed)
        setError(null)
        setPositionsError(null)
        setOverviewLoading(false)
        setPositionsLoading(false)
        setClosedLoading(false)
        setLastUpdated(Math.max(cacheTime(overviewKey) ?? 0, cacheTime(positionsKey) ?? 0, cacheTime(closedKey) ?? 0))
        return
      }
    }

    setOverviewLoading(true)
    setPositionsLoading(true)
    setClosedLoading(true)
    setError(null)
    setPositionsError(null)

    Promise.allSettled([
      getWalletActivity(normalizedAddress, overviewLimit),
      getWalletPositions(normalizedAddress, 100),
      getClosedPositions(normalizedAddress, 100),
    ]).then(([activityResult, positionsResult, closedResult]) => {
      if (activityResult.status === 'fulfilled') {
        cacheSet(overviewKey, activityResult.value)
        setOverviewTrades(activityResult.value)
      } else {
        setError('Wallet activity unavailable from public API.')
      }

      if (positionsResult.status === 'fulfilled') {
        cacheSet(positionsKey, positionsResult.value)
        setPositions(positionsResult.value)
        setPositionsError(null)
      } else {
        setPositions([])
        setPositionsError('Current positions unavailable from public API.')
      }

      if (closedResult.status === 'fulfilled') {
        cacheSet(closedKey, closedResult.value)
        setClosedPositions(closedResult.value)
      } else {
        setClosedPositions([])
      }

      setOverviewLoading(false)
      setPositionsLoading(false)
      setClosedLoading(false)
      setLastUpdated(Date.now())
    })
  }, [normalizedAddress, overviewKey, positionsKey, closedKey])

  const loadHistory = useCallback((limit = historyLimit, forceRefresh = false) => {
    const key = `wallet:${normalizedAddress}:history:${limit}`
    if (!forceRefresh) {
      const cached = cacheGet<WalletTrade[]>(key, TTL.wallet)
      if (cached) {
        setHistoryTrades(cached)
        setHistoryLoaded(true)
        setHistoryError(null)
        setHistoryLoading(false)
        return
      }
    }

    setHistoryLoading(true)
    setHistoryError(null)
    getWalletActivity(normalizedAddress, limit)
      .then(data => {
        cacheSet(key, data)
        setHistoryTrades(data)
        setHistoryLoaded(true)
      })
      .catch(() => {
        setHistoryError('Trade history unavailable from public API.')
        setHistoryLoaded(true)
      })
      .finally(() => setHistoryLoading(false))
  }, [normalizedAddress, historyLimit])

  const loadCharts = useCallback((forceRefresh = false) => {
    const key = `wallet:${normalizedAddress}:charts:${chartLimit}`
    if (!forceRefresh) {
      if (historyTrades.length > 0) {
        setChartTrades(historyTrades)
        setChartsLoaded(true)
        setChartsError(null)
        setChartsLoading(false)
        return
      }
      const cached = cacheGet<WalletTrade[]>(key, TTL.wallet)
      if (cached) {
        setChartTrades(cached)
        setChartsLoaded(true)
        setChartsError(null)
        setChartsLoading(false)
        return
      }
    }

    setChartsLoading(true)
    setChartsError(null)
    getWalletActivity(normalizedAddress, chartLimit)
      .then(data => {
        cacheSet(key, data)
        setChartTrades(data)
        setChartsLoaded(true)
      })
      .catch(() => {
        setChartsError('Entry chart data unavailable from public API.')
        setChartsLoaded(true)
      })
      .finally(() => setChartsLoading(false))
  }, [normalizedAddress, historyTrades])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setWatching(isWatchingWallet(normalizedAddress))
      setMinSize(1)
      setTab('overview')
      setOverviewTrades([])
      setHistoryTrades([])
      setChartTrades([])
      setPositions([])
      setClosedPositions([])
      setHistoryLoaded(false)
      setChartsLoaded(false)
      setHistoryLoading(false)
      setChartsLoading(false)
      setHistoryError(null)
      setChartsError(null)
      setPositionsError(null)
      setError(null)
      setFollowMsg(null)
      setLastUpdated(null)
      setScore(null)
      setHistoryLimit(initialHistoryLimit)
      setOverviewLoading(true)
      setHistoryLoading(false)
      setChartsLoading(false)
      setPositionsLoading(true)
      setClosedLoading(true)
      loadOverview()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [normalizedAddress, loadOverview])

  useEffect(() => {
    const timer = setInterval(() => loadOverview(), 30_000)
    return () => clearInterval(timer)
  }, [loadOverview])

  useEffect(() => {
    const sourceTrades = filterNoise(overviewTrades, minSize)
    const timer = window.setTimeout(() => {
      if (sourceTrades.length === 0) {
        setScore(null)
        setScoreLoading(false)
        return
      }
      setScoreLoading(true)
      computeEntryScore(sourceTrades)
        .then(setScore)
        .catch(() => setScore(null))
        .finally(() => setScoreLoading(false))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [overviewTrades, minSize])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (tab === 'trades') {
        loadHistory(historyLimit)
      }
      if (tab === 'charts') {
        loadCharts()
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [tab, historyLimit, loadHistory, loadCharts])

  const handleRefresh = useCallback(() => {
    cacheInvalidatePrefix(`wallet:${normalizedAddress}:`)
    setScore(null)
    setOverviewTrades([])
    setHistoryTrades([])
    setChartTrades([])
    setPositions([])
    setClosedPositions([])
    setHistoryLoading(false)
    setChartsLoading(false)
    setHistoryError(null)
    setChartsError(null)
    setPositionsError(null)
    loadOverview(true)
  }, [normalizedAddress, loadOverview])

  const handleToggleWatch = () => {
    const sourceTrades = overviewTrades.length > 0 ? overviewTrades : historyTrades
    const pseudonym = sourceTrades[0]?.pseudonym ?? ''
    const name = sourceTrades[0]?.name ?? ''
    if (watching) {
      unwatchWallet(normalizedAddress)
      setWatching(false)
    } else {
      watchWallet(normalizedAddress, pseudonym, name)
      setWatching(true)
    }
  }

  const handleFollow = (trade: WalletTrade) => {
    let portfolio = loadPortfolio()
    if (!portfolio) portfolio = createPortfolio(1000)
    const paperSize = Math.max(1, Math.min(10, (trade.usdcSize ?? 10) / 10))
    savePortfolio(addSimulatedTrade(portfolio, trade, paperSize))
    setFollowMsg(`Followed: ${trade.title} (Paper ${formatUSD(paperSize)})`)
    setTimeout(() => setFollowMsg(null), 3500)
  }

  const handlePaperFollowPosition = (position: WalletPosition) => {
    let portfolio = loadPortfolio()
    if (!portfolio) portfolio = createPortfolio(1000)
    const simulatedSize = Math.max(1, position.initialValue > 0 ? position.initialValue : position.currentValue || 1)
    savePortfolio(addSimulatedPositionFollow(portfolio, position, normalizedAddress, simulatedSize))
    setFollowMsg(`Paper followed: ${position.title} (Paper ${formatUSD(simulatedSize)})`)
    setTimeout(() => setFollowMsg(null), 3500)
  }

  const overviewFiltered = filterNoise(overviewTrades, minSize)
  const marketCount = new Set(overviewFiltered.map(t => t.conditionId)).size
  const totalVol = overviewFiltered.reduce((s, t) => s + (t.usdcSize ?? 0), 0)
  const sourceTrades = overviewTrades.length > 0 ? overviewTrades : historyTrades
  const pseudonym = sourceTrades[0]?.pseudonym || ''
  const name = sourceTrades[0]?.name || ''

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      const assets = [...new Set(overviewFiltered.map(t => t.asset).filter(Boolean))].slice(0, 20)
      if (assets.length === 0) {
        if (!cancelled) setLivePrices(new Map())
        return
      }
      batchFetchPrices(assets)
        .then(map => {
          if (!cancelled) setLivePrices(map)
        })
        .catch(() => {
          if (!cancelled) setLivePrices(new Map())
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [overviewFiltered])

  const performanceSnapshot = buildTraderPerformanceSnapshot({
    wallet: normalizedAddress,
    trades: overviewFiltered,
    recentTrades: overviewFiltered.slice(0, 40),
    positions,
    closedPositions,
    priceMap: livePrices,
  })
  const traderQuality = evaluateTraderQualityFromSnapshot(performanceSnapshot)

  const positionsWithValue = positions.filter(p => (p.initialValue ?? 0) > 0)
  const realizedPnl = performanceSnapshot.realizedPnl
  const openValue = performanceSnapshot.openExposure
  const winRate = performanceSnapshot.winRate
  const activePositions = positions.filter(p => (p.initialValue ?? 0) > 0 || (p.currentValue ?? 0) > 0 || p.redeemable === false)
  const historyRows = historyTrades
  const filteredHistoryRows = filterNoise(historyRows, minSize)
  const chartRows = chartTrades
  const positionFollowLabel = (position: WalletPosition) =>
    assessPositionFollowability(position, traderQuality)
  const suspiciousAudit = traderQuality.luckyWinRisk ||
    traderQuality.outlierDriven ||
    (traderQuality.winRate !== null && traderQuality.winRate >= 0.95) ||
    Math.abs(traderQuality.metrics.realizedPnl) >= 5000 ||
    (performanceSnapshot.topWinShare !== null && performanceSnapshot.topWinShare >= 60)

  const buildAuditReasons = () => {
    const reasons: string[] = []
    reasons.push(`Records analyzed: ${performanceSnapshot.sampleSize}`)
    reasons.push(`Closed positions analyzed: ${performanceSnapshot.closedCount}`)
    if (performanceSnapshot.largestWin !== 0) {
      reasons.push(`Largest win contribution: ${formatUSD(performanceSnapshot.largestWin)}`)
    }
    reasons.push(`PnL excluding largest win: ${formatUSD(performanceSnapshot.pnlExcludingLargestWin)}`)
    if (performanceSnapshot.medianPositionPnl !== null) {
      reasons.push(`Median position PnL: ${formatUSD(performanceSnapshot.medianPositionPnl)}`)
    }
    if (performanceSnapshot.topWinShare !== null) {
      reasons.push(`Top win share: ${performanceSnapshot.topWinShare.toFixed(0)}%`)
    }
    reasons.push(
      performanceSnapshot.closedCount >= 100
        ? 'History may be API-limited'
        : 'History window not obviously capped',
    )
    reasons.push('Open exposure is excluded from realized profit')
    return reasons
  }

  const auditReasons = buildAuditReasons()

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
            disabled={overviewLoading || historyLoading || chartsLoading}
            title="Refresh wallet data"
          >
            {(overviewLoading || historyLoading || chartsLoading) ? '↻' : '↻ Refresh'}
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

      {(overviewLoading || positionsLoading || closedLoading) && <p className="empty-msg">Loading wallet performance…</p>}
      {error && <p className="error-msg">{error}</p>}
      {positionsError && <p className="error-msg">{positionsError}</p>}
      {historyError && <p className="error-msg">{historyError}</p>}
      {chartsError && <p className="error-msg">{chartsError}</p>}

      {!overviewLoading && !error && (
        <>
          <div className="wallet-quality-banner">
            <div className="data-source-label" style={{ marginBottom: traderQuality.plainReasons.length > 0 ? 8 : 0 }}>
              <strong>{traderQuality.tierLabel}</strong>
              {' · '}
              Reliability {traderQuality.reliabilityScore}/100
              {' · '}
              Copy signal {traderQuality.copySignal}
              {' · '}
              {traderQuality.dataConfidenceLabel}
              {' · '}
              Entry timing {traderQuality.metrics.timingEdgePct !== null ? `${traderQuality.metrics.timingEdgePct.toFixed(0)}%` : 'n/a'}
              {traderQuality.luckyWinRisk ? ' · Lucky win risk flagged' : ''}
              {traderQuality.outlierDriven ? ' · Outlier-driven profit' : ''}
            </div>
            {traderQuality.plainReasons.length > 0 && (
              <ul className="hot-trader-reasons" style={{ margin: 0 }}>
                {traderQuality.plainReasons.slice(0, 4).map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            )}
          </div>

          {suspiciousAudit && (
            <section className="wallet-section">
              <div className="section-header">
                <h3 className="markets-list-title">Trader audit</h3>
                <span className="estimate-label">Strong-looking history needs proof</span>
              </div>
              <ul className="hot-trader-reasons" style={{ marginTop: 0 }}>
                {auditReasons.map((reason, index) => <li key={index}>{reason}</li>)}
              </ul>
            </section>
          )}

          <div className="wallet-stats-row">
            <div className="wallet-stat">
              <span className="wallet-stat-val">{overviewFiltered.length}</span>
              <span className="wallet-stat-label">Trades loaded</span>
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
              <span className="wallet-stat-label">Realized PnL from closed positions</span>
            </div>
            <div className="wallet-stat">
              <span className={`wallet-stat-val ${openValue >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
                {formatUSD(openValue)}
              </span>
              <span className="wallet-stat-label">Open exposure, not profit</span>
            </div>
          </div>

          {closedPositions.length > 0 ? (
            <section className="wallet-section wallet-section-highlight">
              <PnLGraph wallet={normalizedAddress} closedPositions={closedPositions} />
            </section>
          ) : (
            <p className="empty-msg">No closed position history available for performance graph.</p>
          )}

          <div className="tab-bar">
            <button type="button" className={`tab-btn ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
              Performance
            </button>
            <button type="button" className={`tab-btn ${tab === 'trades' ? 'active' : ''}`} onClick={() => setTab('trades')}>
              Trade History ({historyRows.length || overviewFiltered.length})
            </button>
            <button type="button" className={`tab-btn ${tab === 'charts' ? 'active' : ''}`} onClick={() => setTab('charts')}>
              Entry Charts
            </button>
          </div>

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

              <CopyTradingModule
                score={score}
                trades={overviewFiltered}
                traderQuality={traderQuality}
                onViewPortfolio={onViewPortfolio}
                onFollowMsg={msg => { setFollowMsg(msg); setTimeout(() => setFollowMsg(null), 4000) }}
              />
            </>
          )}

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
              {!historyLoaded && historyRows.length === 0 && <p className="empty-msg">Loading trade history…</p>}
              {historyLoaded && filteredHistoryRows.length === 0 && <p className="empty-msg">No trades above the size filter.</p>}
              {filteredHistoryRows.slice(0, historyLimit).map((t, i) => (
                <TradeRow
                  key={t.transactionHash ?? `${t.conditionId}-${i}`}
                  trade={t}
                  onFollow={handleFollow}
                  allTradesForMarket={filteredHistoryRows.filter(x => x.conditionId === t.conditionId)}
                  currentPrice={livePrices.get(t.asset) ?? null}
                  proofFields={buildTradeProofFields(t, t.proxyWallet)}
                />
              ))}
              {historyRows.length >= historyLimit && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="search-btn"
                    onClick={() => setHistoryLimit(limit => limit + 100)}
                    disabled={historyLoading}
                  >
                    {historyLoading ? 'Loading…' : 'Load more'}
                  </button>
                  <span className="estimate-label">Latest {historyRows.length} trades loaded</span>
                </div>
              )}
            </section>
          )}

          {tab === 'charts' && (
            <section className="wallet-section">
              <p className="score-disclaimer" style={{ marginBottom: 12 }}>
                Charts load individually on click. Price history is cached for 10 minutes.
              </p>
              {!chartsLoaded && chartRows.length === 0 && <p className="empty-msg">Loading entry charts…</p>}
              {chartsLoaded && chartRows.length === 0 && <p className="empty-msg">No chart data available.</p>}
              {(() => {
                const seen = new Set<string>()
                const markets: { conditionId: string; asset: string; title: string; trades: WalletTrade[] }[] = []
                for (const t of chartRows) {
                  if (!seen.has(t.conditionId) && t.asset) {
                    seen.add(t.conditionId)
                    markets.push({
                      conditionId: t.conditionId,
                      asset: t.asset,
                      title: t.title,
                      trades: chartRows.filter(x => x.conditionId === t.conditionId),
                    })
                  }
                }
                if (markets.length === 0) return null
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
                {(traderQuality.metrics.realizedPnl ?? 0) < 0 && openValue > Math.abs(traderQuality.metrics.realizedPnl ?? 0) * 2 && (
                  <p className="score-disclaimer" style={{ marginBottom: 10 }}>
                    Large exposure with poor realized history.
                  </p>
                )}
                {activePositions.slice(0, 12).map(position => (
                  <CurrentPositionRow
                    key={position.asset}
                    position={position}
                    copyRiskLabel={positionFollowLabel(position)}
                    sourceWallet={normalizedAddress}
                    onPaperFollow={handlePaperFollowPosition}
                    proofFields={buildPositionProofFields(position, normalizedAddress)}
                  />
                ))}
                {activePositions.length > 12 && (
                  <p className="empty-msg">Showing first 12 active positions.</p>
                )}
              </>
            )}
          </section>

          <section className="wallet-section">
            <div className="section-header">
              <h3 className="markets-list-title">Verification proof</h3>
              <span className="estimate-label">Market, wallet, and source IDs</span>
            </div>
            {closedPositions.length === 0 && <p className="empty-msg">No closed position proof available.</p>}
            {closedPositions.slice(0, 5).map((position, index) => (
              <div className="trade-row-details" key={`${position.asset}-${index}`}>
                {buildClosedPositionProofFields(position, normalizedAddress).map(proofRow)}
              </div>
            ))}
          </section>

          <div className="data-source-label">
            Polymarket public API · {overviewFiltered.length} trades loaded · {positionsWithValue.length} positions ·
            performance uses closed-position realized PnL
          </div>
        </>
      )}
    </div>
  )
}
