import type { WalletTrade, WalletPosition } from '../types'

export interface EdgeScore {
  overall: number          // 0-100
  clvScore: number         // 0-100: size-weighted CLV vs market
  repeatabilityScore: number // 0-100: consistency across markets
  sampleConfidence: 'very_low' | 'low' | 'medium' | 'high'
  sampleSize: number
  marketsTraded: number
  totalVolumeUSDC: number
  estimatedEdge: number    // % edge approximation
  breakdown: ScoreBreakdown
}

export interface ScoreBreakdown {
  winningPositions: number
  losingPositions: number
  unrealizedPnl: number
  realizedPnl: number
  avgEntryVsCurrentDelta: number // how much price moved in wallet's favor after entry
  largeTradeAccuracy: number | null // accuracy on trades > $50
}

export function scoreWallet(
  trades: WalletTrade[],
  positions: WalletPosition[],
): EdgeScore {
  const sampleSize = trades.length
  const sampleConfidence = getSampleConfidence(sampleSize)

  const uniqueMarkets = new Set(trades.map(t => t.conditionId)).size
  const totalVol = trades.reduce((s, t) => s + (t.usdcSize ?? 0), 0)

  // CLV approximation: for open positions, measure (curPrice - avgPrice) * size
  // Positive = moved in wallet's favor after entry
  let weightedCLV = 0
  let totalWeight = 0
  let winningPos = 0
  let losingPos = 0
  let unrealizedPnl = 0
  let realizedPnl = 0

  for (const pos of positions) {
    const initialVal = pos.initialValue ?? (pos.avgPrice * pos.size)
    if (!initialVal || initialVal <= 0) continue

    const clv = (pos.curPrice ?? 0) - (pos.avgPrice ?? 0)
    const weight = initialVal
    weightedCLV += clv * weight
    totalWeight += weight

    if ((pos.cashPnl ?? 0) >= 0) winningPos++
    else losingPos++

    unrealizedPnl += pos.currentValue ?? 0
    realizedPnl += pos.realizedPnl ?? 0
  }

  const avgCLV = totalWeight > 0 ? weightedCLV / totalWeight : 0

  // CLV score: map avgCLV from [-0.3, +0.3] to [0, 100]
  // +0.3 = excellent edge, -0.3 = consistently wrong
  const clvScore = Math.min(100, Math.max(0, (avgCLV + 0.3) / 0.6 * 100))

  // Repeatability: reward wallets that trade many unique markets consistently
  const repeatabilityScore = computeRepeatabilityScore(uniqueMarkets, sampleSize)

  // Large trade accuracy: accuracy on trades ≥ $50
  const largeTrades = trades.filter(t => (t.usdcSize ?? 0) >= 50)
  const largeTradeAccuracy = largeTrades.length >= 3
    ? null // can't determine without resolution data from simple API
    : null

  // Estimated edge: CLV mapped to percentage
  const estimatedEdge = avgCLV * 100

  // Liquidity adjustment: if trading very small markets, lower confidence
  // (applied to overall but not individual scores)
  const liquidityMultiplier = 1.0 // can extend when liquidity data is joined

  const raw = clvScore * 0.6 + repeatabilityScore * 0.4
  const overall = Math.min(100, Math.max(0, raw * liquidityMultiplier))

  return {
    overall: Math.round(overall),
    clvScore: Math.round(clvScore),
    repeatabilityScore: Math.round(repeatabilityScore),
    sampleConfidence,
    sampleSize,
    marketsTraded: uniqueMarkets,
    totalVolumeUSDC: totalVol,
    estimatedEdge,
    breakdown: {
      winningPositions: winningPos,
      losingPositions: losingPos,
      unrealizedPnl,
      realizedPnl,
      avgEntryVsCurrentDelta: avgCLV,
      largeTradeAccuracy,
    },
  }
}

function getSampleConfidence(n: number): EdgeScore['sampleConfidence'] {
  if (n < 5) return 'very_low'
  if (n < 20) return 'low'
  if (n < 50) return 'medium'
  return 'high'
}

function computeRepeatabilityScore(uniqueMarkets: number, totalTrades: number): number {
  if (totalTrades < 3) return 0
  // Reward breadth (many markets) and depth (multiple trades per market)
  const breadthScore = Math.min(100, (uniqueMarkets / 10) * 100)
  const depthRatio = totalTrades / Math.max(uniqueMarkets, 1)
  // Ideal: 2-5 trades per market — not a one-trade wonder, not spamming
  const depthScore = depthRatio >= 2 && depthRatio <= 10
    ? 80
    : depthRatio < 2
      ? depthRatio * 40   // penalize single-trade-per-market behavior
      : Math.max(0, 80 - (depthRatio - 10) * 5)
  return (breadthScore * 0.5 + depthScore * 0.5)
}

export function detectEarlyEntry(
  trade: WalletTrade,
  marketCurrentPrice: number,
): { isEarly: boolean; priceDelta: number; direction: 'favorable' | 'unfavorable' | 'neutral' } {
  const entryPrice = trade.price ?? 0
  const delta = marketCurrentPrice - entryPrice
  const threshold = 0.05 // 5 cent move = significant
  const isBuy = trade.side === 'BUY'

  const favorable = isBuy ? delta > threshold : delta < -threshold
  const unfavorable = isBuy ? delta < -threshold : delta > threshold

  return {
    isEarly: Math.abs(delta) > threshold,
    priceDelta: delta,
    direction: favorable ? 'favorable' : unfavorable ? 'unfavorable' : 'neutral',
  }
}

const CONFIDENCE_LABEL: Record<EdgeScore['sampleConfidence'], string> = {
  very_low: 'Very Low (< 5 trades)',
  low: 'Low (5-20 trades)',
  medium: 'Medium (20-50 trades)',
  high: 'High (50+ trades)',
}

export function confidenceLabel(c: EdgeScore['sampleConfidence']): string {
  return CONFIDENCE_LABEL[c]
}
