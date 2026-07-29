export type CopySettings = {
  enabled: boolean;
  amountPerTrade: number;
  maxPositions: number;
  maxDailyAmount: number;
  stopLossEnabled: boolean;
  stopLoss: number;
  takeProfitEnabled: boolean;
  takeProfit: number;
  maxSlippage: number;
  allowDuplicate: boolean;
  maxDetectionSeconds: number;
  maxPriceRiseEnabled: boolean;
  maxPriceRise: number;
};
