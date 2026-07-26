import type { CopySettings } from "./types";

export type CopySignal = {
  walletId: string; tokenMint: string; symbol: string; sourcePrice: number; currentPrice: number;
  detectedAfterSeconds: number; liquidityUsd: number; marketCapUsd: number; riskPassed: boolean;
};

export function evaluateCopySignal(signal: CopySignal, settings: CopySettings, state: {
  openPositions: number; spentTodayUsd: number; alreadyHolding: boolean; walletEnabled: boolean; favorite: boolean;
}) {
  if (!settings.enabled || !state.walletEnabled) return { accepted:false, reason:"コピー対象外" };
  if (!signal.riskPassed) return { accepted:false, reason:"危険トークン" };
  if (signal.liquidityUsd < settings.minLiquidity) return { accepted:false, reason:"流動性不足" };
  if (signal.marketCapUsd < settings.minMarketCap) return { accepted:false, reason:"最低時価総額未満" };
  if (signal.detectedAfterSeconds > settings.maxDetectionSeconds) return { accepted:false, reason:"検知遅延超過" };
  if (state.openPositions >= settings.maxPositions) return { accepted:false, reason:"最大保有数到達" };
  if (state.spentTodayUsd + settings.amountPerTrade > settings.maxDailyAmount) return { accepted:false, reason:"1日上限到達" };
  if (state.alreadyHolding && !settings.allowDuplicate) return { accepted:false, reason:"重複購入不可" };
  if (settings.favoritesOnly && !state.favorite) return { accepted:false, reason:"お気に入り対象外" };
  const rise = ((signal.currentPrice - signal.sourcePrice) / signal.sourcePrice) * 100;
  if (rise >= settings.maxPriceRise) return { accepted:false, reason:"価格上昇済み" };
  return { accepted:true, reason:null, fillPrice:signal.currentPrice, amountUsd:settings.amountPerTrade };
}

export function calculatePaperPnl(entryPrice: number, exitPrice: number, amountUsd: number) {
  const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
  return { pnlPct, pnlUsd: amountUsd * pnlPct / 100 };
}
