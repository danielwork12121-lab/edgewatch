const DATA_API = 'https://data-api.polymarket.com'

// Fetch the most recent trade price for a specific outcome token (CLOB token ID).
// Returns null if the token has no trades or the request fails.
export async function fetchTokenPrice(tokenId: string): Promise<number | null> {
  try {
    const res = await fetch(`${DATA_API}/trades?tokenId=${encodeURIComponent(tokenId)}&limit=1`)
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    const price = data[0]?.price
    return typeof price === 'number' ? price : null
  } catch {
    return null
  }
}

// Fetch prices for up to 20 unique token IDs in parallel.
// Returns a Map<tokenId, latestTradePrice>.
export async function batchFetchPrices(tokenIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(tokenIds.filter(Boolean))].slice(0, 20)
  const settled = await Promise.allSettled(unique.map(id => fetchTokenPrice(id)))
  const map = new Map<string, number>()
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value !== null) {
      map.set(unique[i], result.value)
    }
  })
  return map
}
