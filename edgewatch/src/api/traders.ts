import type { PolyEvent, WalletTrade, TraderRankEntry } from '../types'
import { getMarketTrades, getWalletActivity, getWalletPositions, truncateAddress } from './wallets'
import { formatUSD, fetchTrending, searchEvents, toFiniteNumber } from './polymarket'
import { batchFetchPrices } from './priceTracker'
import { cacheGet, cacheSet, TTL } from './cache'

export interface HotTraderEntry {
  address: string
  label: string
  pseudonym: string
  name: string
  candidateTier: 'reliable' | 'watch' | 'ignored'
  hotScore: number
  reliabilityScore: number
  copySignal: 'COPY' | 'WATCH' | 'IGNORE'
  confidence: 'Low' | 'Medium' | 'High'
  recentTradeCount: number
  recentVolumeUSDC: number
  avgTradeSize: number
  marketsTraded: number
  activeMarkets: string[]
  realizedPnl: number | null
  openValue: number | null
  totalPnl: number | null
  resolvedPositions: number
  currentLosingStreak: number
  worstLosingStreak: number
  timingEdge: number | null
  pnl: number | null
  winRate: number | null
  reliabilityLabel: string
  reliabilityReasons: string[]
  scoreReasons: string[]
  isReliableCandidate: boolean
  historicalTradeCount: number
  rejectionReason?: string
}

export interface NearMissEntry {
  address: string
  label: string
  reliabilityScore: number
  winRate: number | null
  realizedPnl: number | null
  tradeCount: number
  rejectionReason: string
}

export interface CopyDiscoverySummary {
  scannedTrades: number
  uniqueTrades: number
  scannedWallets: number
  enrichedWallets: number
  reliableCandidates: number
  watchCandidates: number
  ignoredActiveTraders: number
  scanSource: string
  apiNote: string | null
  emptyReasons: string[]
  rejectionBreakdown: Record<string, number>
}

export interface CopyDiscoveryDiagnostics extends HotTraderDiagnostics {
  sourceBreakdown: Record<string, number>
  marketPoolsScanned: number
  candidateWallets: number
  enrichedWallets: number
  reliableCandidates: number
  watchCandidates: number
  ignoredActiveTraders: number
}

export interface CopyDiscoveryResult {
  state: 'ok' | 'error' | 'empty'
  message: string
  reliable: HotTraderEntry[]
  watchlist: HotTraderEntry[]
  ignored: HotTraderEntry[]
  nearMisses: NearMissEntry[]
  summary: CopyDiscoverySummary
  diagnostics: CopyDiscoveryDiagnostics
}

export interface BestTrade {
  address: string
  pseudonym: string
  name: string
  side: 'BUY' | 'SELL'
  outcome: string
  entryPrice: number
  currentPrice: number
  delta: number
  profitMultiple: number
  sizeUSDC: number
  timestamp: number
  title: string
  conditionId: string
  asset: string
}

export interface MarketIntelligence {
  traders: TraderRankEntry[]
  bestTrades: BestTrade[]
  totalTrades: number
}

interface HotWalletAgg {
  address: string
  pseudonym: string
  name: string
  trades: WalletTrade[]
  volume: number
  markets: Map<string, { label: string; count: number; lastTs: number }>
  positiveMoves: number
  resolvedMoves: number
}

interface HotTradeNormalized {
  address: string
  walletLabel: string
  title: string
  marketKey: string
  marketName: string
  volumeUSDC: number
  price: number
  timestamp: number
  side: 'BUY' | 'SELL'
  asset: string
}

interface HotTraderDiagnostics {
  endpoint: string
  status: number | null
  rawType: string
  contentType: string | null
  rawTradeCount: number
  rawSamples: unknown[]
  normalizedTradeCount: number
  walletGroupCount: number
  finalHotTraderCount: number
  discardedReasons: Record<string, number>
}

export interface TraderReliability {
  reliabilityScore: number
  copySignal: 'COPY' | 'WATCH' | 'IGNORE'
  confidence: 'Low' | 'Medium' | 'High'
  reliabilityLabel: string
  reliabilityReasons: string[]
  hardFailReasons: string[]
  candidateTier: 'reliable' | 'watch' | 'ignored'
  currentLosingStreak: number
  worstLosingStreak: number
  realizedPnl: number | null
  openValue: number | null
  totalPnl: number | null
  winRate: number | null
  profitFactor: number | null
  drawdownPct: number | null
  livePriceCoverage: number
  winCount: number
  lossCount: number
  sampleSize: number
  resolvedPositions: number
  isReliableCandidate: boolean
}

export interface HotTraderLoadResult {
  state: 'ok' | 'error' | 'no-trades' | 'filtered-out'
  message: string
  traders: HotTraderEntry[]
  diagnostics: HotTraderDiagnostics
}

// ─── Internal helper ───────────────────────────────────────────────────────

const HOT_TRADES_ENDPOINT = 'https://data-api.polymarket.com/trades?limit=200'
const DISCOVERY_TRADES_BASE = 'https://data-api.polymarket.com/trades'
const DISCOVERY_TERMS = ['bitcoin', 'crypto', 'election', 'president', 'world cup', 'f1', 'movie', 'music', 'anime', 'ai', 'science']
const GLOBAL_TRADE_PAGE_SIZE = 200
const INITIAL_GLOBAL_PAGES = 5
const DEEP_SCAN_EXTRA_PAGES = 5
const MAX_ENRICH_WALLETS = 50
const MAX_CANDIDATE_WALLETS = 80

const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug('[EdgeWatch][hot-traders]', ...args)
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function toTimestampSeconds(value: unknown): number {
  const numeric = toFiniteNumber(value, Number.NaN)
  if (Number.isFinite(numeric)) return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric)
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000)
  }
  return 0
}

function extractTokenIdsFromEvent(event: PolyEvent): string[] {
  const tokenIds: string[] = []
  for (const market of event.markets ?? []) {
    if (!market.clobTokenIds) continue
    try {
      const parsed: unknown = JSON.parse(market.clobTokenIds)
      if (Array.isArray(parsed)) {
        for (const id of parsed.slice(0, 2)) {
          const tokenId = firstString(id)
          if (tokenId) tokenIds.push(tokenId)
        }
      }
    } catch {
      continue
    }
  }
  return tokenIds
}

function normalizeRawTrade(raw: unknown): HotTradeNormalized | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const address = firstString(
    record.proxyWallet,
    record.wallet,
    record.user,
    record.maker,
    record.taker,
    record.owner,
  ).toLowerCase()
  const volumeUSDC = toFiniteNumber(
    record.usdcSize ?? record.sizeUsd ?? record.size ?? record.amount ?? record.volume,
    Number.NaN,
  )
  const price = toFiniteNumber(record.price ?? record.outcomePrice ?? record.entryPrice, Number.NaN)
  const timestamp = toTimestampSeconds(record.timestamp ?? record.createdAt ?? record.tradeTime ?? record.time)
  const title = firstString(
    record.title,
    record.marketQuestion,
    record.question,
    record.market,
    record.marketSlug,
    record.slug,
    record.eventSlug,
  ) || 'Unknown market'
  const marketKey = firstString(record.conditionId, record.marketId, record.tokenId, record.asset, record.slug, title)
  const marketName = firstString(record.marketQuestion, record.title, record.market, record.slug, title) || title
  const side = String(record.side ?? '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY'
  const walletLabel = firstString(record.pseudonym, record.name, record.label)
  const asset = firstString(record.asset, record.tokenId, record.marketId, marketKey)

  if (!address || !marketKey || !Number.isFinite(volumeUSDC) || volumeUSDC <= 0) return null

  return {
    address,
    walletLabel,
    title,
    marketKey,
    marketName,
    volumeUSDC,
    price: Number.isFinite(price) ? price : 0,
    timestamp: timestamp > 0 ? timestamp : Math.floor(Date.now() / 1000),
    side: side === 'SELL' ? 'SELL' : 'BUY',
    asset,
  }
}

function computeHotScore(agg: HotWalletAgg): number {
  const recentVolume = agg.volume
  const recentTrades = agg.trades.length
  const marketsTraded = agg.markets.size
  const latestTrade = agg.trades.reduce((max, trade) => Math.max(max, trade.timestamp), 0)
  const ageHours = latestTrade > 0 ? Math.max(0, (Date.now() / 1000 - latestTrade) / 3600) : 999
  const recencyComponent = Math.max(0, 20 - Math.min(20, ageHours * 2))
  const volumeComponent = Math.min(38, Math.log10(recentVolume + 1) * 12)
  const activityComponent = Math.min(24, recentTrades * 8)
  const breadthComponent = Math.min(18, marketsTraded * 6)
  const averageSize = recentVolume / Math.max(recentTrades, 1)
  const avgComponent = Math.min(8, Math.log10(averageSize + 1) * 4)
  const singleTradePenalty = recentTrades === 1 ? 8 : 0
  const score = volumeComponent + activityComponent + breadthComponent + recencyComponent + avgComponent - singleTradePenalty
  return Math.max(0, Math.min(100, score))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function confidenceFromCount(sampleSize: number, liveCoverage: number): 'Low' | 'Medium' | 'High' {
  if (liveCoverage < 0.5) return 'Low'
  if (sampleSize >= 40) return 'High'
  if (sampleSize >= 15) return 'Medium'
  return 'Low'
}

function analyzeStreaks(outcomes: Array<{ won: boolean }>): { currentLosingStreak: number; worstLosingStreak: number; currentWinningStreak: number; worstWinningStreak: number } {
  let currentLosingStreak = 0
  let currentWinningStreak = 0
  let worstLosingStreak = 0
  let worstWinningStreak = 0
  let runningLoss = 0
  let runningWin = 0

  for (const outcome of outcomes) {
    if (outcome.won) {
      runningWin += 1
      runningLoss = 0
    } else {
      runningLoss += 1
      runningWin = 0
    }
    worstWinningStreak = Math.max(worstWinningStreak, runningWin)
    worstLosingStreak = Math.max(worstLosingStreak, runningLoss)
  }

  for (let i = outcomes.length - 1; i >= 0; i -= 1) {
    if (outcomes[i].won) {
      if (currentLosingStreak > 0) break
      currentWinningStreak += 1
    } else {
      if (currentWinningStreak > 0) break
      currentLosingStreak += 1
    }
  }

  return { currentLosingStreak, worstLosingStreak, currentWinningStreak, worstWinningStreak }
}

function buildReliabilityReasons(data: {
  sampleSize: number
  resolvedPositions: number
  winRate: number | null
  realizedPnl: number | null
  worstLosingStreak: number
  currentLosingStreak: number
  profitFactor: number | null
  drawdownPct: number | null
  concentrationPct: number | null
  openValue: number | null
  reliabilityScore: number
  hardFailReasons: string[]
  livePriceCoverage: number
}): string[] {
  const reasons: string[] = []
  for (const reason of data.hardFailReasons) reasons.push(reason)
  reasons.push(`✓ ${data.sampleSize} historical trades`)
  if (data.resolvedPositions > 0) reasons.push(`✓ ${data.resolvedPositions} closed positions`)
  if (data.winRate !== null) reasons.push(`✓ ${(data.winRate * 100).toFixed(0)}% win rate`)
  if (data.realizedPnl !== null) reasons.push(`✓ Realized PnL ${data.realizedPnl >= 0 ? '+' : ''}${formatUSD(data.realizedPnl)}`)
  if (data.profitFactor !== null) reasons.push(`✓ Profit factor ${data.profitFactor.toFixed(2)}`)
  if (data.drawdownPct !== null) reasons.push(`✓ Drawdown ${(data.drawdownPct).toFixed(0)}%`)
  reasons.push(`✓ Current streak ${data.currentLosingStreak > 0 ? `losing ${data.currentLosingStreak}` : 'not losing'}`)
  reasons.push(`✓ Worst losing streak ${data.worstLosingStreak}`)
  if (data.concentrationPct !== null && data.concentrationPct > 0) {
    reasons.push(`${data.concentrationPct >= 60 ? '⚠' : '•'} One-trade concentration ${data.concentrationPct.toFixed(0)}%`)
  }
  if (data.openValue !== null) reasons.push(`✓ Open value ${formatUSD(data.openValue)}`)
  reasons.push(`✓ Live-priced trades ${Math.round(data.livePriceCoverage * 100)}%`)
  reasons.push(`✓ Reliability ${Math.round(data.reliabilityScore)}/100`)
  return reasons.slice(0, 8)
}

export function analyzeTraderReliability(
  trades: WalletTrade[],
  positions: Array<{ cashPnl?: number | null; realizedPnl?: number | null; currentValue?: number | null; initialValue?: number | null }>,
  priceMap: Map<string, number>,
): TraderReliability {
  const orderedTrades = [...trades]
    .filter(t => t.type === 'TRADE' && (t.usdcSize ?? 0) >= 1)
    .sort((a, b) => a.timestamp - b.timestamp)

  const resolved = orderedTrades.flatMap(trade => {
    const currentPrice = priceMap.get(trade.asset)
    const entryPrice = trade.price ?? 0
    if (currentPrice === undefined || entryPrice <= 0) return []
    const won = trade.side === 'BUY' ? currentPrice > entryPrice : currentPrice < entryPrice
    const signedPnl = trade.side === 'BUY'
      ? (currentPrice - entryPrice) * (trade.usdcSize ?? 0)
      : (entryPrice - currentPrice) * (trade.usdcSize ?? 0)
    return [{ won, signedPnl }]
  })

  const wins = resolved.filter(r => r.won).length
  const losses = resolved.length - wins
  const winRate = resolved.length > 0 ? wins / resolved.length : null
  const signedPnls = resolved.map(r => r.signedPnl)
  const totalPositive = signedPnls.filter(v => v > 0).reduce((s, v) => s + v, 0)
  const totalNegative = Math.abs(signedPnls.filter(v => v < 0).reduce((s, v) => s + v, 0))
  const profitFactor = totalNegative > 0 ? totalPositive / totalNegative : (totalPositive > 0 ? 9.99 : null)

  const streaks = analyzeStreaks(resolved)
  const realizedPnl = positions.reduce((sum, pos) => sum + toFiniteNumber(pos.realizedPnl ?? pos.cashPnl, 0), 0)
  const openValue = positions.reduce((sum, pos) => sum + toFiniteNumber(pos.currentValue, 0), 0)
  const openPnl = positions.reduce((sum, pos) => sum + toFiniteNumber(pos.cashPnl, 0), 0)
  const totalPnl = realizedPnl + openPnl
  const closedPositions = positions.filter(pos => (pos.initialValue ?? 0) > 0).length
  const sampleSize = orderedTrades.length
  const resolvedPositions = closedPositions
  const livePriceCoverage = sampleSize > 0 ? resolved.length / sampleSize : 0

  let cumulative = 0
  let peak = 0
  let maxDrawdown = 0
  for (const pnl of signedPnls) {
    cumulative += pnl
    peak = Math.max(peak, cumulative)
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative)
  }
  const drawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : null

  const avgSignedPnl = signedPnls.length > 0 ? signedPnls.reduce((s, v) => s + v, 0) / signedPnls.length : 0
  const entryEdgeScore = clamp(50 + avgSignedPnl * 0.5, 0, 100)
  const sampleSizeScore = clamp((Math.max(sampleSize, resolvedPositions * 2) / 20) * 100, 0, 100)
  const winRateScore = winRate === null ? 0 : clamp(winRate * 100, 0, 100)
  const realizedPnlScore = clamp(50 + Math.log10(Math.abs(realizedPnl) + 1) * (realizedPnl >= 0 ? 12 : -12), 0, 100)
  const streakScore = clamp(100 - streaks.worstLosingStreak * 7 - streaks.currentLosingStreak * 10, 0, 100)
  const profitFactorScore = profitFactor === null ? 50 : clamp(50 + (profitFactor >= 1 ? Math.log10(profitFactor + 1) * 25 : -Math.log10(1 / Math.max(profitFactor, 0.01) + 1) * 25), 0, 100)
  const consistencyScore = clamp((streakScore * 0.6) + (profitFactorScore * 0.4), 0, 100)
  const drawdownScore = clamp(100 - (drawdownPct ?? 50), 0, 100)
  const exposurePenalty = openValue > 0 && realizedPnl < 0 && openValue > Math.abs(realizedPnl) * 2 ? 20 : 0
  const openExposureScore = clamp(100 - Math.min(100, openValue > 0 ? (openValue / Math.max(Math.abs(realizedPnl), 1)) * 25 : 0), 0, 100)

  let reliabilityScore =
    winRateScore * 0.20 +
    realizedPnlScore * 0.20 +
    consistencyScore * 0.20 +
    drawdownScore * 0.15 +
    sampleSizeScore * 0.10 +
    entryEdgeScore * 0.10 +
    openExposureScore * 0.05

  const concentrationPct = totalPositive > 0 ? (Math.max(...signedPnls.filter(v => v > 0), 0) / totalPositive) * 100 : null
  const hardFailReasons: string[] = []
  if (winRate !== null && winRate < 0.35) hardFailReasons.push('Ignored: poor win rate')
  if (realizedPnl < 0 && (winRate ?? 0) < 0.45) hardFailReasons.push('Ignored: negative realized performance')
  if (realizedPnl <= -1000 || totalPnl <= -1000) hardFailReasons.push('Ignored: negative realized performance')
  if (streaks.currentLosingStreak >= 5) hardFailReasons.push('Ignored: severe losing streak')
  if (streaks.worstLosingStreak >= 15) hardFailReasons.push('Ignored: severe losing streak')
  if (losses >= Math.max(10, wins * 3)) hardFailReasons.push('Ignored: loss count overwhelms wins')
  if (openValue > 0 && realizedPnl < 0 && openValue > Math.max(1000, Math.abs(realizedPnl) * 2)) hardFailReasons.push('Ignored: large open exposure with poor realized performance')
  if (concentrationPct !== null && concentrationPct > 60) hardFailReasons.push('Ignored: one big win risk')

  if (winRate !== null && winRate < 0.35) reliabilityScore = Math.min(reliabilityScore, 35)
  if (winRate !== null && winRate < 0.20) reliabilityScore = Math.min(reliabilityScore, 20)
  if (realizedPnl < 0 && (winRate ?? 0) < 0.45) reliabilityScore = Math.min(reliabilityScore, 30)
  if (streaks.worstLosingStreak >= 20) reliabilityScore = Math.min(reliabilityScore, 30)
  if (streaks.currentLosingStreak >= 5) reliabilityScore = Math.min(reliabilityScore, 40)
  if (concentrationPct !== null && concentrationPct > 60) reliabilityScore = Math.min(reliabilityScore, 30)
  if (livePriceCoverage < 0.5) reliabilityScore = Math.min(reliabilityScore, 45)
  reliabilityScore -= streaks.worstLosingStreak >= 15 ? 15 : 0
  reliabilityScore -= exposurePenalty
  reliabilityScore = clamp(reliabilityScore, 0, 100)

  const confidence = confidenceFromCount(sampleSize, livePriceCoverage)
  const hardFail = hardFailReasons.length > 0
  const watchEligible =
    !hardFail &&
    (
      reliabilityScore >= 50 ||
      (sampleSize >= 10 && (winRate !== null ? winRate >= 0.45 : realizedPnl >= 0)) ||
      (sampleSize >= 5 && realizedPnl !== null && realizedPnl >= 0 && streaks.currentLosingStreak < 5)
    )
  const copySignal: TraderReliability['copySignal'] = hardFail
    ? 'IGNORE'
    : reliabilityScore >= 75 && winRate !== null && winRate >= 0.45 && (realizedPnl === null || realizedPnl >= 0)
      ? 'COPY'
      : watchEligible
        ? 'WATCH'
        : 'IGNORE'
  const candidateTier: TraderReliability['candidateTier'] =
    copySignal === 'COPY' ? 'reliable' :
    copySignal === 'WATCH' ? 'watch' :
    'ignored'
  const reliabilityLabel =
    hardFailReasons.includes('Ignored: poor win rate') ? 'Ignored: poor win rate' :
    hardFailReasons.includes('Ignored: severe losing streak') ? 'Ignored: severe losing streak' :
    hardFailReasons.includes('Ignored: negative realized performance') ? 'Ignored: negative realized performance' :
    hardFailReasons.includes('Ignored: large open exposure with poor realized performance') ? 'High activity, weak history' :
    hardFailReasons.includes('Ignored: one big win risk') ? 'One big win risk' :
    livePriceCoverage < 0.5 ? 'Limited live price coverage' :
    copySignal === 'COPY' ? 'Reliable candidate' :
    copySignal === 'WATCH' ? 'Watch candidate' :
    openValue > 0 && (winRate ?? 0) < 0.45 ? 'High activity, weak history' :
    streaks.currentLosingStreak >= 5 ? 'Losing streak risk' :
    concentrationPct !== null && concentrationPct > 60 ? 'One big win risk' :
    'Active but unreliable'

  const reliabilityReasons = buildReliabilityReasons({
    sampleSize,
    resolvedPositions,
    winRate,
    realizedPnl,
    worstLosingStreak: streaks.worstLosingStreak,
    currentLosingStreak: streaks.currentLosingStreak,
    profitFactor,
    drawdownPct,
    concentrationPct,
    openValue,
    reliabilityScore,
    hardFailReasons,
    livePriceCoverage,
  })

  const isReliableCandidate = !hardFail &&
    (sampleSize >= 20 || resolvedPositions >= 10) &&
    reliabilityScore >= 75 &&
    copySignal === 'COPY' &&
    livePriceCoverage >= 0.5 &&
    (winRate ?? 0) >= 0.45 &&
    realizedPnl >= 0

  return {
    reliabilityScore: Math.round(reliabilityScore),
    copySignal,
    confidence,
    reliabilityLabel,
    reliabilityReasons,
    hardFailReasons,
    candidateTier,
    currentLosingStreak: streaks.currentLosingStreak,
    worstLosingStreak: streaks.worstLosingStreak,
    realizedPnl,
    openValue,
    totalPnl,
    winRate,
    profitFactor,
    drawdownPct,
    livePriceCoverage,
    winCount: wins,
    lossCount: losses,
    sampleSize,
    resolvedPositions,
    isReliableCandidate,
  }
}

type WatchRejectionCategory =
  | 'hard_fail'
  | 'too_little_history'
  | 'negative_pnl'
  | 'poor_win_rate'
  | 'severe_losing_streak'
  | 'weak_sample'
  | 'low_reliability'
  | 'no_promising_signal'
  | 'concentration_risk'

interface WatchlistEvaluation {
  eligible: boolean
  rejectionReason: string
  rejectionCategory: WatchRejectionCategory | null
}

function evaluateWatchlistCandidate(
  agg: HotWalletAgg,
  reliability: TraderReliability,
  timingEdgePct: number | null,
  marketsTraded: number,
): WatchlistEvaluation {
  const recentTrades = agg.trades.length
  const historicalTrades = reliability.sampleSize
  const livePricedTrades = reliability.winCount + reliability.lossCount
  const realizedPnl = reliability.realizedPnl
  const profitFactor = reliability.profitFactor

  const reject = (
    reason: string,
    category: WatchRejectionCategory,
  ): WatchlistEvaluation => ({ eligible: false, rejectionReason: reason, rejectionCategory: category })

  if (reliability.isReliableCandidate) {
    return { eligible: false, rejectionReason: 'Already copy-ready', rejectionCategory: null }
  }

  if (reliability.hardFailReasons.length > 0) {
    return reject(reliability.hardFailReasons[0], 'hard_fail')
  }

  if (realizedPnl !== null && realizedPnl < 0 && (profitFactor ?? 0) <= 1.1) {
    return reject('Negative realized PnL with weak profit factor', 'negative_pnl')
  }
  if (reliability.resolvedPositions < 10) {
    return reject('Too few closed positions (<10)', 'too_little_history')
  }
  if (recentTrades < 5) {
    return reject(`Too few recent trades (${recentTrades} < 5)`, 'weak_sample')
  }
  if (marketsTraded < 2) {
    return reject(`Too few unique markets (${marketsTraded} < 2)`, 'weak_sample')
  }
  if (reliability.winRate !== null && reliability.winRate < 0.45) {
    return reject(`Win rate below 45% (${(reliability.winRate * 100).toFixed(0)}%)`, 'poor_win_rate')
  }
  if (reliability.reliabilityScore < 55) {
    return reject(`Reliability too low (${reliability.reliabilityScore}/100)`, 'low_reliability')
  }
  if (reliability.currentLosingStreak >= 4) {
    return reject(`Current losing streak (${reliability.currentLosingStreak})`, 'severe_losing_streak')
  }
  if (reliability.worstLosingStreak >= 10) {
    return reject(`Worst losing streak (${reliability.worstLosingStreak})`, 'severe_losing_streak')
  }

  if (recentTrades < 10 && historicalTrades < 20) {
    return reject('Insufficient history (need 10+ recent or 20+ historical trades)', 'too_little_history')
  }
  if (marketsTraded < 3) {
    return reject(`Need 3+ unique markets (has ${marketsTraded})`, 'weak_sample')
  }
  if (realizedPnl !== null && realizedPnl < -50) {
    return reject(`Realized PnL too negative (${formatUSD(realizedPnl)})`, 'negative_pnl')
  }
  if (reliability.hardFailReasons.includes('Ignored: one big win risk')) {
    return reject('One lucky trade concentration risk', 'concentration_risk')
  }

  const noSevereFlags =
    reliability.currentLosingStreak < 4 &&
    reliability.worstLosingStreak < 10 &&
    (realizedPnl === null || realizedPnl >= -50)

  const hasPromisingSignal =
    (realizedPnl !== null && realizedPnl >= 500) ||
    (profitFactor !== null && profitFactor >= 1.25 && reliability.resolvedPositions >= 20) ||
    (reliability.winRate !== null && reliability.winRate >= 0.55 && reliability.resolvedPositions >= 20) ||
    (timingEdgePct !== null && timingEdgePct >= 58 && livePricedTrades >= 20) ||
    (agg.volume >= 5000 && noSevereFlags && (realizedPnl === null || realizedPnl >= 0))

  if (!hasPromisingSignal) {
    return reject('No promising performance signal met', 'no_promising_signal')
  }

  return { eligible: true, rejectionReason: '', rejectionCategory: null }
}

function buildRejectionBreakdown(entries: HotTraderEntry[]): Record<string, number> {
  const breakdown: Record<string, number> = {}
  for (const entry of entries) {
    if (!entry.rejectionReason) continue
    const category = categorizeRejectionReason(entry.rejectionReason)
    breakdown[category] = (breakdown[category] ?? 0) + 1
  }
  return breakdown
}

function categorizeRejectionReason(reason: string): string {
  const lower = reason.toLowerCase()
  if (lower.includes('win rate')) return 'poor_win_rate'
  if (lower.includes('pnl') || lower.includes('profit factor')) return 'negative_pnl'
  if (lower.includes('streak')) return 'severe_losing_streak'
  if (lower.includes('reliability')) return 'low_reliability'
  if (lower.includes('history') || lower.includes('closed position')) return 'too_little_history'
  if (lower.includes('recent trade') || lower.includes('market')) return 'weak_sample'
  if (lower.includes('concentration') || lower.includes('lucky')) return 'concentration_risk'
  if (lower.includes('promising') || lower.includes('signal')) return 'no_promising_signal'
  if (lower.startsWith('ignored:')) return 'hard_fail'
  return 'other'
}

function buildNearMisses(ignored: HotTraderEntry[], limit = 5): NearMissEntry[] {
  return [...ignored]
    .filter(entry => entry.rejectionReason)
    .sort((a, b) => b.reliabilityScore - a.reliabilityScore)
    .slice(0, limit)
    .map(entry => ({
      address: entry.address,
      label: entry.label,
      reliabilityScore: entry.reliabilityScore,
      winRate: entry.winRate,
      realizedPnl: entry.realizedPnl,
      tradeCount: Math.max(entry.recentTradeCount, entry.historicalTradeCount),
      rejectionReason: entry.rejectionReason ?? 'Did not meet watchlist gates',
    }))
}

function applyDiscoveryTier(
  entry: HotTraderEntry,
  agg: HotWalletAgg,
  reliability: TraderReliability,
  marketsTraded: number,
): HotTraderEntry {
  if (reliability.isReliableCandidate) {
    return {
      ...entry,
      candidateTier: 'reliable',
      copySignal: 'COPY',
      reliabilityLabel: 'Reliable candidate',
      isReliableCandidate: true,
    }
  }

  const watchEval = evaluateWatchlistCandidate(agg, reliability, entry.timingEdge, marketsTraded)

  if (watchEval.eligible) {
    return {
      ...entry,
      candidateTier: 'watch',
      copySignal: 'WATCH',
      reliabilityLabel: 'Watch candidate',
      isReliableCandidate: false,
    }
  }

  return {
    ...entry,
    candidateTier: 'ignored',
    copySignal: 'IGNORE',
    isReliableCandidate: false,
    rejectionReason: watchEval.rejectionReason || reliability.hardFailReasons[0] || 'Did not meet watchlist gates',
  }
}

function dedupeNormalizedTrades(trades: HotTradeNormalized[]): HotTradeNormalized[] {
  const deduped = new Map<string, HotTradeNormalized>()
  for (const trade of trades) {
    const key = [
      trade.address,
      trade.marketKey,
      trade.timestamp,
      trade.price.toFixed(4),
      trade.volumeUSDC.toFixed(2),
    ].join('|')
    if (!deduped.has(key)) deduped.set(key, trade)
  }
  return [...deduped.values()]
}

function describeScanSource(globalCount: number, marketCount: number, marketPools: number): string {
  const parts: string[] = []
  if (globalCount > 0) parts.push(`global trades (${globalCount})`)
  if (marketCount > 0) parts.push(`market trades (${marketCount} from ${marketPools} pools)`)
  if (parts.length === 0) return 'no trade sources'
  if (parts.length === 2) return `mixed: ${parts.join(' + ')}`
  return parts[0]
}

function buildEmptyReasons(
  summary: CopyDiscoverySummary,
  diagnostics: CopyDiscoveryDiagnostics,
): string[] {
  const reasons: string[] = []
  if (summary.reliableCandidates > 0 || summary.watchCandidates > 0) return reasons

  const breakdown = summary.rejectionBreakdown
  const breakdownLabels: Record<string, string> = {
    too_little_history: 'too little history',
    negative_pnl: 'negative PnL',
    poor_win_rate: 'poor win rate',
    severe_losing_streak: 'severe losing streak',
    weak_sample: 'weak sample size',
    low_reliability: 'low reliability score',
    no_promising_signal: 'no promising performance signal',
    concentration_risk: 'concentration risk',
    hard_fail: 'hard reliability failure',
    other: 'other gate failures',
  }

  for (const [key, count] of Object.entries(breakdown)) {
    if (count > 0) {
      const label = breakdownLabels[key] ?? key
      reasons.push(`${count} wallet${count === 1 ? '' : 's'} failed: ${label}`)
    }
  }

  if (summary.scannedTrades < 300) {
    reasons.push('Trade sample was small — try refreshing for a deeper scan.')
  }
  if (summary.apiNote) {
    reasons.push(summary.apiNote)
  }
  if (diagnostics.discardedReasons.below_volume_floor) {
    reasons.push('Many trades were below the minimum size filter.')
  }
  if (summary.enrichedWallets === 0 && summary.scannedWallets > 0) {
    reasons.push('No wallets were enriched with position data.')
  }
  if (reasons.length === 0) {
    reasons.push('No wallets met copy-ready or watchlist criteria — the market may lack strong candidates right now.')
  }
  return reasons
}

async function fetchAndRank(tokenIds: string[], minTrades = 1): Promise<{
  traders: TraderRankEntry[]
  allTrades: WalletTrade[]
  priceMap: Map<string, number>
}> {
  if (tokenIds.length === 0) return { traders: [], allTrades: [], priceMap: new Map() }

  const tradeSets = await Promise.allSettled(
    tokenIds.slice(0, 6).map(id => getMarketTrades(id, 200))
  )
  const allTrades: WalletTrade[] = tradeSets
    .filter((r): r is PromiseFulfilledResult<WalletTrade[]> => r.status === 'fulfilled')
    .flatMap(r => r.value.filter(t => t.type === 'TRADE' && (t.usdcSize ?? 0) >= 1))

  if (allTrades.length === 0) return { traders: [], allTrades: [], priceMap: new Map() }

  const uniqueAssets = [...new Set(allTrades.map(t => t.asset).filter(Boolean))].slice(0, 20)
  const priceMap = await batchFetchPrices(uniqueAssets)

  const walletMap = new Map<string, {
    trades: WalletTrade[]
    volume: number
    positive: number
    resolved: number
    markets: Set<string>
  }>()

  for (const trade of allTrades) {
    const addr = trade.proxyWallet
    if (!addr) continue
    if (!walletMap.has(addr)) {
      walletMap.set(addr, { trades: [], volume: 0, positive: 0, resolved: 0, markets: new Set() })
    }
    const w = walletMap.get(addr)!
    w.trades.push(trade)
    w.volume += trade.usdcSize ?? 0
    w.markets.add(trade.conditionId)

    const cur = priceMap.get(trade.asset)
    if (cur !== undefined && trade.price > 0) {
      const delta = trade.side === 'BUY' ? cur - trade.price : trade.price - cur
      w.resolved++
      if (delta > 0) w.positive++
    }
  }

  const traders = [...walletMap.entries()]
    .filter(([, w]) => w.trades.length >= minTrades)
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, 25)
    .map(([addr, w]): TraderRankEntry => {
      const sample = w.trades[0]
      return {
        address: addr,
        pseudonym: sample?.pseudonym ?? '',
        name: sample?.name ?? '',
        tradeCount: w.trades.length,
        totalVolumeUSDC: w.volume,
        avgTradeSize: w.volume / Math.max(w.trades.length, 1),
        timingScore: w.resolved > 0 ? w.positive / w.resolved : 0,
        positiveDelta: w.positive,
        totalResolved: w.resolved,
        pnl: null,
        winRate: null,
        marketsTraded: w.markets.size,
      }
    })

  return { traders, allTrades, priceMap }
}

function collectMarketLabels(trades: WalletTrade[]): string[] {
  const marketMap = new Map<string, { label: string; count: number; lastTs: number }>()
  for (const trade of trades) {
    const key = trade.conditionId
    const label = trade.title || trade.eventSlug || trade.slug || 'Unknown market'
    const current = marketMap.get(key)
    if (!current) {
      marketMap.set(key, { label, count: 1, lastTs: trade.timestamp })
    } else {
      current.count += 1
      current.lastTs = Math.max(current.lastTs, trade.timestamp)
    }
  }
  return [...marketMap.values()]
    .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs)
    .slice(0, 3)
    .map(item => item.label)
}

function buildHotReasons(entry: HotTraderEntry): string[] {
  const reasons: string[] = []
  reasons.push(`✓ ${entry.recentTradeCount} recent trade${entry.recentTradeCount === 1 ? '' : 's'}`)
  reasons.push(`✓ ${entry.marketsTraded} unique market${entry.marketsTraded === 1 ? '' : 's'}`)
  reasons.push(`✓ ${formatUSD(entry.recentVolumeUSDC)} recent volume`)
  reasons.push(`✓ Average trade ${formatUSD(entry.avgTradeSize)}`)
  if (entry.winRate !== null) reasons.push(`✓ ${(entry.winRate * 100).toFixed(0)}% win rate on resolved positions`)
  else reasons.push('• Win rate unavailable')
  if (entry.pnl !== null) reasons.push(`✓ ${entry.pnl >= 0 ? '+' : ''}${formatUSD(entry.pnl)} PnL`)
  else reasons.push('• PnL unavailable')
  return reasons.slice(0, 4)
}

function makeHotEntry(agg: HotWalletAgg, winRate: number | null, pnl: number | null): HotTraderEntry {
  const hotScore = computeHotScore(agg)
  const entry: HotTraderEntry = {
    address: agg.address,
    label: agg.pseudonym || agg.name || truncateAddress(agg.address),
    pseudonym: agg.pseudonym,
    name: agg.name,
    candidateTier: 'ignored',
    hotScore,
    reliabilityScore: 0,
    copySignal: 'IGNORE',
    confidence: 'Low',
    recentTradeCount: agg.trades.length,
    recentVolumeUSDC: agg.volume,
    avgTradeSize: agg.volume / Math.max(agg.trades.length, 1),
    marketsTraded: agg.markets.size,
    activeMarkets: collectMarketLabels(agg.trades),
    realizedPnl: null,
    openValue: null,
    totalPnl: null,
    resolvedPositions: 0,
    currentLosingStreak: 0,
    worstLosingStreak: 0,
    timingEdge: agg.resolvedMoves > 0 ? (agg.positiveMoves / agg.resolvedMoves) * 100 : null,
    pnl,
    winRate,
    reliabilityLabel: 'Active but unreliable',
    reliabilityReasons: [],
    scoreReasons: [],
    isReliableCandidate: false,
    historicalTradeCount: 0,
  }
  entry.scoreReasons = buildHotReasons(entry)
  return entry
}

function aggregateNormalizedTrades(trades: HotTradeNormalized[], countDiscard?: (reason: string) => void): Map<string, HotWalletAgg> {
  const walletMap = new Map<string, HotWalletAgg>()
  for (const trade of trades) {
    if (!trade.address) {
      countDiscard?.('missing_wallet')
      continue
    }
    if (trade.volumeUSDC < 1) {
      countDiscard?.('below_volume_floor')
      continue
    }
    if (!walletMap.has(trade.address)) {
      walletMap.set(trade.address, {
        address: trade.address,
        pseudonym: trade.walletLabel,
        name: trade.walletLabel,
        trades: [],
        volume: 0,
        markets: new Map(),
        positiveMoves: 0,
        resolvedMoves: 0,
      })
    }
    const agg = walletMap.get(trade.address)!
    const walletTrade: WalletTrade = {
      proxyWallet: trade.address,
      timestamp: trade.timestamp,
      conditionId: trade.marketKey,
      type: 'TRADE',
      size: trade.volumeUSDC,
      usdcSize: trade.volumeUSDC,
      price: trade.price,
      asset: trade.asset || trade.marketKey,
      side: trade.side,
      outcomeIndex: 0,
      title: trade.title,
      slug: trade.marketName,
      icon: '',
      eventSlug: trade.marketName,
      outcome: trade.side,
      name: trade.walletLabel,
      pseudonym: trade.walletLabel,
    }
    agg.trades.push(walletTrade)
    agg.volume += trade.volumeUSDC
    agg.markets.set(trade.marketKey, {
      label: trade.marketName,
      count: (agg.markets.get(trade.marketKey)?.count ?? 0) + 1,
      lastTs: trade.timestamp,
    })
  }
  return walletMap
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function uniqueEvents(events: PolyEvent[]): PolyEvent[] {
  const seen = new Set<string>()
  return events.filter(event => {
    if (seen.has(event.id)) return false
    seen.add(event.id)
    return true
  })
}

async function fetchGlobalTradeSample(
  limit = GLOBAL_TRADE_PAGE_SIZE,
  offset = 0,
): Promise<{ normalized: HotTradeNormalized[]; rawCount: number; rawSamples: unknown[]; status: number | null; contentType: string | null }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  const res = await fetch(`${DISCOVERY_TRADES_BASE}?${params}`)
  const contentType = res.headers.get('content-type')
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text
  }
  const rawTrades = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? Object.values(parsed as Record<string, unknown>)
      : []
  const normalized = rawTrades
    .map(normalizeRawTrade)
    .filter((trade): trade is HotTradeNormalized => trade !== null)
  return {
    normalized,
    rawCount: rawTrades.length,
    rawSamples: rawTrades.slice(0, 3),
    status: res.status,
    contentType,
  }
}

async function fetchGlobalTradePages(
  pages: number,
  startPage = 0,
): Promise<{ normalized: HotTradeNormalized[]; rawCount: number; rawSamples: unknown[]; status: number | null; contentType: string | null }> {
  const settled = await Promise.allSettled(
    Array.from({ length: pages }, (_, i) =>
      fetchGlobalTradeSample(GLOBAL_TRADE_PAGE_SIZE, (startPage + i) * GLOBAL_TRADE_PAGE_SIZE),
    ),
  )

  const fulfilled = settled.filter(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchGlobalTradeSample>>> =>
      result.status === 'fulfilled',
  )

  const normalized = fulfilled.flatMap(result => result.value.normalized)
  const rawCount = fulfilled.reduce((sum, result) => sum + result.value.rawCount, 0)
  const first = fulfilled[0]?.value

  return {
    normalized,
    rawCount,
    rawSamples: first?.rawSamples ?? [],
    status: first?.status ?? null,
    contentType: first?.contentType ?? null,
  }
}

async function fetchDiscoveryMarketEvents(): Promise<PolyEvent[]> {
  const settled = await Promise.allSettled([
    fetchTrending(12),
    ...DISCOVERY_TERMS.map(term => searchEvents(term)),
  ])

  const events = settled
    .filter((result): result is PromiseFulfilledResult<PolyEvent[]> => result.status === 'fulfilled')
    .flatMap(result => result.value)

  const unique = uniqueEvents(events)
  return unique
    .sort((a, b) => (toFiniteNumber(b.volume24hr ?? b.volume, 0) - toFiniteNumber(a.volume24hr ?? a.volume, 0)))
    .slice(0, 24)
}

async function fetchDiscoveryMarketTrades(events: PolyEvent[], limitPerMarket = 80, maxMarkets = 20): Promise<{ normalized: HotTradeNormalized[]; rawCount: number }> {
  const tokenIds = uniqueStrings(events.flatMap(extractTokenIdsFromEvent)).slice(0, maxMarkets)
  const settled = await Promise.allSettled(
    tokenIds.map(tokenId => getMarketTrades(tokenId, limitPerMarket))
  )

  const trades = settled
    .filter((result): result is PromiseFulfilledResult<WalletTrade[]> => result.status === 'fulfilled')
    .flatMap(result => result.value)
    .filter(trade => trade.type === 'TRADE')

  const normalized = trades
    .map(trade => normalizeRawTrade({
      proxyWallet: trade.proxyWallet,
      wallet: trade.proxyWallet,
      user: trade.proxyWallet,
      maker: trade.proxyWallet,
      taker: trade.proxyWallet,
      owner: trade.proxyWallet,
      usdcSize: trade.usdcSize ?? trade.size,
      sizeUsd: trade.usdcSize ?? trade.size,
      size: trade.size,
      amount: trade.usdcSize ?? trade.size,
      volume: trade.usdcSize ?? trade.size,
      price: trade.price,
      outcomePrice: trade.price,
      entryPrice: trade.price,
      timestamp: trade.timestamp,
      createdAt: trade.timestamp,
      tradeTime: trade.timestamp,
      time: trade.timestamp,
      title: trade.title,
      marketQuestion: trade.title,
      question: trade.title,
      market: trade.slug,
      marketSlug: trade.slug,
      slug: trade.slug,
      eventSlug: trade.eventSlug,
      conditionId: trade.conditionId,
      marketId: trade.conditionId,
      tokenId: trade.asset,
      asset: trade.asset,
      side: trade.side,
      pseudonym: trade.pseudonym,
      name: trade.name,
      label: trade.pseudonym,
    }))
    .filter((trade): trade is HotTradeNormalized => trade !== null)

  return {
    normalized,
    rawCount: trades.length,
  }
}

async function enrichTraderReliability(aggregates: HotWalletAgg[], maxEnrich = MAX_ENRICH_WALLETS): Promise<HotTraderEntry[]> {
  const toEnrich = aggregates.slice(0, maxEnrich)
  const rest = aggregates.slice(maxEnrich).map(agg => makeHotEntry(agg, null, null))

  const enriched = await Promise.allSettled(
    toEnrich.map(async agg => {
      try {
        const [positions, activity] = await Promise.all([
          getWalletPositions(agg.address, 100),
          getWalletActivity(agg.address, 200),
        ])
        const tradesForAnalysis =
          activity.filter(t => t.type === 'TRADE' && (t.usdcSize ?? 0) >= 1).length >= 2
            ? activity.filter(t => t.type === 'TRADE' && (t.usdcSize ?? 0) >= 1)
            : agg.trades

        const historicalMarkets = new Set(tradesForAnalysis.map(t => t.conditionId).filter(Boolean)).size
        const marketsTraded = Math.max(agg.markets.size, historicalMarkets)

        const assets = [...new Set([
          ...tradesForAnalysis.map(t => t.asset),
          ...agg.trades.map(t => t.asset),
        ].filter(Boolean))].slice(0, 24)
        const priceMap = await batchFetchPrices(assets)

        let positiveMoves = 0
        let resolvedMoves = 0
        for (const trade of agg.trades) {
          const cur = priceMap.get(trade.asset)
          if (cur === undefined || !trade.price || trade.price <= 0) continue
          const delta = trade.side === 'BUY' ? cur - trade.price : trade.price - cur
          resolvedMoves += 1
          if (delta > 0) positiveMoves += 1
        }
        agg.positiveMoves = positiveMoves
        agg.resolvedMoves = resolvedMoves

        const entry = makeHotEntry(
          agg,
          null,
          positions.reduce((sum, pos) => sum + toFiniteNumber(pos.cashPnl, 0), 0),
        )

        const reliability = analyzeTraderReliability(tradesForAnalysis, positions, priceMap)
        const merged = {
          ...entry,
          marketsTraded,
          historicalTradeCount: reliability.sampleSize,
          reliabilityScore: reliability.reliabilityScore,
          copySignal: reliability.copySignal,
          confidence: reliability.confidence,
          realizedPnl: reliability.realizedPnl,
          openValue: reliability.openValue,
          totalPnl: reliability.totalPnl,
          resolvedPositions: reliability.resolvedPositions,
          currentLosingStreak: reliability.currentLosingStreak,
          worstLosingStreak: reliability.worstLosingStreak,
          winRate: reliability.winRate,
          pnl: reliability.totalPnl,
          reliabilityLabel: reliability.reliabilityLabel,
          reliabilityReasons: reliability.reliabilityReasons,
          isReliableCandidate: reliability.isReliableCandidate,
          candidateTier: reliability.candidateTier,
        }
        return applyDiscoveryTier(merged, agg, reliability, marketsTraded)
      } catch {
        return makeHotEntry(agg, null, null)
      }
    })
  )

  return enriched.map((result, i) => result.status === 'fulfilled' ? result.value : makeHotEntry(toEnrich[i], null, null)).concat(rest)
}

export async function fetchHotTraders(limit = 8): Promise<HotTraderLoadResult> {
  const key = `hot-traders:v2:${limit}`
  const cached = cacheGet<HotTraderLoadResult>(key, TTL.hotTraders)
  if (cached !== null) return cached

  const diagnostics: HotTraderDiagnostics = {
    endpoint: HOT_TRADES_ENDPOINT,
    status: null,
    rawType: 'unknown',
    contentType: null,
    rawTradeCount: 0,
    rawSamples: [],
    normalizedTradeCount: 0,
    walletGroupCount: 0,
    finalHotTraderCount: 0,
    discardedReasons: {},
  }

  const countDiscard = (reason: string) => {
    diagnostics.discardedReasons[reason] = (diagnostics.discardedReasons[reason] ?? 0) + 1
  }

  try {
    const res = await fetch(HOT_TRADES_ENDPOINT)
    diagnostics.status = res.status
    diagnostics.contentType = res.headers.get('content-type')
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
    diagnostics.rawType = Array.isArray(parsed) ? 'array' : typeof parsed
    const rawTrades = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? Object.values(parsed as Record<string, unknown>)
        : []
    diagnostics.rawTradeCount = rawTrades.length
    diagnostics.rawSamples = rawTrades.slice(0, 3)

    devLog('raw feed', {
      endpoint: diagnostics.endpoint,
      status: diagnostics.status,
      rawType: diagnostics.rawType,
      contentType: diagnostics.contentType,
      rawTradeCount: diagnostics.rawTradeCount,
      rawSamples: diagnostics.rawSamples,
    })

    if (!res.ok) {
      const result: HotTraderLoadResult = {
        state: 'error',
        message: 'Could not load hot traders',
        traders: [],
        diagnostics,
      }
      return result
    }

    if (rawTrades.length === 0) {
      const result: HotTraderLoadResult = {
        state: 'no-trades',
        message: 'No recent public trades returned',
        traders: [],
        diagnostics,
      }
      cacheSet(key, result)
      return result
    }

    const normalized = rawTrades
      .map(normalizeRawTrade)
      .filter((trade): trade is HotTradeNormalized => trade !== null)
    diagnostics.normalizedTradeCount = normalized.length

    const filtered = normalized.filter(trade => {
      if (!trade.address) {
        countDiscard('missing_wallet')
        return false
      }
      if (trade.volumeUSDC < 1) {
        countDiscard('below_volume_floor')
        return false
      }
      return true
    })

    const walletMap = aggregateNormalizedTrades(filtered, countDiscard)

    diagnostics.walletGroupCount = walletMap.size

    if (walletMap.size === 0) {
      const result: HotTraderLoadResult = {
        state: 'filtered-out',
        message: 'Trades found, but none passed filters',
        traders: [],
        diagnostics,
      }
      cacheSet(key, result)
      devLog('filtered out all trades', diagnostics)
      return result
    }

    const prequalified = [...walletMap.values()]
      .filter(agg => agg.trades.length >= 1 && agg.volume >= 1 && agg.markets.size >= 1)
      .sort((a, b) => {
        const aScore = computeHotScore(a)
        const bScore = computeHotScore(b)
        return bScore - aScore
      })
      .slice(0, Math.max(limit * 2, 12))

    const assets = [...new Set(prequalified.flatMap(agg => agg.trades.map(t => t.asset)).filter(Boolean))].slice(0, 24)
    const priceMap = await batchFetchPrices(assets)

    for (const agg of prequalified) {
      for (const trade of agg.trades) {
        const cur = priceMap.get(trade.asset)
        if (cur === undefined || !trade.price || trade.price <= 0) continue
        const delta = trade.side === 'BUY' ? cur - trade.price : trade.price - cur
        agg.resolvedMoves += 1
        if (delta > 0) agg.positiveMoves += 1
      }
    }

    const ranked = prequalified
      .map(agg => makeHotEntry(agg, null, null))
      .sort((a, b) => b.hotScore - a.hotScore)
      .slice(0, limit)

    let final = ranked
    try {
      final = sortHotTraderEntries(await enrichTraderReliability(prequalified, limit)).slice(0, limit)
    } catch {
      final = ranked
    }

    diagnostics.finalHotTraderCount = final.length
    const result: HotTraderLoadResult = {
      state: final.length > 0 ? 'ok' : 'filtered-out',
      message: final.length > 0 ? 'Hot traders loaded' : 'Trades found, but none passed filters',
      traders: final,
      diagnostics,
    }
    cacheSet(key, result)
    devLog('final hot traders', diagnostics)
    return result
    } catch (error) {
    const result: HotTraderLoadResult = {
      state: 'error',
      message: error instanceof Error ? error.message : 'Could not load hot traders',
      traders: [],
      diagnostics,
    }
    devLog('hot traders error', { error, diagnostics })
    return result
  }
}

function sortHotTraderEntries(entries: HotTraderEntry[]): HotTraderEntry[] {
  return [...entries].sort((a, b) => {
    const candidateOrder = { reliable: 0, watch: 1, ignored: 2 } as const
    const tierDelta = candidateOrder[a.candidateTier] - candidateOrder[b.candidateTier]
    if (tierDelta !== 0) return tierDelta
    const reliabilityDelta = b.reliabilityScore - a.reliabilityScore
    if (reliabilityDelta !== 0) return reliabilityDelta
    return b.hotScore - a.hotScore
  })
}

export async function discoverCopyCandidates(limit = 8): Promise<CopyDiscoveryResult> {
  const key = `copy-discovery:v4:${limit}`
  const cached = cacheGet<CopyDiscoveryResult>(key, TTL.discovery)
  if (cached !== null) return cached

  const diagnostics: CopyDiscoveryDiagnostics = {
    endpoint: DISCOVERY_TRADES_BASE,
    status: null,
    rawType: 'unknown',
    contentType: null,
    rawTradeCount: 0,
    rawSamples: [],
    normalizedTradeCount: 0,
    walletGroupCount: 0,
    finalHotTraderCount: 0,
    discardedReasons: {},
    sourceBreakdown: {},
    marketPoolsScanned: 0,
    candidateWallets: 0,
    enrichedWallets: 0,
    reliableCandidates: 0,
    watchCandidates: 0,
    ignoredActiveTraders: 0,
  }

  const countSource = (source: string, count: number) => {
    diagnostics.sourceBreakdown[source] = (diagnostics.sourceBreakdown[source] ?? 0) + count
  }

  const runDiscoveryPass = async (
    globalPages: number,
    globalStartPage: number,
    marketLimitPerPool: number,
    maxMarketPools: number,
  ) => {
    const globalSample = await fetchGlobalTradePages(globalPages, globalStartPage)
    const events = await fetchDiscoveryMarketEvents()
    diagnostics.marketPoolsScanned = Math.max(diagnostics.marketPoolsScanned, events.length)
    const marketSample = await fetchDiscoveryMarketTrades(events, marketLimitPerPool, maxMarketPools)
    return { globalSample, marketSample, events }
  }

  try {
    let globalPagesFetched = INITIAL_GLOBAL_PAGES
    const { globalSample, marketSample } = await runDiscoveryPass(INITIAL_GLOBAL_PAGES, 0, 100, 28)

    diagnostics.status = globalSample.status
    diagnostics.contentType = globalSample.contentType
    diagnostics.rawType = 'array'
    diagnostics.rawSamples = globalSample.rawSamples
    countSource('global', globalSample.normalized.length)
    countSource('markets', marketSample.normalized.length)

    let normalized = [...globalSample.normalized, ...marketSample.normalized]
    let dedupedTrades = dedupeNormalizedTrades(normalized)
    let walletMap = aggregateNormalizedTrades(dedupedTrades, () => {})

    const enrichAndClassify = async () => {
      const candidateAggs = [...walletMap.values()]
        .filter(agg => agg.trades.length >= 1 && agg.volume >= 1)
        .sort((a, b) => computeHotScore(b) - computeHotScore(a))
        .slice(0, MAX_CANDIDATE_WALLETS)

      diagnostics.candidateWallets = candidateAggs.length
      const enriched = await enrichTraderReliability(candidateAggs, MAX_ENRICH_WALLETS)
      diagnostics.enrichedWallets = Math.min(candidateAggs.length, MAX_ENRICH_WALLETS)

      const reliable = enriched.filter(entry => entry.candidateTier === 'reliable')
      const watchlist = enriched.filter(entry => entry.candidateTier === 'watch')
      const ignored = enriched.filter(entry => entry.candidateTier === 'ignored')

      return { reliable, watchlist, ignored, enriched }
    }

    let { reliable, watchlist, ignored } = await enrichAndClassify()

    if (reliable.length === 0 && watchlist.length === 0) {
      const deepGlobal = await fetchGlobalTradePages(DEEP_SCAN_EXTRA_PAGES, globalPagesFetched)
      globalPagesFetched += DEEP_SCAN_EXTRA_PAGES
      countSource('global-deep', deepGlobal.normalized.length)
      normalized = [...normalized, ...deepGlobal.normalized]
      dedupedTrades = dedupeNormalizedTrades(normalized)
      walletMap = aggregateNormalizedTrades(dedupedTrades, () => {})
      const deepMarket = await fetchDiscoveryMarketTrades(
        await fetchDiscoveryMarketEvents(),
        120,
        36,
      )
      countSource('markets-deep', deepMarket.normalized.length)
      normalized = [...normalized, ...deepMarket.normalized]
      dedupedTrades = dedupeNormalizedTrades(normalized)
      walletMap = aggregateNormalizedTrades(dedupedTrades, () => {})
      ;({ reliable, watchlist, ignored } = await enrichAndClassify())
    }

    diagnostics.rawTradeCount = normalized.length
    diagnostics.normalizedTradeCount = dedupedTrades.length
    diagnostics.walletGroupCount = walletMap.size

    if (walletMap.size === 0) {
      const apiNote = `Polymarket API returns up to ${GLOBAL_TRADE_PAGE_SIZE} trades per request; scanned ${globalPagesFetched} global page(s).`
      const summary: CopyDiscoverySummary = {
        scannedTrades: normalized.length,
        uniqueTrades: dedupedTrades.length,
        scannedWallets: 0,
        enrichedWallets: 0,
        reliableCandidates: 0,
        watchCandidates: 0,
        ignoredActiveTraders: 0,
        scanSource: describeScanSource(globalSample.normalized.length, marketSample.normalized.length, diagnostics.marketPoolsScanned),
        apiNote,
        emptyReasons: ['No wallets appeared in the trade sample.'],
        rejectionBreakdown: {},
      }
      const result: CopyDiscoveryResult = {
        state: 'empty',
        message: 'No strong copy candidates found in this scan.',
        reliable: [],
        watchlist: [],
        ignored: [],
        nearMisses: [],
        summary,
        diagnostics,
      }
      cacheSet(key, result)
      return result
    }

    const reliableSorted = sortHotTraderEntries(reliable).slice(0, limit)
    const watchSorted = sortHotTraderEntries(watchlist).slice(0, limit)
    const ignoredSortedAll = sortHotTraderEntries(ignored)
    const nearMisses = buildNearMisses(ignoredSortedAll, 5)
    const rejectionBreakdown = buildRejectionBreakdown(ignoredSortedAll)

    diagnostics.reliableCandidates = reliableSorted.length
    diagnostics.watchCandidates = watchSorted.length
    diagnostics.ignoredActiveTraders = ignoredSortedAll.length
    diagnostics.finalHotTraderCount = reliableSorted.length + watchSorted.length + ignoredSortedAll.length

    const hasReliable = reliableSorted.length > 0
    const hasWatch = watchSorted.length > 0
    const globalTradeCount = diagnostics.sourceBreakdown.global ?? 0
    const marketTradeCount =
      (diagnostics.sourceBreakdown.markets ?? 0) +
      (diagnostics.sourceBreakdown['markets-deep'] ?? 0)
    const apiNote =
      globalPagesFetched >= INITIAL_GLOBAL_PAGES + DEEP_SCAN_EXTRA_PAGES
        ? `Deep scan ran (${globalPagesFetched} global pages × ${GLOBAL_TRADE_PAGE_SIZE} trades/page). API caps each request at ${GLOBAL_TRADE_PAGE_SIZE} trades.`
        : globalPagesFetched > 1
          ? `Scanned ${globalPagesFetched} global pages (${GLOBAL_TRADE_PAGE_SIZE} trades/page max per request).`
          : null

    const summary: CopyDiscoverySummary = {
      scannedTrades: normalized.length,
      uniqueTrades: dedupedTrades.length,
      scannedWallets: diagnostics.walletGroupCount,
      enrichedWallets: diagnostics.enrichedWallets,
      reliableCandidates: diagnostics.reliableCandidates,
      watchCandidates: diagnostics.watchCandidates,
      ignoredActiveTraders: diagnostics.ignoredActiveTraders,
      scanSource: describeScanSource(globalTradeCount, marketTradeCount, diagnostics.marketPoolsScanned),
      apiNote,
      emptyReasons: [],
      rejectionBreakdown,
    }
    summary.emptyReasons = buildEmptyReasons(summary, diagnostics)

    const result: CopyDiscoveryResult = {
      state: hasReliable || hasWatch ? 'ok' : 'empty',
      message: hasReliable
        ? 'Copy-ready wallets found.'
        : hasWatch
          ? 'Watchlist candidates found — promising but not copy-ready yet.'
          : 'No strong copy candidates found in this scan.',
      reliable: reliableSorted,
      watchlist: watchSorted,
      ignored: [],
      nearMisses,
      summary,
      diagnostics,
    }
    cacheSet(key, result)
    devLog('copy discovery complete', diagnostics)
    return result
  } catch (error) {
    const summary: CopyDiscoverySummary = {
      scannedTrades: diagnostics.rawTradeCount,
      uniqueTrades: diagnostics.normalizedTradeCount,
      scannedWallets: diagnostics.walletGroupCount,
      enrichedWallets: diagnostics.enrichedWallets,
      reliableCandidates: diagnostics.reliableCandidates,
      watchCandidates: diagnostics.watchCandidates,
      ignoredActiveTraders: diagnostics.ignoredActiveTraders,
      scanSource: 'unknown',
      apiNote: null,
      emptyReasons: ['Scan failed before completion.'],
      rejectionBreakdown: {},
    }
    const result: CopyDiscoveryResult = {
      state: 'error',
      message: error instanceof Error ? error.message : 'Could not load candidate discovery',
      reliable: [],
      watchlist: [],
      ignored: [],
      nearMisses: [],
      summary,
      diagnostics,
    }
    devLog('copy discovery error', { error, diagnostics })
    return result
  }
}

export async function fetchReliableCopyCandidates(limit = 8): Promise<HotTraderLoadResult> {
  const key = `reliable-traders:v1:${limit}`
  const cached = cacheGet<HotTraderLoadResult>(key, TTL.hotTraders)
  if (cached !== null) return cached

  const universe = await fetchHotTraders(24)
  if (universe.state === 'error' || universe.traders.length === 0) {
    const result: HotTraderLoadResult = {
      state: universe.state,
      message: universe.message,
      traders: [],
      diagnostics: universe.diagnostics,
    }
    cacheSet(key, result)
    return result
  }

  const filtered = universe.traders
    .filter(entry => entry.isReliableCandidate)
    .sort((a, b) => {
      const scoreDelta = b.reliabilityScore - a.reliabilityScore
      if (scoreDelta !== 0) return scoreDelta
      return b.hotScore - a.hotScore
    })
    .slice(0, limit)

  const result: HotTraderLoadResult = {
    state: filtered.length > 0 ? 'ok' : 'filtered-out',
    message: filtered.length > 0
      ? 'Reliable candidates loaded'
      : 'No reliable copy candidates found yet. Showing active traders below.',
    traders: filtered,
    diagnostics: {
      ...universe.diagnostics,
      finalHotTraderCount: filtered.length,
    },
  }
  cacheSet(key, result)
  return result
}

// ─── Public exports ────────────────────────────────────────────────────────

// Category-level ranking (for discovery page Traders tab)
export async function rankTradersForEvents(events: PolyEvent[]): Promise<TraderRankEntry[]> {
  const tokenIds: string[] = []
  for (const ev of events.slice(0, 4)) {
    const m = ev.markets?.[0]
    if (!m?.clobTokenIds) continue
    try {
      const ids: string[] = JSON.parse(m.clobTokenIds)
      if (ids[0]) tokenIds.push(ids[0])
    } catch { /* skip */ }
  }
  const { traders } = await fetchAndRank(tokenIds)
  return traders
}

// Single-market intelligence (for Market Detail page — auto-loaded)
export async function rankTradersForMarket(event: PolyEvent): Promise<MarketIntelligence> {
  const tokenIds: string[] = []
  for (const m of (event.markets ?? []).slice(0, 3)) {
    if (!m.clobTokenIds) continue
    try {
      const ids: string[] = JSON.parse(m.clobTokenIds)
      tokenIds.push(...ids.slice(0, 2)) // include both outcome tokens
    } catch { /* skip */ }
  }

  const { traders, allTrades, priceMap } = await fetchAndRank(tokenIds, 2) // require ≥2 trades
  const bestTrades = findBestTrades(allTrades, priceMap, 10)

  return { traders, bestTrades, totalTrades: allTrades.length }
}

// Best entries in a market: trades where price moved most in the wallet's direction
export function findBestTrades(
  trades: WalletTrade[],
  priceMap: Map<string, number>,
  limit = 10,
): BestTrade[] {
  const result: BestTrade[] = []

  for (const t of trades) {
    const cur = priceMap.get(t.asset)
    if (cur === undefined || !t.price || t.price <= 0) continue

    const delta = t.side === 'BUY' ? cur - t.price : t.price - cur
    if (delta <= 0) continue // only favorable moves

    const profitMultiple = t.side === 'BUY' ? cur / t.price : t.price / cur

    result.push({
      address: t.proxyWallet,
      pseudonym: t.pseudonym,
      name: t.name,
      side: t.side,
      outcome: t.outcome,
      entryPrice: t.price,
      currentPrice: cur,
      delta,
      profitMultiple,
      sizeUSDC: t.usdcSize ?? 0,
      timestamp: t.timestamp,
      title: t.title,
      conditionId: t.conditionId,
      asset: t.asset,
    })
  }

  return result.sort((a, b) => b.delta - a.delta).slice(0, limit)
}

// Enrich top N traders with PnL/win rate from positions API
export async function enrichWithPnL(entries: TraderRankEntry[], topN = 5): Promise<TraderRankEntry[]> {
  const toEnrich = entries.slice(0, topN)
  const rest = entries.slice(topN)

  const enriched = await Promise.allSettled(
    toEnrich.map(async (e, idx) => {
      try {
        const positions = await getWalletPositions(e.address, 100)
        const withVal = positions.filter(p => (p.initialValue ?? 0) > 0)
        const pnl = withVal.reduce((s, p) => s + (p.cashPnl ?? 0), 0)
        const winners = withVal.filter(p => (p.cashPnl ?? 0) >= 0).length
        const winRate = withVal.length > 0 ? winners / withVal.length : null
        return { ...e, pnl, winRate }
      } catch {
        return toEnrich[idx]
      }
    })
  )

  return [
    ...enriched.map((r, i) => r.status === 'fulfilled' ? r.value : toEnrich[i]),
    ...rest,
  ]
}
