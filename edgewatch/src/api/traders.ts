import type { PolyEvent, WalletTrade, TraderRankEntry } from '../types'
import { getMarketTrades, getWalletPositions, truncateAddress } from './wallets'
import { fetchTrending, formatUSD, toFiniteNumber } from './polymarket'
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

// ─── Internal helper ───────────────────────────────────────────────────────

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

function computeHotScore(agg: HotWalletAgg, winRate: number | null, pnl: number | null): number {
  const recentVolume = agg.volume
  const recentTrades = agg.trades.length
  const marketsTraded = agg.markets.size
  const timingScore = agg.resolvedMoves > 0 ? agg.positiveMoves / agg.resolvedMoves : 0
  const volumeComponent = Math.min(35, Math.log10(recentVolume + 1) * 10)
  const activityComponent = Math.min(25, recentTrades * 4)
  const breadthComponent = Math.min(15, marketsTraded * 5)
  const timingComponent = Math.min(15, timingScore * 15)
  const pnlComponent = pnl === null ? 0 : Math.max(-8, Math.min(10, Math.log10(Math.abs(pnl) + 1) * (pnl >= 0 ? 2 : -2)))
  const winComponent = winRate === null ? 0 : Math.max(-5, Math.min(8, (winRate - 0.5) * 40))
  const oneOffPenalty = recentTrades <= 1 ? 25 : recentTrades <= 2 ? 10 : 0
  const score = volumeComponent + activityComponent + breadthComponent + timingComponent + pnlComponent + winComponent - oneOffPenalty
  return Math.max(0, Math.min(100, score))
}

function buildHotReasons(entry: HotTraderEntry, timingEdgeAvailable: boolean): string[] {
  const reasons: string[] = []
  reasons.push(`✓ ${entry.recentTradeCount} recent trades`)
  reasons.push(`✓ ${entry.marketsTraded} active market${entry.marketsTraded === 1 ? '' : 's'}`)
  reasons.push(`✓ ${formatUSD(entry.recentVolumeUSDC)} recent volume`)
  if (entry.winRate !== null) reasons.push(`✓ ${(entry.winRate * 100).toFixed(0)}% win rate on resolved positions`)
  else reasons.push('• Win rate unavailable')
  if (entry.pnl !== null) reasons.push(`✓ ${entry.pnl >= 0 ? '+' : ''}${formatUSD(entry.pnl)} PnL`)
  else reasons.push('• PnL unavailable')
  if (timingEdgeAvailable && entry.timingEdge !== null) {
    reasons.push(`✓ ${entry.timingEdge.toFixed(0)}% favorable price moves after entry`)
  } else {
    reasons.push('• Timing edge estimated from live prices')
  }
  return reasons.slice(0, 4)
}

function makeHotEntry(agg: HotWalletAgg, winRate: number | null, pnl: number | null): HotTraderEntry {
  const timingEdge = agg.resolvedMoves > 0 ? (agg.positiveMoves / agg.resolvedMoves) * 100 : null
  const hotScore = computeHotScore(agg, winRate, pnl)
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
    timingEdge,
    pnl,
    winRate,
    scoreReasons: [],
  }
  entry.scoreReasons = buildHotReasons(entry, timingEdge !== null)
  return entry
}

export async function fetchHotTraders(limit = 8): Promise<HotTraderEntry[]> {
  const key = `hot-traders:${limit}`
  const cached = cacheGet<HotTraderEntry[]>(key, TTL.hotTraders)
  if (cached !== null) return cached

  const trending = await fetchTrending(8)
  const tokenLiquidity = new Map<string, number>()
  const tokenIds: string[] = []

  for (const event of trending) {
    for (const market of event.markets ?? []) {
      const liquidity = toFiniteNumber(market.liquidity, 0)
      const ids = (() => {
        try {
          return market.clobTokenIds ? JSON.parse(market.clobTokenIds) : []
        } catch {
          return []
        }
      })()
      for (const id of ids.slice(0, 2)) {
        if (!id) continue
        tokenLiquidity.set(id, liquidity)
        tokenIds.push(id)
      }
    }
  }

  const uniqueTokenIds = [...new Set(tokenIds)].slice(0, 16)
  if (uniqueTokenIds.length === 0) {
    cacheSet(key, [])
    return []
  }

  const tradeSets = await Promise.allSettled(
    uniqueTokenIds.map(id => getMarketTrades(id, 120))
  )

  const recentWindow = Date.now() / 1000 - 72 * 60 * 60
  const allTrades = tradeSets
    .filter((r): r is PromiseFulfilledResult<WalletTrade[]> => r.status === 'fulfilled')
    .flatMap(r => r.value.filter(t => {
      const liquidity = tokenLiquidity.get(t.asset) ?? 0
      return t.type === 'TRADE' &&
        (t.usdcSize ?? 0) >= 10 &&
        liquidity >= 10_000 &&
        t.timestamp >= recentWindow
    }))

  if (allTrades.length === 0) {
    cacheSet(key, [])
    return []
  }

  const walletMap = new Map<string, HotWalletAgg>()
  for (const trade of allTrades) {
    const addr = trade.proxyWallet
    if (!addr) continue
    if (!walletMap.has(addr)) {
      walletMap.set(addr, {
        address: addr,
        pseudonym: trade.pseudonym ?? '',
        name: trade.name ?? '',
        trades: [],
        volume: 0,
        markets: new Map(),
        positiveMoves: 0,
        resolvedMoves: 0,
      })
    }
    const agg = walletMap.get(addr)!
    agg.trades.push(trade)
    agg.volume += trade.usdcSize ?? 0
    agg.markets.set(trade.conditionId, {
      label: trade.title || trade.eventSlug || trade.slug || 'Unknown market',
      count: (agg.markets.get(trade.conditionId)?.count ?? 0) + 1,
      lastTs: trade.timestamp,
    })
  }

  const prequalified = [...walletMap.values()]
    .filter(agg => agg.trades.length >= 2 && agg.volume >= 50 && agg.markets.size >= 2)
    .sort((a, b) => {
      const aScore = computeHotScore(a, null, null)
      const bScore = computeHotScore(b, null, null)
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
    .map((agg): HotTraderEntry => makeHotEntry(agg, null, null))
    .sort((a, b) => b.hotScore - a.hotScore)
    .slice(0, limit)

  const enriched = await Promise.allSettled(
    ranked.map(async entry => {
      try {
        const positions = await getWalletPositions(entry.address, 100)
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

  const final = enriched.map((result, i) => result.status === 'fulfilled' ? result.value : ranked[i])
  cacheSet(key, final)
  return final
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
