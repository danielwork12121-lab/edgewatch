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
          {m?.lastTradePrice !== undefined && m.lastTradePrice !== yesPrice && (
            <span className="stat prob" title="Last trade price">
              ↔ {((m.lastTradePrice ?? 0) * 100).toFixed(0)}¢
            </span>
          )}
          <span className="stat vol">Vol {formatUSD(event.volume24hr ?? event.volume ?? 0)}/24h</span>
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

  // Load events for selected category (or trending)
  const loadCategory = useCallback(async (cat: Category) => {
    setLoading(true)
    setError(null)
    setIsSearchMode(false)
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

  // Load trending on mount
  useEffect(() => {
    loadCategory(CATEGORIES[0])
  }, [loadCategory])

  const handleCategoryClick = (cat: Category) => {
    setActiveCategory(cat)
    setTab('markets')
    setQuery('')
    loadCategory(cat)
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setIsSearchMode(true)
    try {
      const data = await searchEvents(query.trim())
      setResults(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const categoryLabel = activeCategory.label

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
        <p className="tagline">Polymarket intelligence — discover markets, find edge, copy signals</p>
      </header>

      {/* Category selector */}
      <div className="category-bar">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            className={`category-pill ${activeCategory.id === cat.id ? 'active' : ''}`}
            onClick={() => handleCategoryClick(cat)}
          >
            <span className="category-emoji">{cat.emoji}</span> {cat.label}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <form className="search-form" onSubmit={handleSearch}>
        <input
          className="search-input"
          type="text"
          placeholder="Search markets… (overrides category)"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className="search-btn" type="submit" disabled={loading}>
          {loading ? '…' : 'Search'}
        </button>
        {isSearchMode && (
          <button
            type="button"
            className="back-btn"
            onClick={() => { setQuery(''); setIsSearchMode(false); loadCategory(activeCategory) }}
          >
            ✕
          </button>
        )}
      </form>

      {error && <p className="error-msg">{error}</p>}

      {/* Markets / Traders tabs (only shown when category is not trending search) */}
      {!isSearchMode && results.length > 0 && (
        <div className="tab-bar">
          <button
            className={`tab-btn ${tab === 'markets' ? 'active' : ''}`}
            onClick={() => setTab('markets')}
          >
            {isSearchMode ? 'Results' : `${activeCategory.emoji} ${categoryLabel} Markets`} ({results.length})
          </button>
          <button
            className={`tab-btn ${tab === 'traders' ? 'active' : ''}`}
            onClick={() => setTab('traders')}
          >
            Top {categoryLabel} Traders
          </button>
        </div>
      )}

      {/* Section heading */}
      {!isSearchMode && tab === 'markets' && (
        <div className="section-heading">
          <h2 className="section-title">
            {activeCategory.id === 'trending' ? '🔥 Trending Markets' : `${activeCategory.emoji} ${categoryLabel} Markets`}
          </h2>
          <span className="data-badge">Live · Polymarket Gamma API</span>
        </div>
      )}

      {/* Market grid */}
      {(!isSearchMode ? tab === 'markets' : true) && (
        <>
          {loading && results.length === 0 && <p className="empty-msg">Loading markets…</p>}
          {!loading && results.length === 0 && !error && (
            <p className="empty-msg">No active markets found.</p>
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

      {/* Trader ranking tab */}
      {!isSearchMode && tab === 'traders' && results.length > 0 && (
        <TraderRanking
          events={results}
          categoryLabel={categoryLabel}
          onSelectWallet={onSelectWallet}
        />
      )}
    </div>
  )
}
