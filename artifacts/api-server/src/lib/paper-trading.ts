import type { CopySettings } from "./types";

export type CopySignal = {
  sourcePrice: number | null;
  currentPrice: number;
  detectedAfterSeconds: number;
};

export function evaluateCopySignal(
  signal: CopySignal,
  settings: CopySettings,
  state: { openPositions: number; spentTodayUsd: number; alreadyHolding: boolean; walletEnabled: boolean },
) {
  if (!settings.enabled || !state.walletEnabled) return { accepted: false, reason: "コピー対象外" };
  if (signal.detectedAfterSeconds > settings.maxDetectionSeconds) return { accepted: false, reason: "検知遅延超過" };
  if (state.openPositions >= settings.maxPositions) return { accepted: false, reason: "最大保有数到達" };
  if (state.spentTodayUsd + settings.amountPerTrade > settings.maxDailyAmount) return { accepted: false, reason: "1日上限到達" };
  if (state.alreadyHolding && !settings.allowDuplicate) return { accepted: false, reason: "同一コイン保有中" };
  if (settings.maxPriceRiseEnabled && signal.sourcePrice && signal.sourcePrice > 0) {
    const rise = ((signal.currentPrice - signal.sourcePrice) / signal.sourcePrice) * 100;
    if (rise >= settings.maxPriceRise) return { accepted: false, reason: "価格上昇済み" };
  }
  return { accepted: true, reason: null };
}

export function evaluatePositionExit(
  entryPrice: number,
  currentPrice: number,
  settings: Pick<CopySettings, "stopLossEnabled" | "stopLoss" | "takeProfitEnabled" | "takeProfit">,
): {
  reason: "STOP_LOSS" | "TAKE_PROFIT" | null;
  pnlPercent: number | null;
} {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return { reason: null as "STOP_LOSS" | "TAKE_PROFIT" | null, pnlPercent: null };
  }
  const pnlPercent = (currentPrice - entryPrice) / entryPrice * 100;
  const reason: "STOP_LOSS" | "TAKE_PROFIT" | null =
    settings.stopLossEnabled && pnlPercent <= -settings.stopLoss
      ? "STOP_LOSS"
      : settings.takeProfitEnabled && pnlPercent >= settings.takeProfit
        ? "TAKE_PROFIT"
        : null;
  return { reason, pnlPercent };
}

export function calculatePaperPnl(entryPrice: number, exitPrice: number, amountUsd: number) {
  const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
  return { pnlPct, pnlUsd: amountUsd * pnlPct / 100 };
}
