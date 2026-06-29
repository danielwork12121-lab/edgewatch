import { useState, useEffect, useCallback } from 'react'
import type { PolyEvent } from '../types'
import {
  toFiniteNumber,
  searchEvents,
  fetchTrending,
  filterEventsByKeywords,
  filterEventsByQuery,
  parseOutcomePrices,
  formatUSD,
  formatPercent,
  timeRemaining,
  volatilityInfo,
} from '../api/polymarket'
import { CATEGORIES, getCategoryKeywords, type Category } from '../api/categories'
import { cacheGet, cacheSet, cacheTime, cacheInvalidate, TTL, formatAge } from '../api/cache'
import HotTradersFeed from './HotTradersFeed'
import TraderRanking from './TraderRanking'

interface Props {
  onSelectEvent: (event: PolyEvent) => void
  onSelectWallet: (address: string) => void
  onViewWatchlist: () => void
  onViewPortfolio: () => void
}

type DiscoveryTab = 'markets' | 'traders'

const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug('[EdgeWatch]', ...args)
}

function marketApiUrl(category: Category, query?: string) {
  if (query) {
    const params = new URLSearchParams({
      q: query,
      active: 'true',
      closed: 'false',
      limit: '24',
      order: 'volume',
      ascending: 'false',
    })
    return `https://gamma-api.polymarket.com/events?${params}`
  }

  if (category.tag) {
    const params = new URLSearchParams({
      tag: category.tag,
      active: 'true',
      closed: 'false',
      limit: '24',
      order: 'volume',
      ascending: 'false',
    })
    return `https://gamma-api.polymarket.com/events?${params}`
  }

  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    limit: '16',
    order: 'volume',
    ascending: 'false',
  })
  return `https://gamma-api.polymarket.com/events?${params}`
}

function uniqueEvents(events: PolyEvent[]): PolyEvent[] {
  const seen = new Set<string>()
  return events.filter(event => {
    if (seen.has(event.id)) return false
    seen.add(event.id)
    return true
  })
}

function MarketCard({ event, onClick }: { event: PolyEvent; onClick: () => void }) {
  const m = event.markets?.[0]
  const prices = m ? parseOutcomePrices(m.outcomePrices) : []
  const yesPrice = prices[0] ?? null
  const vol = volatilityInfo(m?.oneDayPriceChange)
  const remain = timeRemaining(event.endDate)
  const volumeValue = toFiniteNumber(event.volume24hr ?? event.volume, Number.NaN)
  const marketLiquidityValues = (event.markets ?? [])
    .map(mk => toFiniteNumber(mk.liquidity, Number.NaN))
    .filter(Number.isFinite)
  const liquidityValue = marketLiquidityValues.length > 0
    ? marketLiquidityValues.reduce((sum, value) => sum + value, 0)
    : toFiniteNumber(event.liquidity, Number.NaN)
  const volumeLabel = Number.isFinite(volumeValue) ? formatUSD(volumeValue) : '—'
  const liquidityLabel = Number.isFinite(liquidityValue) ? formatUSD(liquidityValue) : '—'

  return (
    <button type="button" className="market-card" onClick={onClick}>
      {event.image && (
        <img className="market-img" src={event.image} alt="" loading="lazy" />
      )}
      <div className="market-card-body">
        <p className="market-title">{event.title}</p>
        <div className="market-stats">
          {yesPrice !== null && (
            <span className="stat prob">{formatPercent(yesPrice)}</span>
          )}
          {yesPrice === null && (
            <span className="stat prob">—</span>
          )}
          <span className="stat vol">Vol {volumeLabel}</span>
          <span className="stat liq">Liq {liquidityLabel}</span>
          <span className={`stat vol-indicator vol-${vol.level}`}>{vol.level !== 'low' ? vol.label : ''} vol</span>
          <span className="stat date">{remain}</span>
        </div>
      </div>
    </button>
  )
}

export default function MarketSearch({
  onSelectEvent,
  onSelectWallet,
  onViewWatchlist,
  onViewPortfolio,
}: Props) {
  const [activeCategory, setActiveCategory] = useState<Category>(CATEGORIES[0])
  const [tab, setTab] = useState<DiscoveryTab>('markets')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PolyEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSearchMode, setIsSearchMode] = useState(false)
  const [activeQuery, setActiveQuery] = useState('')
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [filterTouched, setFilterTouched] = useState(false)
  const [trendingMarkets, setTrendingMarkets] = useState<PolyEvent[]>([])
  const [trendingLoading, setTrendingLoading] = useState(true)
  const [trendingError, setTrendingError] = useState<string | null>(null)
  const [trendingUpdated, setTrendingUpdated] = useState<number | null>(null)

  const loadTrending = useCallback((forceRefresh = false) => {
    const key = 'homepage:trending'
    if (!forceRefresh) {
      const cached = cacheGet<PolyEvent[]>(key, TTL.markets)
      if (cached !== null) {
        setTrendingMarkets(cached)
        setTrendingError(null)
        setTrendingUpdated(cacheTime(key))
        setTrendingLoading(false)
        devLog('trending cache hit', {
          apiUrl: marketApiUrl(CATEGORIES[0]),
          rawCount: cached.length,
          filteredCount: cached.length,
          titles: cached.slice(0, 5).map(event => event.title),
        })
        return
      }
    }

    setTrendingLoading(true)
    setTrendingError(null)
    fetchTrending(16)
      .then(data => {
        const sorted = [...data].sort((a, b) => {
          const aVol = toFiniteNumber(a.volume24hr ?? a.volume, 0)
          const bVol = toFiniteNumber(b.volume24hr ?? b.volume, 0)
          return bVol - aVol
        })
        cacheSet(key, sorted)
        setTrendingMarkets(sorted)
        setTrendingUpdated(Date.now())
        devLog('trending fetch', {
          apiUrl: marketApiUrl(CATEGORIES[0]),
          rawCount: data.length,
          filteredCount: sorted.length,
          titles: sorted.slice(0, 5).map(event => event.title),
        })
      })
      .catch(e => setTrendingError(e instanceof Error ? e.message : 'Failed to load trending markets'))
      .finally(() => setTrendingLoading(false))
  }, [])

  // ── Category loader ───────────────────────────────────────────────────────
  const loadCategory = useCallback((cat: Category, forceRefresh = false) => {
    const key = `category:${cat.id}`
    const keywords = cat.id === 'trending' ? [] : getCategoryKeywords(cat.id)
    const seedTerms = cat.id === 'trending'
      ? []
      : keywords.slice(0, 4)
    const requestUrls = seedTerms.map(term => marketApiUrl(cat, term))

    if (!forceRefresh) {
      const cached = cacheGet<PolyEvent[]>(key, TTL.markets)
      if (cached !== null) {
        setResults(cached)
        setError(null)
        setLastUpdated(cacheTime(key))
        setLoading(false)
        devLog('category cache hit', {
          category: cat.id,
          apiUrl: requestUrls,
          rawCount: cached.length,
          filteredCount: cached.length,
          titles: cached.slice(0, 5).map(event => event.title),
        })
        return
      }
    }

    setLoading(true)
    setError(null)
    setResults([])
    const fetchCategory = async () => {
      if (cat.id === 'trending') {
        const data = await fetchTrending(16)
        return data
      }

      if (seedTerms.length === 0) return []

      const batches = await Promise.allSettled(
        seedTerms.map(term => searchEvents(term))
      )
      return uniqueEvents(
        batches.flatMap(result => result.status === 'fulfilled' ? result.value : [])
      )
    }

    fetchCategory()
      .then(data => {
        const filtered = cat.id === 'trending' ? data : filterEventsByKeywords(data, keywords)
        const sorted = [...filtered].sort((a, b) => {
          const aVol = toFiniteNumber(a.volume24hr ?? a.volume, 0)
          const bVol = toFiniteNumber(b.volume24hr ?? b.volume, 0)
          return bVol - aVol
        })
        cacheSet(key, sorted)
        setResults(sorted)
        setLastUpdated(Date.now())
        devLog('category fetch', {
          category: cat.id,
          apiUrl: requestUrls,
          rawCount: data.length,
          filteredCount: sorted.length,
          titles: sorted.slice(0, 5).map(event => event.title),
        })
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load markets'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadCategory(CATEGORIES[0])
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadCategory])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadTrending()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadTrending])

  // ── Category pill click ───────────────────────────────────────────────────
  const handleCategoryClick = useCallback((cat: Category) => {
    setActiveCategory(cat)
    setTab('markets')
    setQuery('')
    setIsSearchMode(false)
    setActiveQuery('')
    setFilterTouched(true)
    loadCategory(cat)
  }, [loadCategory])

  // ── Search submission ─────────────────────────────────────────────────────
  // Synchronous handler — e.preventDefault() fires before any async work.
  const handleSearch = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return

    setTab('markets')
    setIsSearchMode(true)
    setActiveQuery(q)
    setFilterTouched(true)

    const key = `search:${q}`
    const cached = cacheGet<PolyEvent[]>(key, TTL.markets)
    if (cached !== null) {
      setResults(cached)
      setError(null)
      setLastUpdated(cacheTime(key))
      setLoading(false)
      devLog('search cache hit', {
        query: q,
        apiUrl: marketApiUrl(activeCategory, q),
        rawCount: cached.length,
        filteredCount: cached.length,
        titles: cached.slice(0, 5).map(event => event.title),
      })
      return
    }

    setLoading(true)
    setError(null)
    setResults([])
    searchEvents(q)
      .then(data => {
        const filtered = filterEventsByQuery(data, q)
        cacheSet(key, filtered)
        setResults(filtered)
        setLastUpdated(Date.now())
        devLog('search fetch', {
          query: q,
          apiUrl: marketApiUrl(activeCategory, q),
          rawCount: data.length,
          filteredCount: filtered.length,
          titles: filtered.slice(0, 5).map(event => event.title),
        })
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Search failed'))
      .finally(() => setLoading(false))
  }, [query, activeCategory])

  // ── Clear search ──────────────────────────────────────────────────────────
  const clearSearch = useCallback(() => {
    setQuery('')
    setIsSearchMode(false)
    setActiveQuery('')
    setFilterTouched(activeCategory.id !== 'trending')
    loadCategory(activeCategory)
  }, [activeCategory, loadCategory])

  // ── Refresh current view ──────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    if (isSearchMode && activeQuery) {
      const key = `search:${activeQuery}`
      cacheInvalidate(key)
      setLoading(true)
      setError(null)
      setResults([])
      searchEvents(activeQuery)
        .then(data => {
          const filtered = filterEventsByQuery(data, activeQuery)
          cacheSet(key, filtered)
          setResults(filtered)
          setLastUpdated(Date.now())
          devLog('search refresh', {
            query: activeQuery,
            apiUrl: marketApiUrl(activeCategory, activeQuery),
            rawCount: data.length,
            filteredCount: filtered.length,
            titles: filtered.slice(0, 5).map(event => event.title),
          })
        })
        .catch(err => setError(err instanceof Error ? err.message : 'Search failed'))
        .finally(() => setLoading(false))
    } else {
      const key = `category:${activeCategory.id}`
      cacheInvalidate(key)
      loadCategory(activeCategory, true)
    }
  }, [isSearchMode, activeQuery, activeCategory, loadCategory])

  // ── Heading ───────────────────────────────────────────────────────────────
  let headingText: string | null = null
  if (loading) {
    headingText = isSearchMode ? `Searching "${activeQuery}"…` : 'Loading markets…'
  } else if (isSearchMode && results.length > 0) {
    headingText = `Results for "${activeQuery}" — ${results.length} relevant market${results.length !== 1 ? 's' : ''}`
  } else if (!isSearchMode && activeCategory.id === 'trending' && results.length > 0) {
    headingText = '🔥 Trending Markets'
  } else if (!isSearchMode && activeCategory.id !== 'trending' && results.length > 0) {
    headingText = `${activeCategory.emoji} ${activeCategory.label} Markets (${results.length} relevant)`
  }

  return (
    <div className="search-page">
      <header className="app-header">
        <div className="app-header-top">
          <h1 className="logo">EdgeWatch</h1>
          <div className="nav-links">
            <button type="button" className="nav-link" onClick={onViewWatchlist}>★ Watchlist</button>
            <button type="button" className="nav-link" onClick={onViewPortfolio}>Paper Portfolio</button>
          </div>
        </div>
        <p className="tagline">Watch traders first, then use markets and filters to narrow in.</p>
      </header>

      <HotTradersFeed onSelectWallet={onSelectWallet} />

      <section className="homepage-section">
        <div className="section-heading">
          <div>
            <h2 className="section-title">Trending Markets</h2>
            <p className="section-subtitle">Broad market tape from active Polymarket events.</p>
          </div>
          <div className="refresh-bar">
            {trendingUpdated && <span className="last-updated">{formatAge(trendingUpdated)}</span>}
            <button
              type="button"
              className="refresh-btn"
              onClick={() => loadTrending(true)}
              disabled={trendingLoading}
              title="Refresh trending markets"
            >
              ↻
            </button>
          </div>
        </div>
        {trendingError && <p className="error-msg">{trendingError}</p>}
        {trendingLoading && <p className="empty-msg">Loading trending markets…</p>}
        {!trendingLoading && trendingMarkets.length === 0 && !trendingError && (
          <p className="empty-msg">No trending markets found.</p>
        )}
        {trendingMarkets.length > 0 && (
          <div className="results-grid">
            {trendingMarkets.slice(0, 8).map(event => (
              <MarketCard
                key={event.id}
                event={event}
                onClick={() => onSelectEvent(event)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="homepage-section">
        <form className="search-form" onSubmit={handleSearch} noValidate>
          <input
            className="search-input"
            type="text"
            autoComplete="off"
            placeholder="Search Polymarket: anime, AI, elections, BTC…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button className="search-btn" type="submit" disabled={loading}>
            {loading && isSearchMode ? '…' : 'Search'}
          </button>
          {isSearchMode && (
            <button type="button" className="back-btn" onClick={clearSearch}>✕ Clear</button>
          )}
        </form>

        <div className="category-bar">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              type="button"
              className={`category-pill ${!isSearchMode && activeCategory.id === cat.id ? 'active' : ''}`}
              onClick={() => handleCategoryClick(cat)}
            >
              <span className="category-emoji">{cat.emoji}</span> {cat.label}
            </button>
          ))}
        </div>
      </section>

      {error && <p className="error-msg">{error}</p>}

      {filterTouched && (isSearchMode || activeCategory.id !== 'trending') && (
        <section className="homepage-section">
          <div className="section-heading">
            {headingText && <h2 className="section-title">{headingText}</h2>}
            <div className="refresh-bar">
              {lastUpdated && <span className="last-updated">{formatAge(lastUpdated)}</span>}
              <button
                type="button"
                className="refresh-btn"
                onClick={handleRefresh}
                disabled={loading}
                title="Refresh data"
              >
                ↻
              </button>
            </div>
          </div>

          {results.length > 0 && !loading && (
            <div className="tab-bar">
              <button
                type="button"
                className={`tab-btn ${tab === 'markets' ? 'active' : ''}`}
                onClick={() => setTab('markets')}
              >
                Markets ({results.length})
              </button>
              <button
                type="button"
                className={`tab-btn ${tab === 'traders' ? 'active' : ''}`}
                onClick={() => setTab('traders')}
              >
                {isSearchMode
                  ? `Top Traders for "${activeQuery}"`
                  : `Top ${activeCategory.label} Traders`}
              </button>
            </div>
          )}

          {tab === 'markets' && (
            <>
              {loading && <p className="empty-msg">Loading…</p>}
              {!loading && results.length === 0 && !error && (
                <p className="empty-msg">
                  {isSearchMode
                    ? `No active ${activeQuery} markets found on Polymarket right now.`
                    : `No relevant active ${activeCategory.label} markets found.`}
                </p>
              )}
              {results.length > 0 && (
                <div className="results-grid">
                  {results.map(event => (
                    <MarketCard
                      key={event.id}
                      event={event}
                      onClick={() => onSelectEvent(event)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'traders' && results.length > 0 && (
            <TraderRanking
              key={results.map(event => event.id).join(',')}
              events={results}
              categoryLabel={isSearchMode ? `"${activeQuery}"` : activeCategory.label}
              onSelectWallet={onSelectWallet}
              autoLoad
            />
          )}
        </section>
      )}
    </div>
  )
}
