export type LimitOrder = {
  id: string;
  tokenMint: string;
  tokenSymbol: string;
  side: "BUY" | "SELL";
  targetPriceUsd: number;
  amountUsd?: number;
  sellPercent?: number;
  positionId?: string;
  status: "PENDING" | "TRIGGERED" | "FAILED" | "CANCELLED";
  createdAt: string;
  triggeredAt?: string;
  errorMessage?: string;
};

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
