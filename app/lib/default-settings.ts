import type { CopySettings } from "./types";

export const defaultSettings: CopySettings = {
  enabled: true,
  amountPerTrade: 250,
  maxPositions: 8,
  maxDailyAmount: 1500,
  stopLoss: 8,
  takeProfit: 20,
  maxSlippage: 2,
  allowDuplicate: false,
  minLiquidity: 100000,
  minMarketCap: 1000000,
  maxDetectionSeconds: 20,
  maxPriceRise: 5,
};
