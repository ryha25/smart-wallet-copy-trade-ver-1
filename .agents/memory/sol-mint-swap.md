---
name: SOL-based live swaps
description: Copy trading uses SOL (not USDC) as input/output mint for all Jupiter swaps
---

# Live trading uses SOL not USDC

## Rule
All Jupiter Ultra swaps in copy-monitor use `SOL_MINT` (`So11111111111111111111111111111111111111112`) as inputMint (buy) and outputMint (sell), NOT `USDC_MINT`.

**Why:** pump.fun tokens only have SOL pairs. Routing via USDC → pump.fun token caused `Failed to get quotes (HTTP 400)` from Jupiter, silently skipping every copy trade.

## How to apply
- Buy: `inputMint: SOL_MINT`, `inputAmount = (amountPerTrade / solPriceUsd) * 1e9` (lamports, 9 decimals)
- Sell: `outputMint: SOL_MINT`, `proceedsUsd = outputAmount / 1e9 * solPriceUsd`
- SOL price fetched via `getSolPriceUsd()` which calls `getTokenQuotes([SOL_MINT])` from DexScreener
- `SOL_MINT` exported from `live-trading.ts`; `getSolPriceUsd()` is a module-private function in `copy-monitor.ts`

## Files changed
- `artifacts/api-server/src/services/live-trading.ts` — added `SOL_MINT` export
- `artifacts/api-server/src/services/copy-monitor.ts` — processBuy, settlePositionById, reconcileLivePositionBalances
- `app/services/live-trading.ts` — added `SOL_MINT` export
- `app/services/copy-monitor.ts` — processBuy, settlePositionById, partial sell, limitBuy
