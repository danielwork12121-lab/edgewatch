import type { PricePoint } from '../types'

const CLOB = 'https://clob.polymarket.com'

// Fetch full price history for a CLOB token (outcome-specific).
// Returns array of {t: unixTimestamp, p: price 0-1} sorted by time.
export async function fetchPriceHistory(tokenId: string): Promise<PricePoint[]> {
  try {
    const res = await fetch(
      `${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}&interval=max&fidelity=60`
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.history ?? []) as PricePoint[]
  } catch {
    return []
  }
}

// Compute copy signal confidence for a single trade.
//
// Formula:
//   confidence = traderEdge × timingFactor × marketStrength × sizeFactor
//
// traderEdge:     overall EdgeScore / 100 (0-1)
// timingFactor:   timingScore of the wallet (% favorable entries, 0-1)
// marketStrength: log10(liquidity+1) / 7  (normalized; $10M liq ≈ 1.0)
// sizeFactor:     min(1, usdcSize / 100)  (conviction proxy; $100 = max)
//
// Output: allocation percentage (0-10%), capped conservatively.
export function computeCopySignal(
  traderEdge: number,       // 0-100
  timingScore: number,      // 0-1
  liquidityUSDC: number,
  tradeSizeUSDC: number,
): { confidence: number; allocationPct: number; label: string } {
  const traderFactor = traderEdge / 100
  const timingFactor = timingScore
  const marketStrength = Math.min(1, Math.log10(liquidityUSDC + 1) / 7)
  const sizeFactor = Math.min(1, tradeSizeUSDC / 100)

  const confidence = traderFactor * timingFactor * marketStrength * sizeFactor
  const allocationPct = confidence * 10  // max 10% of paper balance per trade

  let label = 'Weak'
  if (confidence >= 0.4) label = 'Strong'
  else if (confidence >= 0.2) label = 'Moderate'
  else if (confidence >= 0.1) label = 'Mild'

  return { confidence, allocationPct, label }
}
