import type { WalletTrade } from '../types'
import { batchFetchPrices } from './priceTracker'

export interface EdgeScore {
  overall: number
  entryEdgeScore: number        // 0-100: size-weighted entry-to-now delta
  repeatabilityScore: number    // 0-100: breadth × depth across markets
  sampleConfidence: 'very_low' | 'low' | 'medium' | 'high'
  sampleSize: number
  pricesResolved: number        // how many trades had a live current price
  marketsTraded: number
  totalVolumeUSDC: number
  avgDeltaCents: number         // avg (currentPrice - entryPrice) × 100 in wallet's favor
  breakdown: {
    positiveDeltaTrades: number // trades where price moved in wallet's direction
    negativeDeltaTrades: number
    unresolvedTrades: number    // trades with no live price available
  }
}

// Compute entry-based edge score.
// Formula:
//   For each trade:
//     delta = (currentPrice - entryPrice)  if BUY
//           = (entryPrice - currentPrice)  if SELL
//     weightedDelta += delta × usdcSize
//   avgDelta = weightedDelta / totalUSDC
//   entryEdgeScore = clamp((avgDelta + 0.3) / 0.6 × 100, 0, 100)
//   overall = entryEdgeScore × 0.6 + repeatabilityScore × 0.4
//
// currentPrice = last CLOB trade for the specific outcome token (live fetch).
// This measures whether price confirmed the direction after the wallet entered.
export async function computeEntryScore(trades: WalletTrade[]): Promise<EdgeScore> {
  const sampleSize = trades.length
  const uniqueMarkets = new Set(trades.map(t => t.conditionId)).size
  const totalVol = trades.reduce((s, t) => s + (t.usdcSize ?? 0), 0)

  const priceMap = await batchFetchPrices(trades.map(t => t.asset))

  let weightedDelta = 0
  let totalWeight = 0
  let pricesResolved = 0
  let positiveDeltaTrades = 0
  let negativeDeltaTrades = 0
  let unresolvedTrades = 0

  for (const trade of trades) {
    const currentPrice = priceMap.get(trade.asset)
    const entryPrice = trade.price ?? 0

    if (currentPrice === undefined || entryPrice <= 0) {
      unresolvedTrades++
      continue
    }

    const delta = trade.side === 'BUY'
      ? currentPrice - entryPrice
      : entryPrice - currentPrice

    const weight = trade.usdcSize ?? 0
    weightedDelta += delta * weight
    totalWeight += weight
    pricesResolved++

    if (delta > 0) positiveDeltaTrades++
    else negativeDeltaTrades++
  }

  const avgDelta = totalWeight > 0 ? weightedDelta / totalWeight : 0
  const avgDeltaCents = avgDelta * 100

  const entryEdgeScore = Math.min(100, Math.max(0, (avgDelta + 0.3) / 0.6 * 100))
  const repeatabilityScore = computeRepeatabilityScore(uniqueMarkets, sampleSize)
  const overall = Math.min(100, Math.max(0, entryEdgeScore * 0.6 + repeatabilityScore * 0.4))

  return {
    overall: Math.round(overall),
    entryEdgeScore: Math.round(entryEdgeScore),
    repeatabilityScore: Math.round(repeatabilityScore),
    sampleConfidence: getSampleConfidence(sampleSize),
    sampleSize,
    pricesResolved,
    marketsTraded: uniqueMarkets,
    totalVolumeUSDC: totalVol,
    avgDeltaCents,
    breakdown: {
      positiveDeltaTrades,
      negativeDeltaTrades,
      unresolvedTrades,
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
  const breadthScore = Math.min(100, (uniqueMarkets / 10) * 100)
  const depthRatio = totalTrades / Math.max(uniqueMarkets, 1)
  const depthScore = depthRatio >= 2 && depthRatio <= 10
    ? 80
    : depthRatio < 2
      ? depthRatio * 40
      : Math.max(0, 80 - (depthRatio - 10) * 5)
  return breadthScore * 0.5 + depthScore * 0.5
}

const CONFIDENCE_LABEL: Record<EdgeScore['sampleConfidence'], string> = {
  very_low: 'Very Low (< 5 trades)',
  low: 'Low (5–20 trades)',
  medium: 'Medium (20–50 trades)',
  high: 'High (50+ trades)',
}

export function confidenceLabel(c: EdgeScore['sampleConfidence']): string {
  return CONFIDENCE_LABEL[c]
}
