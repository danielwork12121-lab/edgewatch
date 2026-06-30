import type { WalletPosition, WalletTrade } from '../types'
import type { ClosedPosition } from './wallets'
import { formatUSD, toFiniteNumber } from './polymarket'

export type CandidateTier = 'reliable' | 'watch' | 'emerging' | 'ignored'
export type FollowabilityLabel = 'Potentially followable' | 'Too late / price already moved' | 'High risk' | 'Low evidence'

export interface ActiveBetSummary {
  title: string
  outcome: string
  entryPrice: number
  currentPrice: number
  unrealizedPnl: number
  positionSize: number
  endDate: string
  followability: FollowabilityLabel
}

export interface FollowBacktest {
  estimatedReturnPct: number | null
  tradesSimulated: number
  coverage: 'ok' | 'weak' | 'unavailable'
  label: string
}

export interface RepeatableTraderQuality {
  qualityScore: number
  recentQualityScore: number
  realizedPnl: number
  roi: number | null
  profitFactor: number | null
  profitFactorExTopWin: number | null
  winRate: number | null
  medianOutcome: number | null
  winConcentrationPct: number | null
  drawdownPct: number | null
  currentLosingStreak: number
  worstLosingStreak: number
  closedPositions: number
  sampleTrades: number
  marketsTraded: number
  openValue: number
  livePricedTrades: number
  timingEdgePct: number | null
  luckyWinRisk: boolean
  outlierDriven: boolean
  pnlExcludingLargestWin: number
  plainReasons: string[]
  rejectionReason: string
  rejectionCategory: string
  tier: CandidateTier
  backtest: FollowBacktest
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function analyzeStreaks(outcomes: Array<{ won: boolean }>): {
  currentLosingStreak: number
  worstLosingStreak: number
} {
  let currentLosingStreak = 0
  let worstLosingStreak = 0
  let runningLoss = 0

  for (const outcome of outcomes) {
    if (outcome.won) {
      runningLoss = 0
    } else {
      runningLoss += 1
      worstLosingStreak = Math.max(worstLosingStreak, runningLoss)
    }
  }

  for (let i = outcomes.length - 1; i >= 0; i -= 1) {
    if (outcomes[i].won) break
    currentLosingStreak += 1
  }

  return { currentLosingStreak, worstLosingStreak }
}

function computeProfitFactor(values: number[]): number | null {
  const wins = values.filter(v => v > 0).reduce((s, v) => s + v, 0)
  const losses = Math.abs(values.filter(v => v < 0).reduce((s, v) => s + v, 0))
  if (losses === 0) return wins > 0 ? 9.99 : null
  return wins / losses
}

function computeDrawdownPct(values: number[]): number | null {
  let cumulative = 0
  let peak = 0
  let maxDrawdown = 0
  for (const value of values) {
    cumulative += value
    peak = Math.max(peak, cumulative)
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative)
  }
  if (peak <= 0) return null
  return (maxDrawdown / peak) * 100
}

export function simulateFollowBacktest(
  trades: WalletTrade[],
  priceMap: Map<string, number>,
  maxTrades = 30,
): FollowBacktest {
  const ordered = [...trades]
    .filter(t => t.type === 'TRADE' && (t.usdcSize ?? 0) >= 1)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxTrades)

  let simulated = 0
  let totalReturn = 0
  const allocation = 10

  for (const trade of ordered) {
    const current = priceMap.get(trade.asset)
    const entry = trade.price ?? 0
    if (current === undefined || entry <= 0) continue
    const delta = trade.side === 'BUY' ? current - entry : entry - current
    const returnPct = (delta / entry) * 100
    totalReturn += returnPct
    simulated += 1
  }

  if (simulated < 8) {
    return {
      estimatedReturnPct: null,
      tradesSimulated: simulated,
      coverage: simulated === 0 ? 'unavailable' : 'weak',
      label: 'Backtest unavailable / incomplete',
    }
  }

  const avgReturn = totalReturn / simulated
  return {
    estimatedReturnPct: avgReturn,
    tradesSimulated: simulated,
    coverage: simulated >= 15 ? 'ok' : 'weak',
    label: `Estimated follow return ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(1)}% per $${allocation} follow`,
  }
}

export function assessPositionFollowability(
  position: WalletPosition,
  traderQuality: Pick<RepeatableTraderQuality, 'tier' | 'luckyWinRisk' | 'qualityScore'>,
): FollowabilityLabel {
  const entry = toFiniteNumber(position.avgPrice, 0)
  const current = toFiniteNumber(position.curPrice, entry)
  const unrealized = toFiniteNumber(position.cashPnl, 0)
  const initial = toFiniteNumber(position.initialValue, 0)

  if (traderQuality.tier === 'ignored' || traderQuality.qualityScore < 45) {
    return 'Low evidence'
  }
  if (traderQuality.luckyWinRisk) return 'High risk'
  if (initial > 0 && unrealized < 0 && Math.abs(unrealized) > initial * 0.35) {
    return 'High risk'
  }

  const move = entry > 0 ? Math.abs(current - entry) / entry : 0
  if (move >= 0.25 && unrealized > 0) return 'Too late / price already moved'
  if (move >= 0.35 && unrealized <= 0) return 'High risk'

  if (traderQuality.tier === 'reliable' || traderQuality.tier === 'watch') {
    return 'Potentially followable'
  }
  return 'Low evidence'
}

export function summarizeActiveBets(
  positions: WalletPosition[],
  quality: Pick<RepeatableTraderQuality, 'tier' | 'luckyWinRisk' | 'qualityScore'>,
  limit = 3,
): ActiveBetSummary[] {
  return positions
    .filter(p => (p.initialValue ?? 0) > 0 || (p.currentValue ?? 0) > 0)
    .sort((a, b) => toFiniteNumber(b.currentValue, 0) - toFiniteNumber(a.currentValue, 0))
    .slice(0, limit)
    .map(position => ({
      title: position.title,
      outcome: position.outcome,
      entryPrice: toFiniteNumber(position.avgPrice, 0),
      currentPrice: toFiniteNumber(position.curPrice, position.avgPrice),
      unrealizedPnl: toFiniteNumber(position.cashPnl, 0),
      positionSize: toFiniteNumber(position.currentValue, 0),
      endDate: position.endDate,
      followability: assessPositionFollowability(position, quality),
    }))
}

export function computeRepeatableTraderQuality(input: {
  trades: WalletTrade[]
  recentTrades: WalletTrade[]
  positions: WalletPosition[]
  closedPositions: ClosedPosition[]
  priceMap: Map<string, number>
}): RepeatableTraderQuality {
  const { trades, recentTrades, positions, closedPositions, priceMap } = input

  const closedPnls = closedPositions
    .map(p => toFiniteNumber(p.realizedPnl, 0))
    .filter(v => Number.isFinite(v))

  const positionPnls = positions
    .filter(p => (p.initialValue ?? 0) > 0)
    .map(p => toFiniteNumber(p.realizedPnl ?? p.cashPnl, 0))

  const outcomePnls = closedPnls.length >= 5 ? closedPnls : positionPnls.length >= 5 ? positionPnls : closedPnls

  const realizedPnl = outcomePnls.reduce((s, v) => s + v, 0)
  const totalRisked = closedPositions.reduce((s, p) => s + toFiniteNumber(p.totalBought, 0), 0)
    || positions.reduce((s, p) => s + toFiniteNumber(p.initialValue, 0), 0)
  const roi = totalRisked > 0 ? realizedPnl / totalRisked : null

  const profitFactor = computeProfitFactor(outcomePnls)
  const wins = outcomePnls.filter(v => v > 0)
  const winRate = outcomePnls.length > 0 ? wins.length / outcomePnls.length : null
  const medianOutcome = median(outcomePnls)
  const totalPositive = wins.reduce((s, v) => s + v, 0)
  const largestWin = wins.length > 0 ? Math.max(...wins) : 0
  const winConcentrationPct = totalPositive > 0 ? (largestWin / totalPositive) * 100 : null
  const pnlExcludingLargestWin = realizedPnl - largestWin
  const profitFactorExTopWin = computeProfitFactor(
    outcomePnls.filter(v => v !== largestWin || v <= 0),
  )

  const streakSource = outcomePnls.map(v => ({ won: v >= 0 }))
  const streaks = analyzeStreaks(streakSource)
  const drawdownPct = computeDrawdownPct(outcomePnls)

  const orderedTrades = [...trades]
    .filter(t => t.type === 'TRADE' && (t.usdcSize ?? 0) >= 1)
    .sort((a, b) => a.timestamp - b.timestamp)

  const recentOrdered = [...recentTrades]
    .filter(t => t.type === 'TRADE' && (t.usdcSize ?? 0) >= 1)

  const liveOutcomes = orderedTrades.flatMap(trade => {
    const current = priceMap.get(trade.asset)
    const entry = trade.price ?? 0
    if (current === undefined || entry <= 0) return []
    const signed = trade.side === 'BUY'
      ? (current - entry) * (trade.usdcSize ?? 0)
      : (entry - current) * (trade.usdcSize ?? 0)
    return [{ signed, positive: signed > 0 }]
  })

  const recentOutcomes = recentOrdered.flatMap(trade => {
    const current = priceMap.get(trade.asset)
    const entry = trade.price ?? 0
    if (current === undefined || entry <= 0) return []
    const signed = trade.side === 'BUY'
      ? (current - entry) * (trade.usdcSize ?? 0)
      : (entry - current) * (trade.usdcSize ?? 0)
    return [{ signed, positive: signed > 0 }]
  })

  const livePricedTrades = liveOutcomes.length
  const timingEdgePct = liveOutcomes.length > 0
    ? (liveOutcomes.filter(o => o.positive).length / liveOutcomes.length) * 100
    : null
  const recentTimingEdgePct = recentOutcomes.length > 0
    ? (recentOutcomes.filter(o => o.positive).length / recentOutcomes.length) * 100
    : null

  const openValue = positions.reduce((s, p) => s + toFiniteNumber(p.currentValue, 0), 0)
  const marketsTraded = new Set([
    ...trades.map(t => t.conditionId),
    ...closedPositions.map(p => p.conditionId),
  ].filter(Boolean)).size

  const luckyWinRisk =
    (realizedPnl > 0 && pnlExcludingLargestWin < 0) ||
    (winConcentrationPct !== null && winConcentrationPct > 55 && (winRate ?? 1) < 0.5) ||
    (medianOutcome !== null && medianOutcome < 0 && realizedPnl > 0) ||
    (profitFactorExTopWin !== null && profitFactorExTopWin < 1.05 && realizedPnl > 0)

  const outlierDriven = luckyWinRisk || (pnlExcludingLargestWin < 0 && realizedPnl > 0)

  const plainReasons: string[] = []
  const pushReason = (text: string) => {
    if (plainReasons.length < 6) plainReasons.push(text)
  }

  if (realizedPnl >= 0 && closedPnls.length >= 10) {
    pushReason('Profitable across many closed positions')
  }
  if (profitFactor !== null && profitFactor >= 1.25 && outcomePnls.length >= 10) {
    pushReason(`Profit factor ${profitFactor.toFixed(2)} across ${outcomePnls.length} positions`)
  }
  if (pnlExcludingLargestWin >= 0 && realizedPnl > 0) {
    pushReason('Positive after removing largest win')
  }
  if (drawdownPct !== null && drawdownPct <= 25) {
    pushReason('Low drawdown')
  }
  if (qualityComponentsRecentStrong(recentTimingEdgePct, recentOutcomes.length, timingEdgePct, livePricedTrades)) {
    pushReason('Consistent recent and long-term results')
  }

  const scoreInputs = {
    realizedPnl,
    roi,
    profitFactor,
    winRate,
    medianOutcome,
    drawdownPct,
    streaks,
    sampleSize: Math.max(outcomePnls.length, orderedTrades.length),
    marketsTraded,
    openValue,
    luckyWinRisk,
    outlierDriven,
    livePricedTrades,
    timingEdgePct,
  }

  const qualityScore = computeQualityScore(scoreInputs)
  const recentQualityScore = computeQualityScore({
    ...scoreInputs,
    timingEdgePct: recentTimingEdgePct ?? timingEdgePct,
    sampleSize: Math.max(recentOrdered.length, Math.floor(scoreInputs.sampleSize / 3)),
  })

  const backtest = simulateFollowBacktest(orderedTrades, priceMap)

  const tierResult = classifyTier({
    qualityScore,
    recentQualityScore,
    realizedPnl,
    roi,
    profitFactor,
    profitFactorExTopWin,
    winRate,
    medianOutcome,
    drawdownPct,
    currentLosingStreak: streaks.currentLosingStreak,
    worstLosingStreak: streaks.worstLosingStreak,
    closedPositions: outcomePnls.length,
    recentTrades: recentOrdered.length,
    historicalTrades: orderedTrades.length,
    marketsTraded,
    openValue,
    luckyWinRisk,
    outlierDriven,
    pnlExcludingLargestWin,
    timingEdgePct: recentTimingEdgePct ?? timingEdgePct,
    livePricedTrades,
    recentLivePriced: recentOutcomes.length,
  })

  if (tierResult.tier === 'reliable' || tierResult.tier === 'watch') {
    // keep positive plain reasons
  } else if (outlierDriven) {
    pushReason('Outlier-driven profit — not enough repeatable evidence')
  } else if (luckyWinRisk) {
    pushReason('Profit depends on one large win')
  } else if (medianOutcome !== null && medianOutcome < 0) {
    pushReason('Median result is negative')
  } else if (openValue > 0 && realizedPnl < 0 && openValue > Math.abs(realizedPnl) * 1.5) {
    pushReason('Large exposure with weak history')
  }

  return {
    qualityScore,
    recentQualityScore,
    realizedPnl,
    roi,
    profitFactor,
    profitFactorExTopWin,
    winRate,
    medianOutcome,
    winConcentrationPct,
    drawdownPct,
    currentLosingStreak: streaks.currentLosingStreak,
    worstLosingStreak: streaks.worstLosingStreak,
    closedPositions: outcomePnls.length,
    sampleTrades: orderedTrades.length,
    marketsTraded,
    openValue,
    livePricedTrades,
    timingEdgePct,
    luckyWinRisk,
    outlierDriven,
    pnlExcludingLargestWin,
    plainReasons: tierResult.tier === 'ignored'
      ? [tierResult.rejectionReason, ...plainReasons].filter(Boolean).slice(0, 5)
      : plainReasons.slice(0, 5),
    rejectionReason: tierResult.rejectionReason,
    rejectionCategory: tierResult.rejectionCategory,
    tier: tierResult.tier,
    backtest,
  }
}

function qualityComponentsRecentStrong(
  recentTiming: number | null,
  recentCount: number,
  allTiming: number | null,
  allCount: number,
): boolean {
  if (recentTiming !== null && recentTiming >= 55 && recentCount >= 8) return true
  if (allTiming !== null && allTiming >= 55 && allCount >= 20) return true
  return false
}

function computeQualityScore(input: {
  realizedPnl: number
  roi: number | null
  profitFactor: number | null
  winRate: number | null
  medianOutcome: number | null
  drawdownPct: number | null
  streaks: { currentLosingStreak: number; worstLosingStreak: number }
  sampleSize: number
  marketsTraded: number
  openValue: number
  luckyWinRisk: boolean
  outlierDriven: boolean
  livePricedTrades: number
  timingEdgePct: number | null
}): number {
  const roiScore = input.roi === null ? 40 : clamp(50 + input.roi * 200, 0, 100)
  const pfScore = input.profitFactor === null ? 35 : clamp(50 + (input.profitFactor >= 1 ? Math.log10(input.profitFactor + 1) * 35 : -25), 0, 100)
  const winScore = input.winRate === null ? 40 : clamp(input.winRate * 100, 0, 100)
  const medianScore = input.medianOutcome === null ? 45 : clamp(50 + input.medianOutcome * 2, 0, 100)
  const ddScore = input.drawdownPct === null ? 50 : clamp(100 - input.drawdownPct, 0, 100)
  const sampleScore = clamp((input.sampleSize / 25) * 100, 0, 100)
  const diversityScore = clamp((input.marketsTraded / 5) * 100, 0, 100)
  const timingScore = input.timingEdgePct === null ? 40 : clamp(input.timingEdgePct, 0, 100)
  const streakPenalty = input.streaks.currentLosingStreak * 8 + Math.max(0, input.streaks.worstLosingStreak - 6) * 3
  const exposurePenalty = input.openValue > 0 && input.realizedPnl < 0 && input.openValue > Math.abs(input.realizedPnl) * 2 ? 18 : 0
  const outlierPenalty = input.outlierDriven ? 25 : input.luckyWinRisk ? 15 : 0

  let score =
    roiScore * 0.18 +
    pfScore * 0.18 +
    winScore * 0.12 +
    medianScore * 0.12 +
    ddScore * 0.12 +
    sampleScore * 0.10 +
    diversityScore * 0.08 +
    timingScore * 0.10

  score -= streakPenalty
  score -= exposurePenalty
  score -= outlierPenalty
  return Math.round(clamp(score, 0, 100))
}

function classifyTier(input: {
  qualityScore: number
  recentQualityScore: number
  realizedPnl: number
  roi: number | null
  profitFactor: number | null
  profitFactorExTopWin: number | null
  winRate: number | null
  medianOutcome: number | null
  drawdownPct: number | null
  currentLosingStreak: number
  worstLosingStreak: number
  closedPositions: number
  recentTrades: number
  historicalTrades: number
  marketsTraded: number
  openValue: number
  luckyWinRisk: boolean
  outlierDriven: boolean
  pnlExcludingLargestWin: number
  timingEdgePct: number | null
  livePricedTrades: number
  recentLivePriced: number
}): { tier: CandidateTier; rejectionReason: string; rejectionCategory: string } {
  const reject = (reason: string, category: string) => ({
    tier: 'ignored' as const,
    rejectionReason: reason,
    rejectionCategory: category,
  })

  if (input.outlierDriven) {
    return reject('Outlier-driven profit — not enough repeatable evidence', 'lucky_win_risk')
  }
  if (input.luckyWinRisk) {
    return reject('Profit depends on one large win', 'lucky_win_risk')
  }
  if (input.realizedPnl < 0 && (input.profitFactor ?? 0) <= 1.1) {
    return reject('Negative PnL with weak profit factor', 'negative_pnl')
  }
  if (input.closedPositions < 10 && input.historicalTrades < 15) {
    return reject('Not enough closed positions', 'too_little_history')
  }
  if (input.recentTrades < 5 && input.historicalTrades < 10) {
    return reject('Too few recent trades', 'weak_sample')
  }
  if (input.marketsTraded < 2) {
    return reject('Too few unique markets', 'weak_sample')
  }
  if (input.winRate !== null && input.winRate < 0.45) {
    return reject(`Win rate below 45% (${(input.winRate * 100).toFixed(0)}%)`, 'poor_win_rate')
  }
  if (input.currentLosingStreak >= 4) {
    return reject(`Current losing streak (${input.currentLosingStreak})`, 'severe_losing_streak')
  }
  if (input.worstLosingStreak >= 10) {
    return reject(`Worst losing streak (${input.worstLosingStreak})`, 'severe_losing_streak')
  }
  if (input.drawdownPct !== null && input.drawdownPct > 45) {
    return reject(`Severe drawdown (${input.drawdownPct.toFixed(0)}%)`, 'severe_drawdown')
  }
  if (input.openValue > 0 && input.realizedPnl < 0 && input.openValue > Math.max(1000, Math.abs(input.realizedPnl) * 2)) {
    return reject('Large open exposure with weak realized history', 'open_exposure_risk')
  }
  if (input.medianOutcome !== null && input.medianOutcome < 0 && input.realizedPnl > 0) {
    return reject('Median position result is negative', 'outlier_driven')
  }

  const reliable =
    input.qualityScore >= 75 &&
    input.realizedPnl > 0 &&
    (input.profitFactor ?? 0) >= 1.25 &&
    input.pnlExcludingLargestWin >= 0 &&
    (input.drawdownPct ?? 100) <= 40 &&
    input.currentLosingStreak < 3 &&
    input.closedPositions >= 15 &&
    (input.roi ?? 0) >= 0.02

  if (reliable) {
    return { tier: 'reliable', rejectionReason: '', rejectionCategory: '' }
  }

  const strongWatch =
    input.qualityScore >= 60 &&
    !input.outlierDriven &&
    !input.luckyWinRisk &&
    ((input.profitFactor ?? 0) >= 1.15 || (input.roi ?? 0) > 0) &&
    input.closedPositions >= 10 &&
    input.realizedPnl >= -25 &&
    input.marketsTraded >= 3 &&
    input.currentLosingStreak < 4

  if (strongWatch) {
    return { tier: 'watch', rejectionReason: '', rejectionCategory: '' }
  }

  const emerging =
    input.qualityScore >= 45 &&
    input.recentQualityScore >= 50 &&
    input.realizedPnl >= -25 &&
    !input.outlierDriven &&
    !input.luckyWinRisk &&
    input.closedPositions >= 5 &&
    input.marketsTraded >= 2 &&
    (input.timingEdgePct ?? 0) >= 52 &&
    input.recentLivePriced >= 5 &&
    input.currentLosingStreak < 3

  if (emerging) {
    return { tier: 'emerging', rejectionReason: '', rejectionCategory: '' }
  }

  if (input.qualityScore < 55) {
    return reject(`Quality score too low (${input.qualityScore}/100)`, 'low_quality')
  }
  if ((input.profitFactor ?? 0) < 1.1 && input.realizedPnl <= 0) {
    return reject('Weak profit factor', 'poor_profit_factor')
  }
  if (!input.outlierDriven && input.realizedPnl < 0) {
    return reject(`Negative realized PnL (${formatUSD(input.realizedPnl)})`, 'negative_pnl')
  }
  return reject('No strong repeatable performance signal', 'no_promising_signal')
}

export type CopySignal = 'COPY' | 'WATCH' | 'IGNORE'
export type DataConfidenceLevel = 'Low' | 'Medium' | 'High'

export interface TraderQualityMetrics {
  realizedPnl: number
  roi: number | null
  profitFactor: number | null
  winRate: number | null
  medianOutcome: number | null
  drawdownPct: number | null
  currentLosingStreak: number
  worstLosingStreak: number
  closedPositions: number
  sampleTrades: number
  marketsTraded: number
  openValue: number
  timingEdgePct: number | null
}

export interface TraderQualityEvaluation {
  reliabilityScore: number
  qualityScore: number
  recentQualityScore: number
  copySignal: CopySignal
  confidenceLevel: DataConfidenceLevel
  dataConfidenceLabel: string
  tier: CandidateTier
  tierLabel: string
  rejectionReasons: string[]
  positiveReasons: string[]
  riskLabels: string[]
  metrics: TraderQualityMetrics
  rejectionReason: string
  rejectionCategory: string
  luckyWinRisk: boolean
  outlierDriven: boolean
  pnlExcludingLargestWin: number
  backtest: FollowBacktest
  plainReasons: string[]
  winRate: number | null
  profitFactor: number | null
  roi: number | null
  closedPositions: number
  sampleTrades: number
  currentLosingStreak: number
  worstLosingStreak: number
}

function deriveCopySignal(tier: CandidateTier): CopySignal {
  if (tier === 'reliable') return 'COPY'
  if (tier === 'watch' || tier === 'emerging') return 'WATCH'
  return 'IGNORE'
}

export function tierDisplayLabel(tier: CandidateTier, rejectionReason = ''): string {
  switch (tier) {
    case 'reliable':
      return 'Reliable candidate'
    case 'watch':
      return 'Strong watch candidate'
    case 'emerging':
      return 'Emerging trader — limited evidence'
    case 'ignored':
      return rejectionReason || 'Rejected'
    default: {
      const _exhaustive: never = tier
      return _exhaustive
    }
  }
}

function deriveDataConfidence(
  closedPositions: number,
  sampleTrades: number,
): { level: DataConfidenceLevel; label: string } {
  const sample = Math.max(closedPositions, sampleTrades)
  if (sample >= 40) {
    return { level: 'High', label: `Data confidence High · ${sample}+ records analyzed` }
  }
  if (sample >= 15) {
    return { level: 'Medium', label: `Data confidence Medium · ${sample} records analyzed` }
  }
  return { level: 'Low', label: `Data confidence Low · ${sample} records analyzed` }
}

function splitQualityReasons(
  plainReasons: string[],
  luckyWinRisk: boolean,
  outlierDriven: boolean,
): { positiveReasons: string[]; riskLabels: string[] } {
  const riskLabels: string[] = []
  if (luckyWinRisk) riskLabels.push('Lucky win risk')
  if (outlierDriven) riskLabels.push('Outlier-driven profit')

  const positiveReasons = plainReasons.filter(reason => {
    const lower = reason.toLowerCase()
    return !lower.includes('outlier') && !lower.includes('lucky') && !lower.includes('depends on')
  })

  return { positiveReasons, riskLabels }
}

export function evaluateTraderQuality(input: {
  trades: WalletTrade[]
  recentTrades?: WalletTrade[]
  positions: WalletPosition[]
  closedPositions: ClosedPosition[]
  priceMap: Map<string, number>
}): TraderQualityEvaluation {
  const base = computeRepeatableTraderQuality({
    ...input,
    recentTrades: input.recentTrades ?? input.trades,
  })
  const copySignal = deriveCopySignal(base.tier)
  const { level, label } = deriveDataConfidence(base.closedPositions, base.sampleTrades)
  const { positiveReasons, riskLabels } = splitQualityReasons(
    base.plainReasons,
    base.luckyWinRisk,
    base.outlierDriven,
  )

  const rejectionReasons =
    base.tier === 'ignored'
      ? [base.rejectionReason, ...base.plainReasons].filter(Boolean)
      : []

  return {
    reliabilityScore: base.qualityScore,
    qualityScore: base.qualityScore,
    recentQualityScore: base.recentQualityScore,
    copySignal,
    confidenceLevel: level,
    dataConfidenceLabel: label,
    tier: base.tier,
    tierLabel: tierDisplayLabel(base.tier, base.rejectionReason),
    rejectionReasons,
    positiveReasons,
    riskLabels,
    metrics: {
      realizedPnl: base.realizedPnl,
      roi: base.roi,
      profitFactor: base.profitFactor,
      winRate: base.winRate,
      medianOutcome: base.medianOutcome,
      drawdownPct: base.drawdownPct,
      currentLosingStreak: base.currentLosingStreak,
      worstLosingStreak: base.worstLosingStreak,
      closedPositions: base.closedPositions,
      sampleTrades: base.sampleTrades,
      marketsTraded: base.marketsTraded,
      openValue: base.openValue,
      timingEdgePct: base.timingEdgePct,
    },
    rejectionReason: base.rejectionReason,
    rejectionCategory: base.rejectionCategory,
    luckyWinRisk: base.luckyWinRisk,
    outlierDriven: base.outlierDriven,
    pnlExcludingLargestWin: base.pnlExcludingLargestWin,
    backtest: base.backtest,
    plainReasons: base.plainReasons,
    winRate: base.winRate,
    profitFactor: base.profitFactor,
    roi: base.roi,
    closedPositions: base.closedPositions,
    sampleTrades: base.sampleTrades,
    currentLosingStreak: base.currentLosingStreak,
    worstLosingStreak: base.worstLosingStreak,
  }
}

export function categorizeQualityRejection(reason: string): string {
  const lower = reason.toLowerCase()
  if (lower.includes('outlier') || lower.includes('lucky') || lower.includes('large win')) return 'lucky_win_risk'
  if (lower.includes('win rate')) return 'poor_win_rate'
  if (lower.includes('pnl') || lower.includes('profit factor')) return 'negative_pnl'
  if (lower.includes('streak')) return 'severe_losing_streak'
  if (lower.includes('drawdown')) return 'severe_drawdown'
  if (lower.includes('quality score')) return 'low_quality'
  if (lower.includes('history') || lower.includes('closed position')) return 'too_little_history'
  if (lower.includes('recent trade') || lower.includes('market')) return 'weak_sample'
  if (lower.includes('exposure')) return 'open_exposure_risk'
  if (lower.includes('median')) return 'outlier_driven'
  if (lower.includes('signal')) return 'no_promising_signal'
  return 'other'
}
