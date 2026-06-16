export interface PolyMarket {
  id: string
  question: string
  slug: string
  startDate: string
  endDate: string | null
  outcomePrices: string // JSON: ["0.85","0.15"]
  outcomes: string      // JSON: ["Yes","No"]
  volume: number
  liquidity: number
  active: boolean
  closed: boolean
}

export interface PolyEvent {
  id: string
  slug: string
  title: string
  startDate: string
  endDate: string | null
  image: string | null
  active: boolean
  closed: boolean
  volume: number
  liquidity: number
  markets: PolyMarket[]
}
