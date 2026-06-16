import type { PolyEvent, PolyMarket } from '../types'

const GAMMA = 'https://gamma-api.polymarket.com'

export async function searchEvents(query: string): Promise<PolyEvent[]> {
  const params = new URLSearchParams({
    q: query,
    active: 'true',
    closed: 'false',
    limit: '24',
    order: 'volume',
    ascending: 'false',
  })
  const res = await fetch(`${GAMMA}/events?${params}`)
  if (!res.ok) throw new Error(`Polymarket API error: ${res.status}`)
  return res.json()
}

export async function getEvent(id: string): Promise<PolyEvent> {
  const res = await fetch(`${GAMMA}/events/${id}`)
  if (!res.ok) throw new Error(`Polymarket API error: ${res.status}`)
  return res.json()
}

export async function getMarket(id: string): Promise<PolyMarket> {
  const res = await fetch(`${GAMMA}/markets/${id}`)
  if (!res.ok) throw new Error(`Polymarket API error: ${res.status}`)
  return res.json()
}

export function parseOutcomePrices(raw: string): number[] {
  try {
    return JSON.parse(raw).map(Number)
  } catch {
    return []
  }
}

export function parseOutcomes(raw: string): string[] {
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function formatUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
