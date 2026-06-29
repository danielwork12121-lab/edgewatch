import { useState } from 'react'
import type { PolyEvent } from './types'
import MarketSearch from './components/MarketSearch'
import MarketDetail from './components/MarketDetail'
import WalletProfile from './components/WalletProfile'
import PaperPortfolioPage from './components/PaperPortfolio'
import WatchlistPage from './components/WatchlistPage'
import './App.css'

type View =
  | { page: 'search' }
  | { page: 'detail'; event: PolyEvent }
  | { page: 'wallet'; address: string; from?: View }
  | { page: 'portfolio'; from?: View }
  | { page: 'watchlist'; from?: View }

export default function App() {
  const [view, setView] = useState<View>({ page: 'search' })

  const goSearch = () => setView({ page: 'search' })

  if (view.page === 'watchlist') {
    return (
      <WatchlistPage
        key="watchlist"
        onBack={() => setView(view.from ?? { page: 'search' })}
        onSelectWallet={address => setView({ page: 'wallet', address, from: view })}
        onSelectMarket={() => goSearch()}
      />
    )
  }

  if (view.page === 'portfolio') {
    return (
      <PaperPortfolioPage
        key="portfolio"
        onBack={() => setView(view.from ?? { page: 'search' })}
      />
    )
  }

  if (view.page === 'wallet') {
    return (
      <WalletProfile
        key={view.address}
        address={view.address}
        onBack={() => setView(view.from ?? { page: 'search' })}
        onViewPortfolio={() => setView({ page: 'portfolio', from: view })}
      />
    )
  }

  if (view.page === 'detail') {
    return (
      <MarketDetail
        key={view.event.id}
        event={view.event}
        onBack={goSearch}
        onSelectWallet={address =>
          setView({ page: 'wallet', address, from: view })
        }
      />
    )
  }

  return (
    <MarketSearch
      key="search"
      onSelectEvent={event => setView({ page: 'detail', event })}
      onSelectWallet={address => setView({ page: 'wallet', address, from: view })}
      onViewWatchlist={() => setView({ page: 'watchlist', from: view })}
      onViewPortfolio={() => setView({ page: 'portfolio', from: view })}
    />
  )
}
