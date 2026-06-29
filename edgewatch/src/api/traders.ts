import type { PolyEvent, WalletTrade, TraderRankEntry } from '../types'
import { getMarketTrades, getWalletPositions } from './wallets'
import { batchFetchPrices } from './priceTracker'

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
