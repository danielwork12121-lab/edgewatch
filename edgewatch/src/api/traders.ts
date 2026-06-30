import type { PolyEvent, WalletTrade, TraderRankEntry } from '../types'
import { getMarketTrades, getWalletPositions, truncateAddress } from './wallets'
import { formatUSD, toFiniteNumber } from './polymarket'
import { batchFetchPrices } from './priceTracker'
import { cacheGet, cacheSet, TTL } from './cache'

export interface HotTraderEntry {
  address: string
  label: string
  pseudonym: string
  name: string
  hotScore: number
  recentTradeCount: number
  recentVolumeUSDC: number
  avgTradeSize: number
  marketsTraded: number
  activeMarkets: string[]
  timingEdge: number | null
  pnl: number | null
  winRate: number | null
  scoreReasons: string[]
}

export interface BestTrade {
  address: string
  pseudonym: string
  name: string
  side: 'BUY' | 'SELL'
  outcome: string
  entryPrice: number
  currentPrice: number
  delta: number
  profitMultiple: number
  sizeUSDC: number
  timestamp: number
  title: string
  conditionId: string
  asset: string
}

export interface MarketIntelligence {
  traders: TraderRankEntry[]
  bestTrades: BestTrade[]
  totalTrades: number
}

interface HotWalletAgg {
  address: string
  pseudonym: string
  name: string
  trades: WalletTrade[]
  volume: number
  markets: Map<string, { label: string; count: number; lastTs: number }>
  positiveMoves: number
  resolvedMoves: number
}

interface HotTradeNormalized {
  address: string
  walletLabel: string
  title: string
  marketKey: string
  marketName: string
  volumeUSDC: number
  price: number
  timestamp: number
  side: 'BUY' | 'SELL'
  asset: string
}

interface HotTraderDiagnostics {
  endpoint: string
  status: number | null
  rawType: string
  contentType: string | null
  rawTradeCount: number
  rawSamples: unknown[]
  normalizedTradeCount: number
  walletGroupCount: number
  finalHotTraderCount: number
  discardedReasons: Record<string, number>
}

export interface HotTraderLoadResult {
  state: 'ok' | 'error' | 'no-trades' | 'filtered-out'
  message: string
  traders: HotTraderEntry[]
  diagnostics: HotTraderDiagnostics
}

// ─── Internal helper ───────────────────────────────────────────────────────

const HOT_TRADES_ENDPOINT = 'https://data-api.polymarket.com/trades?limit=200'

const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug('[EdgeWatch][hot-traders]', ...args)
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function toTimestampSeconds(value: unknown): number {
  const numeric = toFiniteNumber(value, Number.NaN)
  if (Number.isFinite(numeric)) return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric)
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000)
  }
  return 0
}

function normalizeRawTrade(raw: unknown): HotTradeNormalized | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const address = firstString(
    record.proxyWallet,
    record.wallet,
    record.user,
    record.maker,
    record.taker,
    record.owner,
  ).toLowerCase()
  const volumeUSDC = toFiniteNumber(
    record.usdcSize ?? record.sizeUsd ?? record.size ?? record.amount ?? record.volume,
    Number.NaN,
  )
  const price = toFiniteNumber(record.price ?? record.outcomePrice ?? record.entryPrice, Number.NaN)
  const timestamp = toTimestampSeconds(record.timestamp ?? record.createdAt ?? record.tradeTime ?? record.time)
  const title = firstString(
    record.title,
    record.marketQuestion,
    record.question,
    record.market,
    record.marketSlug,
    record.slug,
    record.eventSlug,
  ) || 'Unknown market'
  const marketKey = firstString(record.conditionId, record.marketId, record.tokenId, record.asset, record.slug, title)
  const marketName = firstString(record.marketQuestion, record.title, record.market, record.slug, title) || title
  const side = String(record.side ?? '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY'
  const walletLabel = firstString(record.pseudonym, record.name, record.label)
  const asset = firstString(record.asset, record.tokenId, record.marketId, marketKey)

  if (!address || !marketKey || !Number.isFinite(volumeUSDC) || volumeUSDC <= 0) return null

  return {
    address,
    walletLabel,
    title,
    marketKey,
    marketName,
    volumeUSDC,
    price: Number.isFinite(price) ? price : 0,
    timestamp: timestamp > 0 ? timestamp : Math.floor(Date.now() / 1000),
    side: side === 'SELL' ? 'SELL' : 'BUY',
    asset,
  }
}

function computeHotScore(agg: HotWalletAgg): number {
  const recentVolume = agg.volume
  const recentTrades = agg.trades.length
  const marketsTraded = agg.markets.size
  const latestTrade = agg.trades.reduce((max, trade) => Math.max(max, trade.timestamp), 0)
  const ageHours = latestTrade > 0 ? Math.max(0, (Date.now() / 1000 - latestTrade) / 3600) : 999
  const recencyComponent = Math.max(0, 20 - Math.min(20, ageHours * 2))
  const volumeComponent = Math.min(38, Math.log10(recentVolume + 1) * 12)
  const activityComponent = Math.min(24, recentTrades * 8)
  const breadthComponent = Math.min(18, marketsTraded * 6)
  const averageSize = recentVolume / Math.max(recentTrades, 1)
  const avgComponent = Math.min(8, Math.log10(averageSize + 1) * 4)
  const singleTradePenalty = recentTrades === 1 ? 8 : 0
  const score = volumeComponent + activityComponent + breadthComponent + recencyComponent + avgComponent - singleTradePenalty
  return Math.max(0, Math.min(100, score))
}

async function fetchAndRank(tokenIds: string[], minTrades = 1): Promise<{
  traders: TraderRankEntry[]
  allTrades: WalletTrade[]
  priceMap: Map<string, number>
}> {
  if (tokenIds.length === 0) return { traders: [], allTrades: [], priceMap: new Map() }

  const tradeSets = await Promise.allSettled(
    tokenIds.slice(0, 6).map(id => getMarketTrades(id, 200))
  )
  const allTrades: WalletTrade[] = tradeSets
    .filter((r): r is PromiseFulfilledResult<WalletTrade[]> => r.status === 'fulfilled')
    .flatMap(r => r.value.filter(t => t.type === 'TRADE' && (t.usdcSize ?? 0) >= 1))

  if (allTrades.length === 0) return { traders: [], allTrades: [], priceMap: new Map() }

  const uniqueAssets = [...new Set(allTrades.map(t => t.asset).filter(Boolean))].slice(0, 20)
  const priceMap = await batchFetchPrices(uniqueAssets)

  const walletMap = new Map<string, {
    trades: WalletTrade[]
    volume: number
    positive: number
    resolved: number
    markets: Set<string>
  }>()

  for (const trade of allTrades) {
    const addr = trade.proxyWallet
    if (!addr) continue
    if (!walletMap.has(addr)) {
      walletMap.set(addr, { trades: [], volume: 0, positive: 0, resolved: 0, markets: new Set() })
    }
    const w = walletMap.get(addr)!
    w.trades.push(trade)
    w.volume += trade.usdcSize ?? 0
    w.markets.add(trade.conditionId)

    const cur = priceMap.get(trade.asset)
    if (cur !== undefined && trade.price > 0) {
      const delta = trade.side === 'BUY' ? cur - trade.price : trade.price - cur
      w.resolved++
      if (delta > 0) w.positive++
    }
  }

  const traders = [...walletMap.entries()]
    .filter(([, w]) => w.trades.length >= minTrades)
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, 25)
    .map(([addr, w]): TraderRankEntry => {
      const sample = w.trades[0]
      return {
        address: addr,
        pseudonym: sample?.pseudonym ?? '',
        name: sample?.name ?? '',
        tradeCount: w.trades.length,
        totalVolumeUSDC: w.volume,
        avgTradeSize: w.volume / Math.max(w.trades.length, 1),
        timingScore: w.resolved > 0 ? w.positive / w.resolved : 0,
        positiveDelta: w.positive,
        totalResolved: w.resolved,
        pnl: null,
        winRate: null,
        marketsTraded: w.markets.size,
      }
    })

  return { traders, allTrades, priceMap }
}

function collectMarketLabels(trades: WalletTrade[]): string[] {
  const marketMap = new Map<string, { label: string; count: number; lastTs: number }>()
  for (const trade of trades) {
    const key = trade.conditionId
    const label = trade.title || trade.eventSlug || trade.slug || 'Unknown market'
    const current = marketMap.get(key)
    if (!current) {
      marketMap.set(key, { label, count: 1, lastTs: trade.timestamp })
    } else {
      current.count += 1
      current.lastTs = Math.max(current.lastTs, trade.timestamp)
    }
  }
  return [...marketMap.values()]
    .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs)
    .slice(0, 3)
    .map(item => item.label)
}

function buildHotReasons(entry: HotTraderEntry): string[] {
  const reasons: string[] = []
  reasons.push(`✓ ${entry.recentTradeCount} recent trade${entry.recentTradeCount === 1 ? '' : 's'}`)
  reasons.push(`✓ ${entry.marketsTraded} unique market${entry.marketsTraded === 1 ? '' : 's'}`)
  reasons.push(`✓ ${formatUSD(entry.recentVolumeUSDC)} recent volume`)
  reasons.push(`✓ Average trade ${formatUSD(entry.avgTradeSize)}`)
  if (entry.winRate !== null) reasons.push(`✓ ${(entry.winRate * 100).toFixed(0)}% win rate on resolved positions`)
  else reasons.push('• Win rate unavailable')
  if (entry.pnl !== null) reasons.push(`✓ ${entry.pnl >= 0 ? '+' : ''}${formatUSD(entry.pnl)} PnL`)
  else reasons.push('• PnL unavailable')
  return reasons.slice(0, 4)
}

function makeHotEntry(agg: HotWalletAgg, winRate: number | null, pnl: number | null): HotTraderEntry {
  const hotScore = computeHotScore(agg)
  const entry: HotTraderEntry = {
    address: agg.address,
    label: agg.pseudonym || agg.name || truncateAddress(agg.address),
    pseudonym: agg.pseudonym,
    name: agg.name,
    hotScore,
    recentTradeCount: agg.trades.length,
    recentVolumeUSDC: agg.volume,
    avgTradeSize: agg.volume / Math.max(agg.trades.length, 1),
    marketsTraded: agg.markets.size,
    activeMarkets: collectMarketLabels(agg.trades),
    timingEdge: agg.resolvedMoves > 0 ? (agg.positiveMoves / agg.resolvedMoves) * 100 : null,
    pnl,
    winRate,
    scoreReasons: [],
  }
  entry.scoreReasons = buildHotReasons(entry)
  return entry
}

export async function fetchHotTraders(limit = 8): Promise<HotTraderLoadResult> {
  const key = `hot-traders:v2:${limit}`
  const cached = cacheGet<HotTraderLoadResult>(key, TTL.hotTraders)
  if (cached !== null) return cached

  const diagnostics: HotTraderDiagnostics = {
    endpoint: HOT_TRADES_ENDPOINT,
    status: null,
    rawType: 'unknown',
    contentType: null,
    rawTradeCount: 0,
    rawSamples: [],
    normalizedTradeCount: 0,
    walletGroupCount: 0,
    finalHotTraderCount: 0,
    discardedReasons: {},
  }

  const countDiscard = (reason: string) => {
    diagnostics.discardedReasons[reason] = (diagnostics.discardedReasons[reason] ?? 0) + 1
  }

  try {
    const res = await fetch(HOT_TRADES_ENDPOINT)
    diagnostics.status = res.status
    diagnostics.contentType = res.headers.get('content-type')
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
    diagnostics.rawType = Array.isArray(parsed) ? 'array' : typeof parsed
    const rawTrades = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? Object.values(parsed as Record<string, unknown>)
        : []
    diagnostics.rawTradeCount = rawTrades.length
    diagnostics.rawSamples = rawTrades.slice(0, 3)

    devLog('raw feed', {
      endpoint: diagnostics.endpoint,
      status: diagnostics.status,
      rawType: diagnostics.rawType,
      contentType: diagnostics.contentType,
      rawTradeCount: diagnostics.rawTradeCount,
      rawSamples: diagnostics.rawSamples,
    })

    if (!res.ok) {
      const result: HotTraderLoadResult = {
        state: 'error',
        message: 'Could not load hot traders',
        traders: [],
        diagnostics,
      }
      return result
    }

    if (rawTrades.length === 0) {
      const result: HotTraderLoadResult = {
        state: 'no-trades',
        message: 'No recent public trades returned',
        traders: [],
        diagnostics,
      }
      cacheSet(key, result)
      return result
    }

    const normalized = rawTrades
      .map(normalizeRawTrade)
      .filter((trade): trade is HotTradeNormalized => trade !== null)
    diagnostics.normalizedTradeCount = normalized.length

    const filtered = normalized.filter(trade => {
      if (!trade.address) {
        countDiscard('missing_wallet')
        return false
      }
      if (trade.volumeUSDC < 1) {
        countDiscard('below_volume_floor')
        return false
      }
      return true
    })

    const walletMap = new Map<string, HotWalletAgg>()
    for (const trade of filtered) {
      if (!walletMap.has(trade.address)) {
        walletMap.set(trade.address, {
          address: trade.address,
          pseudonym: trade.walletLabel,
          name: trade.walletLabel,
          trades: [],
          volume: 0,
          markets: new Map(),
          positiveMoves: 0,
          resolvedMoves: 0,
        })
      }
      const agg = walletMap.get(trade.address)!
      const walletTrade: WalletTrade = {
        proxyWallet: trade.address,
        timestamp: trade.timestamp,
        conditionId: trade.marketKey,
        type: 'TRADE',
        size: trade.volumeUSDC,
        usdcSize: trade.volumeUSDC,
        price: trade.price,
        asset: trade.asset || trade.marketKey,
        side: trade.side,
        outcomeIndex: 0,
        title: trade.title,
        slug: trade.marketName,
        icon: '',
        eventSlug: trade.marketName,
        outcome: trade.side,
        name: trade.walletLabel,
        pseudonym: trade.walletLabel,
      }
      agg.trades.push(walletTrade)
      agg.volume += trade.volumeUSDC
      agg.markets.set(trade.marketKey, {
        label: trade.marketName,
        count: (agg.markets.get(trade.marketKey)?.count ?? 0) + 1,
        lastTs: trade.timestamp,
      })
    }

    diagnostics.walletGroupCount = walletMap.size

    if (walletMap.size === 0) {
      const result: HotTraderLoadResult = {
        state: 'filtered-out',
        message: 'Trades found, but none passed filters',
        traders: [],
        diagnostics,
      }
      cacheSet(key, result)
      devLog('filtered out all trades', diagnostics)
      return result
    }

    const prequalified = [...walletMap.values()]
      .filter(agg => agg.trades.length >= 1 && agg.volume >= 1 && agg.markets.size >= 1)
      .sort((a, b) => {
        const aScore = computeHotScore(a)
        const bScore = computeHotScore(b)
        return bScore - aScore
      })
      .slice(0, Math.max(limit * 2, 12))

    const assets = [...new Set(prequalified.flatMap(agg => agg.trades.map(t => t.asset)).filter(Boolean))].slice(0, 24)
    const priceMap = await batchFetchPrices(assets)

    for (const agg of prequalified) {
      for (const trade of agg.trades) {
        const cur = priceMap.get(trade.asset)
        if (cur === undefined || !trade.price || trade.price <= 0) continue
        const delta = trade.side === 'BUY' ? cur - trade.price : trade.price - cur
        agg.resolvedMoves += 1
        if (delta > 0) agg.positiveMoves += 1
      }
    }

    const ranked = prequalified
      .map((agg): HotTraderEntry => {
        const entry = makeHotEntry(agg, null, null)
        entry.winRate = null
        entry.pnl = null
        return entry
      })
      .sort((a, b) => b.hotScore - a.hotScore)
      .slice(0, limit)

    let final = ranked
    try {
      const enriched = await Promise.allSettled(
        ranked.map(async entry => {
          try {
            const positions = await getWalletPositions(entry.address, 50)
            const withVal = positions.filter(p => (p.initialValue ?? 0) > 0)
            const pnl = withVal.reduce((s, p) => s + (p.cashPnl ?? 0), 0)
            const winRate = withVal.length > 0
              ? withVal.filter(p => (p.cashPnl ?? 0) >= 0).length / withVal.length
              : null
            const agg = walletMap.get(entry.address)
            if (!agg) return entry
            return makeHotEntry(agg, winRate, pnl)
          } catch {
            return entry
          }
        })
      )
      final = enriched.map((result, i) => result.status === 'fulfilled' ? result.value : ranked[i])
    } catch {
      final = ranked
    }

    diagnostics.finalHotTraderCount = final.length
    const result: HotTraderLoadResult = {
      state: final.length > 0 ? 'ok' : 'filtered-out',
      message: final.length > 0 ? 'Hot traders loaded' : 'Trades found, but none passed filters',
      traders: final,
      diagnostics,
    }
    cacheSet(key, result)
    devLog('final hot traders', diagnostics)
    return result
    } catch (error) {
    const result: HotTraderLoadResult = {
      state: 'error',
      message: error instanceof Error ? error.message : 'Could not load hot traders',
      traders: [],
      diagnostics,
    }
    devLog('hot traders error', { error, diagnostics })
    return result
  }
}

// ─── Public exports ────────────────────────────────────────────────────────

// Category-level ranking (for discovery page Traders tab)
export async function rankTradersForEvents(events: PolyEvent[]): Promise<TraderRankEntry[]> {
  const tokenIds: string[] = []
  for (const ev of events.slice(0, 4)) {
    const m = ev.markets?.[0]
    if (!m?.clobTokenIds) continue
    try {
      const ids: string[] = JSON.parse(m.clobTokenIds)
      if (ids[0]) tokenIds.push(ids[0])
    } catch { /* skip */ }
  }
  const { traders } = await fetchAndRank(tokenIds)
  return traders
}

// Single-market intelligence (for Market Detail page — auto-loaded)
export async function rankTradersForMarket(event: PolyEvent): Promise<MarketIntelligence> {
  const tokenIds: string[] = []
  for (const m of (event.markets ?? []).slice(0, 3)) {
    if (!m.clobTokenIds) continue
    try {
      const ids: string[] = JSON.parse(m.clobTokenIds)
      tokenIds.push(...ids.slice(0, 2)) // include both outcome tokens
    } catch { /* skip */ }
  }

  const { traders, allTrades, priceMap } = await fetchAndRank(tokenIds, 2) // require ≥2 trades
  const bestTrades = findBestTrades(allTrades, priceMap, 10)

  return { traders, bestTrades, totalTrades: allTrades.length }
}

// Best entries in a market: trades where price moved most in the wallet's direction
export function findBestTrades(
  trades: WalletTrade[],
  priceMap: Map<string, number>,
  limit = 10,
): BestTrade[] {
  const result: BestTrade[] = []

  for (const t of trades) {
    const cur = priceMap.get(t.asset)
    if (cur === undefined || !t.price || t.price <= 0) continue

    const delta = t.side === 'BUY' ? cur - t.price : t.price - cur
    if (delta <= 0) continue // only favorable moves

    const profitMultiple = t.side === 'BUY' ? cur / t.price : t.price / cur

    result.push({
      address: t.proxyWallet,
      pseudonym: t.pseudonym,
      name: t.name,
      side: t.side,
      outcome: t.outcome,
      entryPrice: t.price,
      currentPrice: cur,
      delta,
      profitMultiple,
      sizeUSDC: t.usdcSize ?? 0,
      timestamp: t.timestamp,
      title: t.title,
      conditionId: t.conditionId,
      asset: t.asset,
    })
  }

  return result.sort((a, b) => b.delta - a.delta).slice(0, limit)
}

// Enrich top N traders with PnL/win rate from positions API
export async function enrichWithPnL(entries: TraderRankEntry[], topN = 5): Promise<TraderRankEntry[]> {
  const toEnrich = entries.slice(0, topN)
  const rest = entries.slice(topN)

  const enriched = await Promise.allSettled(
    toEnrich.map(async (e, idx) => {
      try {
        const positions = await getWalletPositions(e.address, 100)
        const withVal = positions.filter(p => (p.initialValue ?? 0) > 0)
        const pnl = withVal.reduce((s, p) => s + (p.cashPnl ?? 0), 0)
        const winners = withVal.filter(p => (p.cashPnl ?? 0) >= 0).length
        const winRate = withVal.length > 0 ? winners / withVal.length : null
        return { ...e, pnl, winRate }
      } catch {
        return toEnrich[idx]
      }
    })
  )

  return [
    ...enriched.map((r, i) => r.status === 'fulfilled' ? r.value : toEnrich[i]),
    ...rest,
  ]
}
