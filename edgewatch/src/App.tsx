import { useState } from 'react'
import type { PolyEvent } from './types'
import MarketSearch from './components/MarketSearch'
import MarketDetail from './components/MarketDetail'
import WalletProfile from './components/WalletProfile'
import './App.css'

type View =
  | { page: 'search' }
  | { page: 'detail'; event: PolyEvent }
  | { page: 'wallet'; address: string; from?: View }

export default function App() {
  const [view, setView] = useState<View>({ page: 'search' })

  if (view.page === 'wallet') {
    return (
      <WalletProfile
        address={view.address}
        onBack={() => setView(view.from ?? { page: 'search' })}
      />
    )
  }

  if (view.page === 'detail') {
    return (
      <MarketDetail
        event={view.event}
        onBack={() => setView({ page: 'search' })}
        onSelectWallet={address =>
          setView({ page: 'wallet', address, from: view })
        }
      />
    )
  }

  return (
    <MarketSearch
      onSelectEvent={event => setView({ page: 'detail', event })}
    />
  )
}
