import type { PolyEvent, PolyMarket } from '../types'

const GAMMA = 'https://gamma-api.polymarket.com'

export function toFiniteNumber(value: unknown, fallback = 0): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim())
        : Number(value)
  return Number.isFinite(n) ? n : fallback
}

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

export async function fetchTrending(limit = 12): Promise<PolyEvent[]> {
  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    limit: String(limit),
    order: 'volume',
    ascending: 'false',
  })
  const res = await fetch(`${GAMMA}/events?${params}`)
  if (!res.ok) throw new Error(`Polymarket API error: ${res.status}`)
  return res.json()
}

export async function searchByTag(tag: string, limit = 24): Promise<PolyEvent[]> {
  const params = new URLSearchParams({
    tag,
    active: 'true',
    closed: 'false',
    limit: String(limit),
    order: 'volume',
    ascending: 'false',
  })
  const res = await fetch(`${GAMMA}/events?${params}`)
  if (!res.ok) throw new Error(`Polymarket API error: ${res.status}`)
  return res.json()
}

export function timeRemaining(endDateIso: string | null): string {
  if (!endDateIso) return '—'
  const diff = new Date(endDateIso).getTime() - Date.now()
  if (diff <= 0) return 'Closed'
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)
  if (days > 60) return `${Math.floor(days / 30)}mo`
  if (days > 0) return `${days}d ${hours}h`
  return `${hours}h`
}

export function volatilityInfo(oneDayChange: unknown): { label: string; level: 'low' | 'med' | 'high' } {
  const abs = Math.abs(toFiniteNumber(oneDayChange))
  if (abs >= 0.08) return { label: 'High', level: 'high' }
  if (abs >= 0.03) return { label: 'Med', level: 'med' }
  return { label: 'Low', level: 'low' }
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

export function parseOutcomePrices(raw: unknown): number[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed.map(value => toFiniteNumber(value, Number.NaN))
  } catch {
    return []
  }
}

export function parseOutcomes(raw: unknown): string[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function formatUSD(value: unknown): string {
  const n = toFiniteNumber(value, Number.NaN)
  if (!Number.isFinite(n)) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export function formatPercent(value: unknown, digits = 0): string {
  const n = toFiniteNumber(value, Number.NaN)
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(digits)}%`
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase()
  if (Array.isArray(value)) return value.map(normalizeText).join(' ')
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).map(normalizeText).join(' ')
  return String(value ?? '').toLowerCase()
}

export function getEventSearchText(event: PolyEvent): string {
  const markets = Array.isArray(event.markets) ? event.markets : []
  const marketText = markets
    .flatMap(market => [
      market.question,
      market.slug,
      market.outcomes,
      market.outcomePrices,
      market.clobTokenIds,
      market.conditionId,
      (market as { description?: unknown }).description,
    ])
    .map(normalizeText)
    .join(' ')

  const eventText = [
    event.title,
    event.slug,
    event.image,
    event.icon,
    event.startDate,
    event.endDate,
    (event as { description?: unknown }).description,
    event.tags?.map(tag => [tag.label, tag.slug, tag.id].filter(Boolean).join(' ')).join(' '),
    marketText,
  ]
    .map(normalizeText)
    .join(' ')

  return eventText.replace(/\s+/g, ' ').trim()
}

export function filterEventsByKeywords(events: PolyEvent[], keywords: string[]): PolyEvent[] {
  if (keywords.length === 0) return events
  const lowered = keywords.map(keyword => keyword.toLowerCase())
  return events.filter(event => {
    const text = getEventSearchText(event)
    return lowered.some(keyword => text.includes(keyword))
  })
}

export function filterEventsByQuery(events: PolyEvent[], query: string): PolyEvent[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(term => term.trim())
    .filter(term => term.length >= 2)
  if (terms.length === 0) return []
  return events.filter(event => {
    const text = getEventSearchText(event)
    return terms.every(term => text.includes(term))
  })
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function buildPolymarketMarketUrl(slug?: string | null): string | null {
  if (typeof slug !== 'string') return null
  const clean = slug.trim()
  if (!clean) return null
  if (!/^[a-z0-9-]+$/i.test(clean)) return null
  return `https://polymarket.com/market/${clean}`
}
