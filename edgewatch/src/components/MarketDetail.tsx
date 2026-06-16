import type { PolyEvent, PolyMarket } from '../types'
import { parseOutcomePrices, parseOutcomes, formatUSD, formatDate } from '../api/polymarket'

interface Props {
  event: PolyEvent
  onBack: () => void
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

export default function MarketDetail({ event, onBack }: Props) {
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

      <div className="markets-list">
        <h3 className="markets-list-title">
          {event.markets?.length ?? 0} market{(event.markets?.length ?? 0) !== 1 ? 's' : ''}
        </h3>
        {event.markets?.map(m => (
          <MarketRow key={m.id} market={m} />
        ))}
        {(!event.markets || event.markets.length === 0) && (
          <p className="empty-msg">No sub-markets available.</p>
        )}
      </div>
    </div>
  )
}
