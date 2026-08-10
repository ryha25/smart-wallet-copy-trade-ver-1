export type CopySettings = {
  enabled: boolean;
  liveTradingEnabled: boolean;
  amountPerTrade: number;
  maxPositions: number;
  maxDailyAmount: number;
  maxWallets: number;
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

export type LimitOrderSide = "BUY" | "SELL";
export type LimitOrderStatus = "PENDING" | "TRIGGERED" | "FAILED" | "CANCELLED";

export type LimitOrder = {
  id: string;
  tokenMint: string;
  tokenSymbol: string;
  side: LimitOrderSide;
  targetPriceUsd: number;
  amountUsd?: number;
  sellPercent?: number;
  positionId?: string;
  status: LimitOrderStatus;
  createdAt: string;
  triggeredAt?: string;
  errorMessage?: string;
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
