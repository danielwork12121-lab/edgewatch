import { useState, useEffect, useCallback, useRef } from 'react'
import type { PolyEvent, PolyMarket, TraderRankEntry } from '../types'
import { parseOutcomePrices, parseOutcomes, formatUSD, formatDate, timeRemaining, volatilityInfo } from '../api/polymarket'
import { watchMarket, unwatchMarket, isWatchingMarket } from '../api/watchlist'
import { rankTradersForMarket, enrichWithPnL, type BestTrade } from '../api/traders'
import { truncateAddress } from '../api/wallets'
import { cacheGet, cacheSet, cacheTime, cacheInvalidate, TTL, formatAge } from '../api/cache'

interface Props {
  event: PolyEvent
  onBack: () => void
  onSelectWallet: (address: string) => void
}

// ── Market Overview ──────────────────────────────────────────────────────────

function OutcomeBar({ label, price }: { label: string; price: number }) {
  const pct = (price * 100).toFixed(1)
  return (
    <div className="outcome-row">
      <div className="outcome-header">
        <span className="outcome-label">{label}</span>
        <span className="outcome-pct">{pct}%</span>
      </div>
      <div className="outcome-bar-track">
        <div className="outcome-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function MarketOverview({ event }: { event: PolyEvent }) {
  const totalVol = (event.markets ?? []).reduce((s, m) => s + (m.volume ?? 0), 0) || event.volume || 0
  const totalLiq = (event.markets ?? []).reduce((s, m) => s + (m.liquidity ?? 0), 0) || event.liquidity || 0
  const firstMkt = event.markets?.[0]
  const vol = volatilityInfo(firstMkt?.oneDayPriceChange)
  const remain = timeRemaining(event.endDate)

  return (
    <div className="market-overview">
      <div className="market-overview-stats">
        <div className="overview-stat">
          <span className="overview-stat-val">{formatUSD(totalVol)}</span>
          <span className="overview-stat-label">Total Volume</span>
        </div>
        <div className="overview-stat">
          <span className="overview-stat-val">{formatUSD(totalLiq)}</span>
          <span className="overview-stat-label">Liquidity</span>
        </div>
        <div className="overview-stat">
          <span className={`overview-stat-val vol-${vol.level}`}>{vol.label}</span>
          <span className="overview-stat-label">Volatility</span>
        </div>
        <div className="overview-stat">
          <span className="overview-stat-val">{remain}</span>
          <span className="overview-stat-label">Time Remaining</span>
        </div>
        {firstMkt?.lastTradePrice !== undefined && (
          <div className="overview-stat">
            <span className="overview-stat-val">{((firstMkt.lastTradePrice ?? 0) * 100).toFixed(1)}¢</span>
            <span className="overview-stat-label">Last Price</span>
          </div>
        )}
      </div>

      <div className="markets-list">
        {(event.markets ?? []).map(m => <MarketSubRow key={m.id} market={m} />)}
        {(!event.markets || event.markets.length === 0) && (
          <p className="empty-msg">No sub-markets.</p>
        )}
      </div>
    </div>
  )
}

function MarketSubRow({ market }: { market: PolyMarket }) {
  const prices = parseOutcomePrices(market.outcomePrices)
  const outcomes = parseOutcomes(market.outcomes)
  return (
    <div className="market-row">
      <p className="market-row-question">{market.question}</p>
      <div className="market-row-outcomes">
        {outcomes.map((label, i) => prices[i] !== undefined && (
          <OutcomeBar key={label} label={label} price={prices[i]} />
        ))}
      </div>
      <div className="market-row-meta">
        <span className="stat vol">Vol {formatUSD(market.volume ?? 0)}</span>
        <span className="stat liq">Liq {formatUSD(market.liquidity ?? 0)}</span>
        <span className="stat date">Closes {formatDate(market.endDate)}</span>
        <a className="poly-link" href={`https://polymarket.com/market/${market.slug}`} target="_blank" rel="noopener noreferrer">
          Polymarket ↗
        </a>
      </div>
    </div>
  )
}

// ── Smart Traders ────────────────────────────────────────────────────────────

function SmartTraderCard({ entry, rank, onSelect }: {
  entry: TraderRankEntry
  rank: number
  onSelect: () => void
}) {
  const display = entry.pseudonym || entry.name || truncateAddress(entry.address)
  const edgeScore = entry.totalResolved >= 3 ? Math.round(entry.timingScore * 100) : null
  const timingPct = (entry.timingScore * 100).toFixed(0)

  let confLabel = 'Low'
  let confCls = 'badge-orange'
  if (entry.totalResolved >= 5 && entry.timingScore >= 0.6) { confLabel = 'High'; confCls = 'badge-green' }
  else if (entry.totalResolved >= 3 && entry.timingScore >= 0.45) { confLabel = 'Medium'; confCls = 'badge-yellow' }

  return (
    <div className="trader-card">
      <div className="trader-card-rank">#{rank}</div>
      <div className="trader-card-body">
        <div className="trader-card-top">
          <span className="trader-card-name">{display}</span>
          <div className="trader-card-badges">
            <span className={`confidence-badge ${confCls}`}>{confLabel} confidence</span>
            {edgeScore !== null && (
              <span className="confidence-badge badge-green" style={{ background: 'none', border: '1px solid var(--border)' }}>
                Edge {edgeScore}/100
              </span>
            )}
          </div>
        </div>
        <div className="trader-card-meta">
          <span className="stat vol">{formatUSD(entry.totalVolumeUSDC)} vol</span>
          <span className="stat date">{entry.tradeCount} trades</span>
          {entry.winRate !== null && (
            <span className={`stat ${entry.winRate >= 0.5 ? '' : 'pnl-neg'}`}>
              {(entry.winRate * 100).toFixed(0)}% win
            </span>
          )}
          {entry.pnl !== null && (
            <span className={`stat ${entry.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
              {entry.pnl >= 0 ? '+' : ''}{formatUSD(entry.pnl)} PnL
            </span>
          )}
        </div>
        {entry.totalResolved >= 3 && (
          <div className="timing-bar-wrap">
            <div className="timing-bar-track">
              <div className="timing-bar-fill" style={{
                width: `${timingPct}%`,
                background: Number(timingPct) >= 55 ? '#22c55e' : '#f59e0b',
              }} />
            </div>
            <span className="timing-bar-label">
              {entry.positiveDelta}/{entry.totalResolved} favorable entries
            </span>
          </div>
        )}
        <div className="trader-card-actions">
          <button className="search-btn" style={{ fontSize: '0.8rem', padding: '5px 14px' }} onClick={onSelect}>
            View Profile →
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Best Trades ──────────────────────────────────────────────────────────────

function BestTradeRow({ trade, onSelectWallet }: { trade: BestTrade; onSelectWallet: (a: string) => void }) {
  const display = trade.pseudonym || trade.name || truncateAddress(trade.address)
  const time = new Date(trade.timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const multiple = trade.profitMultiple.toFixed(2)
  const deltaSign = trade.delta >= 0 ? '+' : ''

  return (
    <div className="best-trade-row">
      <div className="best-trade-top">
        <span className={`side-badge ${trade.side === 'BUY' ? 'buy' : 'sell'}`}>{trade.side}</span>
        <span className="trade-title">{trade.outcome} — {trade.title}</span>
        <span className="best-trade-multiple pnl-pos">{multiple}x</span>
      </div>
      <div className="trade-row-meta">
        <span className="stat prob">Entry {(trade.entryPrice * 100).toFixed(0)}¢</span>
        <span className="stat prob">Now {(trade.currentPrice * 100).toFixed(0)}¢ <span className="estimate-label">(live)</span></span>
        <span className="stat vol pnl-pos">{deltaSign}{(trade.delta * 100).toFixed(1)}¢ delta</span>
        <span className="stat vol">{formatUSD(trade.sizeUSDC)}</span>
        <span className="stat date">{time}</span>
        <button className="follow-btn" onClick={() => onSelectWallet(trade.address)}>
          {display} →
        </button>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

type Tab = 'overview' | 'traders' | 'best-trades'

interface IntelCache {
  traders: TraderRankEntry[]
  bestTrades: BestTrade[]
}

export default function MarketDetail({ event, onBack, onSelectWallet }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [watching, setWatching] = useState(() => isWatchingMarket(event.id))
  const [traders, setTraders] = useState<TraderRankEntry[]>([])
  const [bestTrades, setBestTrades] = useState<BestTrade[]>([])
  const [intelLoading, setIntelLoading] = useState(false)
  const [intelError, setIntelError] = useState<string | null>(null)
  const [intelLoaded, setIntelLoaded] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const enrichedRef = useRef(false)  // enrichment runs once per market, not on refresh

  const cacheKey = `market:${event.id}`

  const loadIntelligence = useCallback((forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = cacheGet<IntelCache>(cacheKey, TTL.intelligence)
      if (cached !== null) {
        setTraders(cached.traders)
        setBestTrades(cached.bestTrades)
        setIntelLoaded(true)
        setLastUpdated(cacheTime(cacheKey))
        setIntelLoading(false)
        return
      }
    }

    setIntelLoading(true)
    setIntelError(null)
    rankTradersForMarket(event)
      .then(({ traders: ranked, bestTrades: best }) => {
        cacheSet<IntelCache>(cacheKey, { traders: ranked, bestTrades: best })
        setTraders(ranked)
        setBestTrades(best)
        setIntelLoaded(true)
        setLastUpdated(Date.now())
        // Enrich top 5 once per market session (not on every refresh)
        if (!enrichedRef.current && ranked.length > 0) {
          enrichedRef.current = true
          enrichWithPnL(ranked, 5).then(enriched => {
            setTraders(enriched)
            cacheSet<IntelCache>(cacheKey, { traders: enriched, bestTrades: best })
          })
        }
      })
      .catch(e => setIntelError(e instanceof Error ? e.message : 'Failed to load intelligence'))
      .finally(() => setIntelLoading(false))
  }, [cacheKey, event])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      enrichedRef.current = false
      void loadIntelligence()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadIntelligence])

  const handleRefresh = useCallback(() => {
    cacheInvalidate(cacheKey)
    loadIntelligence(true)
  }, [cacheKey, loadIntelligence])

  const handleToggleWatch = () => {
    if (watching) { unwatchMarket(event.id); setWatching(false) }
    else { watchMarket(event); setWatching(true) }
  }

  const totalVol = (event.markets ?? []).reduce((s, m) => s + (m.volume ?? 0), 0) || event.volume || 0
  const totalLiq = (event.markets ?? []).reduce((s, m) => s + (m.liquidity ?? 0), 0) || event.liquidity || 0

  return (
    <div className="detail-page">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="back-btn" onClick={onBack}>← Back</button>
        <button type="button" className={`back-btn ${watching ? 'watching-active' : ''}`} onClick={handleToggleWatch}>
          {watching ? '★ Watching' : '☆ Watch'}
        </button>
        <div className="refresh-bar" style={{ marginLeft: 'auto' }}>
          {lastUpdated && <span className="last-updated">{formatAge(lastUpdated)}</span>}
          <button
            type="button"
            className="refresh-btn"
            onClick={handleRefresh}
            disabled={intelLoading}
            title="Refresh market intelligence"
          >
            {intelLoading ? '↻' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <div className="detail-header">
        {event.image && <img className="detail-img" src={event.image} alt="" />}
        <div>
          <h2 className="detail-title">{event.title}</h2>
          <div className="detail-meta">
            <span className="stat vol">Vol {formatUSD(totalVol)}</span>
            <span className="stat liq">Liq {formatUSD(totalLiq)}</span>
            <span className="stat date">{timeRemaining(event.endDate)} left</span>
            <a className="poly-link" href={`https://polymarket.com/event/${event.slug}`} target="_blank" rel="noopener noreferrer">
              Polymarket ↗
            </a>
          </div>
        </div>
      </div>

      <div className="data-source-label">
        Polymarket public API · real data · 5min cache
      </div>

      <div className="tab-bar">
        <button type="button" className={`tab-btn ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
          Market Overview
        </button>
        <button type="button" className={`tab-btn ${tab === 'traders' ? 'active' : ''}`} onClick={() => setTab('traders')}>
          Smart Traders {intelLoaded ? `(${traders.length})` : intelLoading ? '…' : ''}
        </button>
        <button type="button" className={`tab-btn ${tab === 'best-trades' ? 'active' : ''}`} onClick={() => setTab('best-trades')}>
          Best Trades {intelLoaded ? `(${bestTrades.length})` : intelLoading ? '…' : ''}
        </button>
      </div>

      {tab === 'overview' && <MarketOverview event={event} />}

      {tab === 'traders' && (
        <div className="trader-ranking-panel">
          {intelError && <p className="error-msg">{intelError}</p>}
          {intelLoading && <p className="empty-msg">Analyzing traders in this market…</p>}
          {intelLoaded && traders.length === 0 && (
            <p className="empty-msg">No traders with ≥2 trades found in this market yet.</p>
          )}
          {traders.map((t, i) => (
            <SmartTraderCard
              key={t.address}
              entry={t}
              rank={i + 1}
              onSelect={() => onSelectWallet(t.address)}
            />
          ))}
        </div>
      )}

      {tab === 'best-trades' && (
        <div>
          {intelError && <p className="error-msg">{intelError}</p>}
          {intelLoading && <p className="empty-msg">Finding best entries in this market…</p>}
          {intelLoaded && bestTrades.length === 0 && (
            <p className="empty-msg">No favorable entries found yet (price may not have moved since trades).</p>
          )}
          {intelLoaded && bestTrades.length > 0 && (
            <div className="data-source-label" style={{ marginBottom: 12 }}>
              Entries where price has since moved in the trader's direction · current price = live CLOB last-trade
            </div>
          )}
          {bestTrades.map((t, i) => (
            <BestTradeRow key={i} trade={t} onSelectWallet={onSelectWallet} />
          ))}
        </div>
      )}
    </div>
  )
}
