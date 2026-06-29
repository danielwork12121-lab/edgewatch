import { useState, useEffect, useCallback } from 'react'
import type { PolyEvent } from '../types'
import {
  toFiniteNumber,
  searchEvents,
  fetchTrending,
  searchByTag,
  parseOutcomePrices,
  formatUSD,
  formatPercent,
  timeRemaining,
  volatilityInfo,
} from '../api/polymarket'
import { CATEGORIES, type Category } from '../api/categories'
import { cacheGet, cacheSet, cacheTime, cacheInvalidate, TTL, formatAge } from '../api/cache'
import TraderRanking from './TraderRanking'

interface Props {
  onSelectEvent: (event: PolyEvent) => void
  onSelectWallet: (address: string) => void
  onViewWatchlist: () => void
  onViewPortfolio: () => void
}

type DiscoveryTab = 'markets' | 'traders'

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

  // ── Category loader ───────────────────────────────────────────────────────
  const loadCategory = useCallback((cat: Category, forceRefresh = false) => {
    const key = cat.tag ? `category:${cat.tag}` : 'trending'

    if (!forceRefresh) {
      const cached = cacheGet<PolyEvent[]>(key, TTL.markets)
      if (cached !== null) {
        setResults(cached)
        setLastUpdated(cacheTime(key))
        setLoading(false)
        return
      }
    }

    setLoading(true)
    setError(null)
    setResults([])
    const fetch = cat.tag ? searchByTag(cat.tag, 24) : fetchTrending(16)
    fetch
      .then(data => {
        cacheSet(key, data)
        setResults(data)
        setLastUpdated(Date.now())
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

  // ── Category pill click ───────────────────────────────────────────────────
  const handleCategoryClick = useCallback((cat: Category) => {
    setActiveCategory(cat)
    setTab('markets')
    setQuery('')
    setIsSearchMode(false)
    setActiveQuery('')
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

    const key = `search:${q}`
    const cached = cacheGet<PolyEvent[]>(key, TTL.markets)
    if (cached !== null) {
      setResults(cached)
      setLastUpdated(cacheTime(key))
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    setResults([])
    searchEvents(q)
      .then(data => {
        cacheSet(key, data)
        setResults(data)
        setLastUpdated(Date.now())
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Search failed'))
      .finally(() => setLoading(false))
  }, [query])

  // ── Clear search ──────────────────────────────────────────────────────────
  const clearSearch = useCallback(() => {
    setQuery('')
    setIsSearchMode(false)
    setActiveQuery('')
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
        .then(data => { cacheSet(key, data); setResults(data); setLastUpdated(Date.now()) })
        .catch(err => setError(err instanceof Error ? err.message : 'Search failed'))
        .finally(() => setLoading(false))
    } else {
      const key = activeCategory.tag ? `category:${activeCategory.tag}` : 'trending'
      cacheInvalidate(key)
      loadCategory(activeCategory, true)
    }
  }, [isSearchMode, activeQuery, activeCategory, loadCategory])

  // ── Heading ───────────────────────────────────────────────────────────────
  let headingText: string
  if (loading) {
    headingText = isSearchMode ? `Searching "${activeQuery}"…` : 'Loading markets…'
  } else if (isSearchMode) {
    headingText = `Results for "${activeQuery}" — ${results.length} market${results.length !== 1 ? 's' : ''}`
  } else if (activeCategory.id === 'trending') {
    headingText = '🔥 Trending Markets'
  } else {
    headingText = `${activeCategory.emoji} ${activeCategory.label} Markets`
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
        <p className="tagline">Identify and copy high-signal Polymarket traders</p>
      </header>

      {/* Category selector */}
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

      {/* Search form */}
      <form className="search-form" onSubmit={handleSearch} noValidate>
        <input
          className="search-input"
          type="text"
          autoFocus
          autoComplete="off"
          placeholder="Search: anime, AI, elections, BTC…"
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

      {error && <p className="error-msg">{error}</p>}

      {/* Heading + refresh bar — always visible */}
      <div className="section-heading">
        <h2 className="section-title">{headingText}</h2>
        <div className="refresh-bar">
          {lastUpdated && (
            <span className="last-updated">{formatAge(lastUpdated)}</span>
          )}
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

      {/* Tabs */}
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

      {/* Market grid */}
      {tab === 'markets' && (
        <>
          {loading && <p className="empty-msg">Loading…</p>}
          {!loading && results.length === 0 && !error && (
            <p className="empty-msg">
              {isSearchMode
                ? `No active markets found for "${activeQuery}".`
                : 'No markets found.'}
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

      {/* Trader ranking */}
      {tab === 'traders' && results.length > 0 && (
        <TraderRanking
          key={results.map(event => event.id).join(',')}
          events={results}
          categoryLabel={isSearchMode ? `"${activeQuery}"` : activeCategory.label}
          onSelectWallet={onSelectWallet}
          autoLoad
        />
      )}
    </div>
  )
}
