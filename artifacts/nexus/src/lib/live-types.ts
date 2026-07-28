export type LiveTokenQuote = {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  liquidityUsd: number;
  marketCapUsd: number;
  priceChange24h: number | null;
  dex: string;
  pairUrl: string | null;
};

export type LiveWalletEvent = {
  signature: string;
  blockTime: number;
  side: "BUY" | "SELL";
  mint: string;
  tokenAmount: number;
  sourcePriceUsd: number | null;
  quoteAmountUsd: number | null;
  quoteKind: "USDC" | "USDT" | "SOL" | "UNKNOWN";
  current: LiveTokenQuote | null;
};

export type LiveWalletResponse = {
  address: string;
  source: "HELIUS_RPC" | "SOLANA_PUBLIC_RPC";
  fetchedAt: string;
  events: LiveWalletEvent[];
  warnings: string[];
};

export type WalletScore = {
  address: string;
  sources: string[];
  score: number;
  roi30d: number;
  realizedProfitUsd: number;
  winRate: number;
  swaps30d: number;
  activeTradingDays: number;
  avgTradesPerDay: number;
  sellEvents: number;
  closedTrades: number;
  ageDays: number;
  maxDrawdownPct: number;
  profitableWeeks: number;
  evaluatedTransactions: number;
  valuedEvents: number;
  addable: boolean;
  qualified: boolean;
  warnings: string[];
  blockers: string[];
  reasons: string[];
  evaluatedAt: string;
};

export type WalletScanResponse = {
  source: "HELIUS_MULTI_DEX_SCAN";
  scope: string;
  discoveredCandidates: number;
  scannedCandidates: number;
  successfulAnalyses: number;
  qualified: WalletScore[];
  evaluated: WalletScore[];
  fetchedAt: string;
};

export type FavoriteWalletMatch = WalletScore & {
  tokenMint: string;
  tokenRealizedProfitUsd: number;
  tokenClosedTrades: number;
};

export type FavoriteWalletScanResponse = {
  tokenMint: string;
  scannedCandidates: number;
  matches: FavoriteWalletMatch[];
  scope: string;
  fetchedAt: string;
  tokenRisk: TokenRiskCheck;
};

export type TokenRiskCheck = {
  mint: string;
  safe: boolean;
  rugCheckScore: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  risks: string[];
  checkedAt: string;
};

export type TrackedWallet = {
  address: string;
  label: string;
  origin: "MANUAL" | "AUTO";
  enabled: boolean;
  addedAt: string;
  score?: WalletScore;
};

export type FavoriteToken = LiveTokenQuote & {
  addedAt: string;
};

export type LivePaperPosition = {
  id: string;
  signature: string;
  wallet: string;
  mint: string;
  symbol: string;
  openedAt: string;
  sourceBlockTime: number;
  detectionDelaySeconds: number;
  sourcePriceUsd: number | null;
  copyPriceUsd: number;
  currentPriceUsd: number;
  amountUsd: number;
  liquidityUsd: number;
  status: "OPEN" | "CLOSED";
  closedAt?: string;
  exitPriceUsd?: number;
  exitReason?: string;
};

export type SkippedPaperTrade = {
  id: string;
  signature: string;
  wallet: string;
  mint: string;
  symbol: string;
  detectedAt: string;
  reason: string;
};
