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
    <button className="market-card" onClick={onClick}>
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

export default function MarketSearch({ onSelectEvent, onSelectWallet, onViewWatchlist, onViewPortfolio }: Props) {
  const [activeCategory, setActiveCategory] = useState<Category>(CATEGORIES[0])
  const [tab, setTab] = useState<DiscoveryTab>('markets')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PolyEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSearchMode, setIsSearchMode] = useState(false)
  const [activeQuery, setActiveQuery] = useState('')  // query that produced current results

  const loadCategory = useCallback(async (cat: Category) => {
    setLoading(true)
    setError(null)
    setIsSearchMode(false)
    setActiveQuery('')
    try {
      const data = cat.tag ? await searchByTag(cat.tag, 24) : await fetchTrending(16)
      setResults(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load markets')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCategory(CATEGORIES[0])
  }, [loadCategory])

  const handleCategoryClick = (cat: Category) => {
    setActiveCategory(cat)
    setTab('markets')
    setQuery('')
    setIsSearchMode(false)
    setActiveQuery('')
    loadCategory(cat)
  }

  // ── SEARCH: always overrides category. Query is passed directly to API. ──
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setTab('markets')           // reset tab so grid is visible
    setIsSearchMode(true)
    setActiveQuery(q)
    setLoading(true)
    setError(null)
    try {
      const data = await searchEvents(q)  // q passed directly — no category filter applied
      setResults(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const clearSearch = () => {
    setQuery('')
    setIsSearchMode(false)
    setActiveQuery('')
    loadCategory(activeCategory)
  }

  return (
    <div className="search-page">
      <header className="app-header">
        <div className="app-header-top">
          <h1 className="logo">EdgeWatch</h1>
          <div className="nav-links">
            <button className="nav-link" onClick={onViewWatchlist}>★ Watchlist</button>
            <button className="nav-link" onClick={onViewPortfolio}>Paper Portfolio</button>
          </div>
        </div>
        <p className="tagline">Identify and copy high-signal Polymarket traders</p>
      </header>

      {/* Category selector — disabled in search mode */}
      <div className="category-bar">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            className={`category-pill ${!isSearchMode && activeCategory.id === cat.id ? 'active' : ''}`}
            onClick={() => handleCategoryClick(cat)}
          >
            <span className="category-emoji">{cat.emoji}</span> {cat.label}
          </button>
        ))}
      </div>

      {/* Search — highest priority, always overrides category */}
      <form className="search-form" onSubmit={handleSearch}>
        <input
          className="search-input"
          type="text"
          placeholder="Search any topic: anime, AI, elections, BTC…"
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

      {/* Heading — shows what is currently displayed */}
      {!loading && (
        <div className="section-heading">
          {isSearchMode ? (
            <>
              <h2 className="section-title">Results for "{activeQuery}"</h2>
              <span className="data-badge">{results.length} markets</span>
            </>
          ) : (
            <>
              <h2 className="section-title">
                {activeCategory.id === 'trending'
                  ? '🔥 Trending Markets'
                  : `${activeCategory.emoji} ${activeCategory.label} Markets`}
              </h2>
              <span className="data-badge">{results.length} markets · Live</span>
            </>
          )}
        </div>
      )}

      {/* Tabs — shown in both category and search mode */}
      {results.length > 0 && (
        <div className="tab-bar">
          <button
            className={`tab-btn ${tab === 'markets' ? 'active' : ''}`}
            onClick={() => setTab('markets')}
          >
            Markets ({results.length})
          </button>
          <button
            className={`tab-btn ${tab === 'traders' ? 'active' : ''}`}
            onClick={() => setTab('traders')}
          >
            {isSearchMode ? `Top Traders for "${activeQuery}"` : `Top ${activeCategory.label} Traders`}
          </button>
        </div>
      )}

      {/* Market grid */}
      {tab === 'markets' && (
        <>
          {loading && <p className="empty-msg">Loading…</p>}
          {!loading && results.length === 0 && !error && (
            <p className="empty-msg">
              {isSearchMode ? `No active markets found for "${activeQuery}".` : 'No markets found.'}
            </p>
          )}
          {results.length > 0 && (
            <div className="results-grid">
              {results.map(event => (
                <MarketCard key={event.id} event={event} onClick={() => onSelectEvent(event)} />
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
