import { useState, useEffect, useCallback } from 'react'
import type { PolyEvent } from '../types'
import {
  searchEvents,
  fetchTrending,
  searchByTag,
  parseOutcomePrices,
  formatUSD,
  timeRemaining,
  volatilityInfo,
} from '../api/polymarket'
import { CATEGORIES, type Category } from '../api/categories'
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
  const totalLiq = (event.markets ?? []).reduce((s, mk) => s + (mk.liquidity ?? 0), 0)

  return (
    <button type="button" className="market-card" onClick={onClick}>
      {event.image && (
        <img className="market-img" src={event.image} alt="" loading="lazy" />
      )}
      <div className="market-card-body">
        <p className="market-title">{event.title}</p>
        <div className="market-stats">
          {yesPrice !== null && (
            <span className="stat prob">{(yesPrice * 100).toFixed(0)}%</span>
          )}
          <span className="stat vol">Vol {formatUSD(event.volume24hr ?? event.volume ?? 0)}</span>
          <span className="stat liq">Liq {formatUSD(totalLiq || (event.liquidity ?? 0))}</span>
          <span className={`stat vol-indicator vol-${vol.level}`}>{vol.label} vol</span>
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
  const [activeQuery, setActiveQuery] = useState('') // query that produced current results

  // ── Category loader ───────────────────────────────────────────────────────
  const loadCategory = useCallback((cat: Category) => {
    setLoading(true)
    setError(null)
    setResults([])        // clear stale results immediately
    setIsSearchMode(false)
    setActiveQuery('')
    const fetch = cat.tag ? searchByTag(cat.tag, 24) : fetchTrending(16)
    fetch
      .then(data => setResults(data))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load markets'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadCategory(CATEGORIES[0])
  }, [loadCategory])

  // ── Category pill click ───────────────────────────────────────────────────
  const handleCategoryClick = useCallback((cat: Category) => {
    setActiveCategory(cat)
    setTab('markets')
    setQuery('')            // clear the text input
    loadCategory(cat)
  }, [loadCategory])

  // ── Search submission ─────────────────────────────────────────────────────
  // Synchronous handler (not async) — e.preventDefault() is called first,
  // then the API call is driven via .then()/.catch() to avoid any async/event
  // interaction issues.
  const handleSearch = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()      // must be first — stops browser page refresh
    const q = query.trim()
    if (!q) return
    setTab('markets')       // always reset to markets tab
    setIsSearchMode(true)
    setActiveQuery(q)       // store what was actually searched
    setLoading(true)
    setError(null)
    setResults([])          // clear stale results so old data doesn't show through
    searchEvents(q)
      .then(data => setResults(data))
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

  // ── Heading text — always computed, never hidden ──────────────────────────
  let headingText: string
  if (loading) {
    headingText = isSearchMode ? `Searching for "${activeQuery}"…` : 'Loading markets…'
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

      {/* Category selector — all buttons explicitly type="button" */}
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

      {/*
        Search form:
        - value bound to `query` state (controlled input)
        - onChange keeps state in sync on every keystroke
        - onSubmit fires on Enter key OR button click
        - e.preventDefault() stops browser page refresh
        - submit button is type="submit"; clear button is type="button"
      */}
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
          <button type="button" className="back-btn" onClick={clearSearch}>
            ✕ Clear
          </button>
        )}
      </form>

      {error && <p className="error-msg">{error}</p>}

      {/* Heading — always visible so the user always knows what they're seeing */}
      <div className="section-heading">
        <h2 className="section-title">{headingText}</h2>
        {!loading && !isSearchMode && results.length > 0 && (
          <span className="data-badge">Live · Polymarket</span>
        )}
      </div>

      {/* Tabs — only when results are loaded */}
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
          events={results}
          categoryLabel={isSearchMode ? `"${activeQuery}"` : activeCategory.label}
          onSelectWallet={onSelectWallet}
          autoLoad
        />
      )}
    </div>
  )
}
