export type CopySettings = {
  enabled: boolean;
  amountPerTrade: number;
  maxPositions: number;
  maxDailyAmount: number;
  stopLoss: number;
  takeProfit: number;
  maxSlippage: number;
  allowDuplicate: boolean;
  minLiquidity: number;
  minMarketCap: number;
  maxDetectionSeconds: number;
  maxPriceRise: number;
};
