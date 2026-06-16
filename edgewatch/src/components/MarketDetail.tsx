import { useState } from 'react'
import type { PolyEvent, PolyMarket, WalletTrade } from '../types'
import { parseOutcomePrices, parseOutcomes, formatUSD, formatDate } from '../api/polymarket'
import { getMarketTrades, filterNoise, truncateAddress } from '../api/wallets'

interface Props {
  event: PolyEvent
  onBack: () => void
  onSelectWallet: (address: string) => void
}

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

function MarketRow({ market }: { market: PolyMarket }) {
  const prices = parseOutcomePrices(market.outcomePrices)
  const outcomes = parseOutcomes(market.outcomes)

  return (
    <div className="market-row">
      <p className="market-row-question">{market.question}</p>
      <div className="market-row-outcomes">
        {outcomes.map((label, i) => (
          prices[i] !== undefined && (
            <OutcomeBar key={label} label={label} price={prices[i]} />
          )
        ))}
      </div>
      <div className="market-row-meta">
        <span className="stat vol">Vol {formatUSD(market.volume ?? 0)}</span>
        <span className="stat liq">Liq {formatUSD(market.liquidity ?? 0)}</span>
        <span className="stat date">Closes {formatDate(market.endDate)}</span>
        <a
          className="poly-link"
          href={`https://polymarket.com/market/${market.slug}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on Polymarket ↗
        </a>
      </div>
    </div>
  )
}

interface TraderRow {
  address: string
  pseudonym: string
  name: string
  tradeCount: number
  volumeUSDC: number
  lastSide: 'BUY' | 'SELL'
  lastOutcome: string
  lastPrice: number
}

function buildTraderRows(trades: WalletTrade[]): TraderRow[] {
  const map = new Map<string, TraderRow>()
  for (const t of trades) {
    const addr = t.proxyWallet
    if (!map.has(addr)) {
      map.set(addr, {
        address: addr,
        pseudonym: t.pseudonym || '',
        name: t.name || '',
        tradeCount: 0,
        volumeUSDC: 0,
        lastSide: t.side,
        lastOutcome: t.outcome,
        lastPrice: t.price,
      })
    }
    const row = map.get(addr)!
    row.tradeCount++
    row.volumeUSDC += t.usdcSize ?? 0
    if (t.timestamp >= (trades.find(x => x.proxyWallet === addr)?.timestamp ?? 0)) {
      row.lastSide = t.side
      row.lastOutcome = t.outcome
      row.lastPrice = t.price
    }
  }
  return Array.from(map.values()).sort((a, b) => b.volumeUSDC - a.volumeUSDC)
}

function TradersPanel({ event, onSelectWallet }: { event: PolyEvent; onSelectWallet: (a: string) => void }) {
  const [trades, setTrades] = useState<WalletTrade[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const firstMarket = event.markets?.[0]
      if (!firstMarket) throw new Error('No markets found')
      let tokenIds: string[] = []
      if (firstMarket.clobTokenIds) {
        try { tokenIds = JSON.parse(firstMarket.clobTokenIds) } catch { /* ignore */ }
      }
      if (tokenIds.length === 0 && firstMarket.id) {
        tokenIds = [String(firstMarket.id)]
      }
      const all = await Promise.all(tokenIds.map(id => getMarketTrades(id, 200)))
      const merged = all.flat()
      setTrades(filterNoise(merged, 1))
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load traders')
    } finally {
      setLoading(false)
    }
  }

  const rows = buildTraderRows(trades)

  if (!loaded) {
    return (
      <div>
        <button className="search-btn" onClick={load} disabled={loading}>
          {loading ? 'Loading traders…' : 'Load recent traders'}
        </button>
        {error && <p className="error-msg" style={{ marginTop: 12 }}>{error}</p>}
      </div>
    )
  }

  return (
    <div>
      <div className="data-source-label" style={{ marginBottom: 12 }}>
        Showing {rows.length} unique wallets from last 200 trades · Real data
      </div>
      {rows.length === 0 && <p className="empty-msg">No traders found.</p>}
      {rows.map(r => (
        <button
          key={r.address}
          className="trader-row"
          onClick={() => onSelectWallet(r.address)}
        >
          <div className="trader-row-top">
            <span className="trader-name">{r.pseudonym || r.name || truncateAddress(r.address)}</span>
            <span className="stat vol">{formatUSD(r.volumeUSDC)}</span>
          </div>
          <div className="trade-row-meta">
            <span className="stat date">{r.tradeCount} trade{r.tradeCount !== 1 ? 's' : ''}</span>
            <span className={`side-badge ${r.lastSide === 'BUY' ? 'buy' : 'sell'}`}>{r.lastSide}</span>
            <span className="trade-outcome">{r.lastOutcome}</span>
            <span className="stat prob">@ {((r.lastPrice ?? 0) * 100).toFixed(0)}¢</span>
          </div>
        </button>
      ))}
    </div>
  )
}

type Tab = 'markets' | 'traders'

export default function MarketDetail({ event, onBack, onSelectWallet }: Props) {
  const [tab, setTab] = useState<Tab>('markets')
  const totalVol = event.markets?.reduce((s, m) => s + (m.volume ?? 0), 0) ?? event.volume ?? 0
  const totalLiq = event.markets?.reduce((s, m) => s + (m.liquidity ?? 0), 0) ?? event.liquidity ?? 0

  return (
    <div className="detail-page">
      <button className="back-btn" onClick={onBack}>← Back</button>

      <div className="detail-header">
        {event.image && (
          <img className="detail-img" src={event.image} alt="" />
        )}
        <div>
          <h2 className="detail-title">{event.title}</h2>
          <div className="detail-meta">
            <span className="stat vol">Total vol {formatUSD(totalVol)}</span>
            <span className="stat liq">Total liq {formatUSD(totalLiq)}</span>
            <span className="stat date">Closes {formatDate(event.endDate)}</span>
            <a
              className="poly-link"
              href={`https://polymarket.com/event/${event.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open on Polymarket ↗
            </a>
          </div>
        </div>
      </div>

      <div className="data-source-label">
        Data source: <strong>Polymarket public API</strong> · Real market data
      </div>

      <div className="tab-bar">
        <button className={`tab-btn ${tab === 'markets' ? 'active' : ''}`} onClick={() => setTab('markets')}>
          Markets ({event.markets?.length ?? 0})
        </button>
        <button className={`tab-btn ${tab === 'traders' ? 'active' : ''}`} onClick={() => setTab('traders')}>
          Traders
        </button>
      </div>

      {tab === 'markets' && (
        <div className="markets-list">
          {event.markets?.map(m => (
            <MarketRow key={m.id} market={m} />
          ))}
          {(!event.markets || event.markets.length === 0) && (
            <p className="empty-msg">No sub-markets available.</p>
          )}
        </div>
      )}

      {tab === 'traders' && (
        <TradersPanel event={event} onSelectWallet={onSelectWallet} />
      )}
    </div>
  )
}
