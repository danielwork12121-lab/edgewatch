import type { PolyEvent } from '../types'

export interface WatchedWallet {
  address: string
  pseudonym: string
  name: string
  addedAt: number
  lastChecked: number | null
  recentTradeCount: number
}

export interface WatchedMarket {
  eventId: string
  slug: string
  title: string
  image: string | null
  endDate: string | null
  addedAt: number
  lastVol: number
  lastLiq: number
}

export interface Watchlist {
  wallets: WatchedWallet[]
  markets: WatchedMarket[]
}

const KEY = 'edgewatch_watchlist'

export function loadWatchlist(): Watchlist {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { wallets: [], markets: [] }
    return JSON.parse(raw)
  } catch {
    return { wallets: [], markets: [] }
  }
}

function save(w: Watchlist): void {
  localStorage.setItem(KEY, JSON.stringify(w))
}

export function watchWallet(
  address: string,
  pseudonym: string,
  name: string,
): Watchlist {
  const w = loadWatchlist()
  if (w.wallets.some(x => x.address.toLowerCase() === address.toLowerCase())) return w
  w.wallets.unshift({ address, pseudonym, name, addedAt: Date.now(), lastChecked: null, recentTradeCount: 0 })
  save(w)
  return w
}

export function unwatchWallet(address: string): Watchlist {
  const w = loadWatchlist()
  w.wallets = w.wallets.filter(x => x.address.toLowerCase() !== address.toLowerCase())
  save(w)
  return w
}

export function isWatchingWallet(address: string): boolean {
  return loadWatchlist().wallets.some(x => x.address.toLowerCase() === address.toLowerCase())
}

export function watchMarket(event: PolyEvent): Watchlist {
  const w = loadWatchlist()
  if (w.markets.some(x => x.eventId === event.id)) return w
  w.markets.unshift({
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    image: event.image,
    endDate: event.endDate,
    addedAt: Date.now(),
    lastVol: event.volume ?? 0,
    lastLiq: event.liquidity ?? 0,
  })
  save(w)
  return w
}

export function unwatchMarket(eventId: string): Watchlist {
  const w = loadWatchlist()
  w.markets = w.markets.filter(x => x.eventId !== eventId)
  save(w)
  return w
}

export function isWatchingMarket(eventId: string): boolean {
  return loadWatchlist().markets.some(x => x.eventId === eventId)
}
