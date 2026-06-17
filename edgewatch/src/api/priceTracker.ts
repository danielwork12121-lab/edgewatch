import { cacheGet, cacheSet, TTL } from './cache'

const DATA_API = 'https://data-api.polymarket.com'

export async function fetchTokenPrice(tokenId: string): Promise<number | null> {
  const key = `price:${tokenId}`
  const cached = cacheGet<number>(key, TTL.price)
  if (cached !== null) return cached

  try {
    const res = await fetch(`${DATA_API}/trades?tokenId=${encodeURIComponent(tokenId)}&limit=1`)
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    const price = data[0]?.price
    if (typeof price !== 'number') return null
    cacheSet(key, price)
    return price
  } catch {
    return null
  }
}

// Fetch prices for up to 20 unique token IDs.
// Cached tokens are resolved instantly; only uncached tokens hit the network.
export async function batchFetchPrices(tokenIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(tokenIds.filter(Boolean))].slice(0, 20)
  const map = new Map<string, number>()

  const toFetch: string[] = []
  for (const id of unique) {
    const cached = cacheGet<number>(`price:${id}`, TTL.price)
    if (cached !== null) {
      map.set(id, cached)
    } else {
      toFetch.push(id)
    }
  }

  if (toFetch.length > 0) {
    const settled = await Promise.allSettled(toFetch.map(id => fetchTokenPrice(id)))
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value !== null) {
        map.set(toFetch[i], result.value)
        // fetchTokenPrice already writes to cache
      }
    })
  }

  return map
}
