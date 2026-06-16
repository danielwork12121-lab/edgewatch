import type { WalletTrade, WalletPosition, WalletStats } from '../types'

const DATA_API = 'https://data-api.polymarket.com'

export async function getWalletActivity(address: string, limit = 100): Promise<WalletTrade[]> {
  const params = new URLSearchParams({ user: address, limit: String(limit) })
  const res = await fetch(`${DATA_API}/activity?${params}`)
  if (!res.ok) throw new Error(`Wallet API error: ${res.status}`)
  return res.json()
}

export async function getWalletPositions(address: string, limit = 50): Promise<WalletPosition[]> {
  const params = new URLSearchParams({ user: address, limit: String(limit) })
  const res = await fetch(`${DATA_API}/positions?${params}`)
  if (!res.ok) throw new Error(`Positions API error: ${res.status}`)
  return res.json()
}

export async function getMarketTrades(tokenId: string, limit = 100): Promise<WalletTrade[]> {
  const params = new URLSearchParams({ tokenId, limit: String(limit) })
  const res = await fetch(`${DATA_API}/trades?${params}`)
  if (!res.ok) throw new Error(`Trades API error: ${res.status}`)
  return res.json()
}

export function deriveWalletStats(address: string, trades: WalletTrade[]): WalletStats {
  const myTrades = trades.filter(t => t.proxyWallet.toLowerCase() === address.toLowerCase())
  const uniqueMarkets = new Set(myTrades.map(t => t.conditionId)).size
  const totalVol = myTrades.reduce((s, t) => s + (t.usdcSize ?? 0), 0)
  const avgSize = myTrades.length > 0 ? totalVol / myTrades.length : 0
  const latest = myTrades[0]

  return {
    address,
    pseudonym: latest?.pseudonym ?? '',
    name: latest?.name ?? '',
    totalTrades: myTrades.length,
    totalVolumeUSDC: totalVol,
    marketsTraded: uniqueMarkets,
    avgTradeSize: avgSize,
    winRate: null,
  }
}

export function filterNoise(trades: WalletTrade[], minSizeUSDC = 1): WalletTrade[] {
  return trades.filter(t => (t.usdcSize ?? 0) >= minSizeUSDC && t.type === 'TRADE')
}

export function groupTradesByMarket(trades: WalletTrade[]): Map<string, WalletTrade[]> {
  const map = new Map<string, WalletTrade[]>()
  for (const t of trades) {
    const key = t.conditionId
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }
  return map
}

export function truncateAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
