import type { WalletTrade } from '../types'

export interface SimulatedTrade {
  originalTrade: WalletTrade
  simulatedSizeUSDC: number   // user's paper allocation
  simulatedShares: number
  entryPrice: number
  currentPrice: number        // last known price
  estimatedValue: number      // simulatedShares * currentPrice
  unrealizedPnlUSDC: number
  unrealizedPnlPct: number
  status: 'open' | 'closed' | 'expired'
  simulatedAt: number         // timestamp when user "followed"
}

export interface PaperPortfolio {
  id: string
  label: string
  createdAt: number
  startingBalance: number
  trades: SimulatedTrade[]
}

const STORAGE_KEY = 'edgewatch_paper_portfolio'

export function loadPortfolio(): PaperPortfolio | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function savePortfolio(p: PaperPortfolio): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
}

export function createPortfolio(startingBalance: number): PaperPortfolio {
  return {
    id: `paper_${Date.now()}`,
    label: 'My Paper Portfolio',
    createdAt: Date.now(),
    startingBalance,
    trades: [],
  }
}

export function addSimulatedTrade(
  portfolio: PaperPortfolio,
  trade: WalletTrade,
  sizeUSDC: number,
): PaperPortfolio {
  const entryPrice = trade.price ?? 0
  const shares = entryPrice > 0 ? sizeUSDC / entryPrice : 0
  const simTrade: SimulatedTrade = {
    originalTrade: trade,
    simulatedSizeUSDC: sizeUSDC,
    simulatedShares: shares,
    entryPrice,
    currentPrice: entryPrice, // will be updated when refreshed
    estimatedValue: sizeUSDC,
    unrealizedPnlUSDC: 0,
    unrealizedPnlPct: 0,
    status: 'open',
    simulatedAt: Date.now(),
  }
  const updated = { ...portfolio, trades: [simTrade, ...portfolio.trades] }
  savePortfolio(updated)
  return updated
}

export function updateTradePrice(trade: SimulatedTrade, newPrice: number): SimulatedTrade {
  const value = trade.simulatedShares * newPrice
  const pnl = value - trade.simulatedSizeUSDC
  const pct = trade.simulatedSizeUSDC > 0 ? (pnl / trade.simulatedSizeUSDC) * 100 : 0
  return {
    ...trade,
    currentPrice: newPrice,
    estimatedValue: value,
    unrealizedPnlUSDC: pnl,
    unrealizedPnlPct: pct,
    status: trade.status,
  }
}

export function computePortfolioSummary(portfolio: PaperPortfolio) {
  const open = portfolio.trades.filter(t => t.status === 'open')
  const totalInvested = open.reduce((s, t) => s + t.simulatedSizeUSDC, 0)
  const totalValue = open.reduce((s, t) => s + t.estimatedValue, 0)
  const totalPnl = totalValue - totalInvested
  const pnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

  return {
    openPositions: open.length,
    totalInvested,
    totalValue,
    totalPnl,
    pnlPct,
    remainingBalance: portfolio.startingBalance - totalInvested,
  }
}

export function clearPortfolio(): void {
  localStorage.removeItem(STORAGE_KEY)
}
