import type { PolyEvent, WalletTrade, TraderRankEntry } from '../types'
import { getMarketTrades } from './wallets'
import { batchFetchPrices } from './priceTracker'
import { getWalletPositions } from './wallets'

// Fetch recent trades from the top markets of an event set,
// then rank unique wallets by volume + timing edge.
export async function rankTradersForEvents(events: PolyEvent[]): Promise<TraderRankEntry[]> {
  // Collect token IDs from the top 4 events (first market per event)
  const tokenIds: string[] = []
  for (const ev of events.slice(0, 4)) {
    const m = ev.markets?.[0]
    if (!m?.clobTokenIds) continue
    try {
      const ids: string[] = JSON.parse(m.clobTokenIds)
      if (ids[0]) tokenIds.push(ids[0])
    } catch { /* skip */ }
  }
  if (tokenIds.length === 0) return []

  // Fetch recent trades from each market in parallel
  const tradeSets = await Promise.allSettled(tokenIds.map(id => getMarketTrades(id, 300)))
  const allTrades: WalletTrade[] = tradeSets
    .filter((r): r is PromiseFulfilledResult<WalletTrade[]> => r.status === 'fulfilled')
    .flatMap(r => r.value.filter(t => t.type === 'TRADE' && (t.usdcSize ?? 0) >= 1))

  if (allTrades.length === 0) return []

  // Fetch current prices for unique assets to compute timing score
  const uniqueAssets = [...new Set(allTrades.map(t => t.asset).filter(Boolean))].slice(0, 20)
  const priceMap = await batchFetchPrices(uniqueAssets)

  // Aggregate by wallet
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

  // Sort by volume, take top 25
  const ranked = [...walletMap.entries()]
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

  return ranked
}

// Enrich the top N traders with PnL/win rate from positions API
export async function enrichWithPnL(entries: TraderRankEntry[], topN = 5): Promise<TraderRankEntry[]> {
  const toEnrich = entries.slice(0, topN)
  const rest = entries.slice(topN)

  const enriched = await Promise.allSettled(
    toEnrich.map(async e => {
      try {
        const positions = await getWalletPositions(e.address, 100)
        const withVal = positions.filter(p => (p.initialValue ?? 0) > 0)
        const pnl = withVal.reduce((s, p) => s + (p.cashPnl ?? 0), 0)
        const winners = withVal.filter(p => (p.cashPnl ?? 0) >= 0).length
        const winRate = withVal.length > 0 ? winners / withVal.length : null
        return { ...e, pnl, winRate }
      } catch {
        return e
      }
    })
  )

  return [
    ...enriched.map(r => r.status === 'fulfilled' ? r.value : toEnrich[0]),
    ...rest,
  ]
}
