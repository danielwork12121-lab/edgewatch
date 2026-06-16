import { useState, useEffect } from 'react'
import {
  loadWatchlist,
  unwatchWallet,
  unwatchMarket,
  type WatchedWallet,
  type WatchedMarket,
} from '../api/watchlist'
import { formatUSD, formatDate } from '../api/polymarket'
import { truncateAddress } from '../api/wallets'

interface Props {
  onBack: () => void
  onSelectWallet: (address: string) => void
  onSelectMarket: (eventId: string) => void
}

function WalletRow({
  wallet,
  onView,
  onRemove,
}: {
  wallet: WatchedWallet
  onView: () => void
  onRemove: () => void
}) {
  const display = wallet.pseudonym || wallet.name || truncateAddress(wallet.address)
  const addedDate = new Date(wallet.addedAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
  return (
    <div className="watch-row">
      <div className="watch-row-main">
        <button className="watch-row-name" onClick={onView}>{display}</button>
        <span className="stat date">Watching since {addedDate}</span>
      </div>
      <div className="trade-row-meta">
        <span className="wallet-address">{truncateAddress(wallet.address)}</span>
        <button className="unwatch-btn" onClick={onRemove}>Remove</button>
      </div>
    </div>
  )
}

function MarketRow({
  market,
  onView,
  onRemove,
}: {
  market: WatchedMarket
  onView: () => void
  onRemove: () => void
}) {
  const addedDate = new Date(market.addedAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
  return (
    <div className="watch-row">
      <div className="watch-row-main">
        <button className="watch-row-name" onClick={onView}>{market.title}</button>
        <div className="trade-row-meta" style={{ marginTop: 4 }}>
          <span className="stat vol">Vol {formatUSD(market.lastVol)}</span>
          <span className="stat liq">Liq {formatUSD(market.lastLiq)}</span>
          <span className="stat date">Closes {formatDate(market.endDate)}</span>
          <span className="stat date">Added {addedDate}</span>
        </div>
      </div>
      <div className="watch-row-actions">
        <button className="unwatch-btn" onClick={onRemove}>Remove</button>
      </div>
    </div>
  )
}

type WatchTab = 'wallets' | 'markets'

export default function WatchlistPage({ onBack, onSelectWallet, onSelectMarket }: Props) {
  const [tab, setTab] = useState<WatchTab>('wallets')
  const [wl, setWl] = useState(loadWatchlist)

  useEffect(() => {
    setWl(loadWatchlist())
  }, [])

  const removeWallet = (addr: string) => setWl(unwatchWallet(addr))
  const removeMarket = (id: string) => setWl(unwatchMarket(id))

  return (
    <div className="detail-page">
      <button className="back-btn" onClick={onBack}>← Back</button>
      <h2 className="detail-title">Watchlist</h2>

      <div className="tab-bar">
        <button
          className={`tab-btn ${tab === 'wallets' ? 'active' : ''}`}
          onClick={() => setTab('wallets')}
        >
          Wallets ({wl.wallets.length})
        </button>
        <button
          className={`tab-btn ${tab === 'markets' ? 'active' : ''}`}
          onClick={() => setTab('markets')}
        >
          Markets ({wl.markets.length})
        </button>
      </div>

      {tab === 'wallets' && (
        <>
          {wl.wallets.length === 0 && (
            <p className="empty-msg">
              No wallets watched yet. Open a wallet profile and click "Watch wallet".
            </p>
          )}
          {wl.wallets.map(w => (
            <WalletRow
              key={w.address}
              wallet={w}
              onView={() => onSelectWallet(w.address)}
              onRemove={() => removeWallet(w.address)}
            />
          ))}
        </>
      )}

      {tab === 'markets' && (
        <>
          {wl.markets.length === 0 && (
            <p className="empty-msg">
              No markets watched yet. Open a market and click "Watch market".
            </p>
          )}
          {wl.markets.map(m => (
            <MarketRow
              key={m.eventId}
              market={m}
              onView={() => onSelectMarket(m.eventId)}
              onRemove={() => removeMarket(m.eventId)}
            />
          ))}
        </>
      )}
    </div>
  )
}
