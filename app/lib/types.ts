export type Wallet = {
  id: string; name: string; address: string; roi30d: number; realizedProfitUsd: number;
  unrealizedProfitUsd: number; winRate: number; trades30d: number; avgHold: string;
  maxDrawdown: number; ageDays: number; score: number; copying: boolean;
  consistency: number; favoriteSymbols: string[];
};

export type Position = {
  id: string; symbol: string; name: string; source: string; entry: number; current: number;
  amountUsd: number; openedAt: string; pnlPct: number; pnlUsd: number;
};

export type Trade = {
  id: string; at: string; side: "買い" | "売り" | "見送り"; symbol: string; wallet: string;
  buyPrice?: number; sellPrice?: number; pnlPct?: number; pnlUsd?: number;
  status: "保有中" | "決済済み" | "見送り"; reason?: string;
};

export type FavoriteToken = {
  id: string; name: string; symbol: string; mint: string; icon: string; createdAt: string; wallets: string[];
};

export type CopySettings = {
  enabled: boolean; amountPerTrade: number; maxPositions: number; maxDailyAmount: number;
  stopLoss: number; takeProfit: number; maxSlippage: number; maxWallets: number;
  allowDuplicate: boolean; favoritesOnly: boolean; minLiquidity: number; minMarketCap: number;
  maxDetectionSeconds: number; maxPriceRise: number;
};
