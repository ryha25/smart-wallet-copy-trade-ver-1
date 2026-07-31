export type CopySettings = {
  enabled: boolean;
  liveTradingEnabled: boolean;
  amountPerTrade: number;
  maxPositions: number;
  maxDailyAmount: number;
  dailyLossLimitEnabled: boolean;
  dailyLossLimit: number;
  dailyLossIncludeUnrealized: boolean;
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

export type TradeModeFilter = "LIVE" | "PAPER" | "ALL";

export type LiveTradingStatus = {
  environmentEnabled: boolean;
  configured: boolean;
  ready: boolean;
  address: string | null;
  solBalance: number | null;
  usdcBalance: number | null;
  error: string | null;
};
