// Module-level in-memory cache — survives React re-renders and remounts,
// cleared only on full browser reload (intentional: keeps tab-switching instant).

interface Entry<T> { data: T; fetchedAt: number }

const store = new Map<string, Entry<unknown>>()

export const TTL = {
  markets:      2 * 60_000,   // 2 min  — category/search results
  intelligence: 5 * 60_000,   // 5 min  — market trader intelligence
  hotTraders:   2 * 60_000,   // 2 min  — hot trader feed
  discovery:    4 * 60_000,   // 4 min  — candidate discovery scans
  wallet:       3 * 60_000,   // 3 min  — wallet activity + positions
  price:        30_000,        // 30 sec — individual CLOB prices
  history:      10 * 60_000,  // 10 min — CLOB price history
}

export function cacheGet<T>(key: string, ttlMs: number): T | null {
  const e = store.get(key) as Entry<T> | undefined
  if (!e) return null
  if (Date.now() - e.fetchedAt > ttlMs) return null
  return e.data
}

export function cacheSet<T>(key: string, data: T): void {
  store.set(key, { data, fetchedAt: Date.now() })
}

export function cacheTime(key: string): number | null {
  return store.get(key)?.fetchedAt ?? null
}

export function cacheInvalidate(...keys: string[]): void {
  keys.forEach(k => store.delete(k))
}

export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

export function formatAge(fetchedAt: number | null): string {
  if (fetchedAt === null) return ''
  const sec = Math.floor((Date.now() - fetchedAt) / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}
