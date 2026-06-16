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
  clobTokenIds?: string // JSON: ["tokenId1","tokenId2"]
  conditionId?: string
  lastTradePrice?: number
  oneDayPriceChange?: number
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

export interface WalletTrade {
  proxyWallet: string
  timestamp: number
  conditionId: string
  type: string
  size: number
  usdcSize: number
  price: number
  asset: string
  side: 'BUY' | 'SELL'
  outcomeIndex: number
  title: string
  slug: string
  icon: string
  eventSlug: string
  outcome: string
  name: string
  pseudonym: string
  transactionHash?: string
}

export interface WalletPosition {
  proxyWallet: string
  asset: string
  conditionId: string
  size: number
  avgPrice: number
  currentValue: number
  cashPnl: number
  percentPnl: number
  realizedPnl: number
  title: string
  slug: string
  outcome: string
  endDate: string
  redeemable: boolean
}

export interface WalletStats {
  address: string
  pseudonym: string
  name: string
  totalTrades: number
  totalVolumeUSDC: number
  marketsTraded: number
  avgTradeSize: number
  winRate: number | null
}

