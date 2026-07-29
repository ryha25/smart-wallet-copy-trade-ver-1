import type { CopySettings } from "./types";

export const defaultSettings: CopySettings = {
  enabled: true,
  amountPerTrade: 250,
  maxPositions: 8,
  maxDailyAmount: 1500,
  stopLossEnabled: true,
  stopLoss: 8,
  takeProfitEnabled: true,
  takeProfit: 20,
  maxSlippage: 2,
  allowDuplicate: false,
  maxDetectionSeconds: 20,
  maxPriceRiseEnabled: true,
  maxPriceRise: 5,
};
