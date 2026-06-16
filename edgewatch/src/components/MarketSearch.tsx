import { useState, useCallback } from 'react'
import type { PolyEvent } from '../types'
import { searchEvents, parseOutcomePrices, formatUSD, formatDate } from '../api/polymarket'

interface Props {
  onSelectEvent: (event: PolyEvent) => void
}

const SUGGESTIONS = ['AI', 'crypto', 'election', 'sports', 'anime', 'tech', 'climate']

export default function MarketSearch({ onSelectEvent }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PolyEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const data = await searchEvents(q.trim())
      setResults(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    search(query)
  }

  const handleSuggestion = (s: string) => {
    setQuery(s)
    search(s)
  }

  return (
    <div className="search-page">
      <header className="app-header">
        <h1 className="logo">EdgeWatch</h1>
        <p className="tagline">Discover Polymarket signals</p>
      </header>

      <form className="search-form" onSubmit={handleSubmit}>
        <input
          className="search-input"
          type="text"
          placeholder="Search markets… e.g. AI, crypto, election"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
        <button className="search-btn" type="submit" disabled={loading}>
          {loading ? '…' : 'Search'}
        </button>
      </form>

      {!searched && (
        <div className="suggestions">
          <span className="suggestions-label">Try:</span>
          {SUGGESTIONS.map(s => (
            <button key={s} className="chip" onClick={() => handleSuggestion(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}

      {searched && !loading && results.length === 0 && !error && (
        <p className="empty-msg">No active markets found for "{query}"</p>
      )}

      {results.length > 0 && (
        <div className="results-grid">
          {results.map(event => {
            const bestMarket = event.markets?.[0]
            const prices = bestMarket ? parseOutcomePrices(bestMarket.outcomePrices) : []
            const yesPrice = prices[0] ?? null
            return (
              <button
                key={event.id}
                className="market-card"
                onClick={() => onSelectEvent(event)}
              >
                {event.image && (
                  <img className="market-img" src={event.image} alt="" loading="lazy" />
                )}
                <div className="market-card-body">
                  <p className="market-title">{event.title}</p>
                  <div className="market-stats">
                    {yesPrice !== null && (
                      <span className="stat prob" title="Yes probability">
                        {(yesPrice * 100).toFixed(0)}%
                      </span>
                    )}
                    <span className="stat vol" title="Volume">
                      Vol {formatUSD(event.volume ?? 0)}
                    </span>
                    <span className="stat liq" title="Liquidity">
                      Liq {formatUSD(event.liquidity ?? 0)}
                    </span>
                    <span className="stat date" title="Close date">
                      {formatDate(event.endDate)}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
