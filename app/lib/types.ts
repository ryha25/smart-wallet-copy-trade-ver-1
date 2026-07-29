export type CopySettings = {
  enabled: boolean;
  liveTradingEnabled: boolean;
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

export type LiveTradingStatus = {
  environmentEnabled: boolean;
  configured: boolean;
  ready: boolean;
  address: string | null;
  solBalance: number | null;
  usdcBalance: number | null;
  error: string | null;
};
