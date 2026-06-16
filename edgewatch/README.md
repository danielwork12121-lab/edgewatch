# EdgeWatch

Polymarket intelligence dashboard — discover markets, identify early-signal wallets, and simulate following behavior.

## What it does

- **Market Discovery** — search Polymarket markets by keyword, see probability, volume, liquidity, close date
- **Market Detail** — view outcome probability bars, sub-markets, and recent traders
- **Wallet Intelligence** — inspect any wallet's full trade history, open positions, and PnL
- **EdgeScore** — size-weighted CLV approximation + repeatability score with confidence level
- **Paper Portfolio** — simulate following wallet trades with no real money, no wallet connection
- **Watchlist** — watch wallets and markets; revisit from a central hub

## What it does NOT do

- No trading execution
- No order placement
- No wallet authentication or private keys
- No financial advice
- All "estimated" values are clearly labeled

## Run locally

```bash
cd edgewatch
npm install
npm run dev
```

Open `http://localhost:5173`

## Build

```bash
npm run build
```

## Data sources

| Data | Source | Label in UI |
|------|--------|-------------|
| Markets, events | Polymarket Gamma API (public) | Real |
| Wallet trades | Polymarket Data API (public) | Real |
| Wallet positions & PnL | Polymarket Data API (public) | Real |
| EdgeScore, CLV | Derived from above | Estimated |
| Paper portfolio | localStorage, no real funds | Simulated |

## Stack

- Vite + React 19 + TypeScript
- No router dependency — state-based navigation
- No external UI library — custom CSS with dark mode
- localStorage for watchlist and paper portfolio persistence
