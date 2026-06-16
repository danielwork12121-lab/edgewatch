import { useState } from 'react'
import type { PolyEvent } from './types'
import MarketSearch from './components/MarketSearch'
import MarketDetail from './components/MarketDetail'
import './App.css'

type View = { page: 'search' } | { page: 'detail'; event: PolyEvent }

export default function App() {
  const [view, setView] = useState<View>({ page: 'search' })

  if (view.page === 'detail') {
    return (
      <MarketDetail
        event={view.event}
        onBack={() => setView({ page: 'search' })}
      />
    )
  }

  return (
    <MarketSearch
      onSelectEvent={event => setView({ page: 'detail', event })}
    />
  )
}
