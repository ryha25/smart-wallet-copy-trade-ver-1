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

export type PopularToken24h = LiveTokenQuote & {
  rank: number;
  volume24hUsd: number;
  txns24h: number;
  buys24h: number;
  sells24h: number;
  pairAgeHours: number | null;
  boostAmount: number;
  popularityScore: number;
  sources: string[];
};

export type PopularTokens24hResponse = {
  chain: "solana";
  window: "24h";
  tokens: PopularToken24h[];
  fetchedAt: string;
  source: "DEXSCREENER_24H_ACTIVITY";
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
  network?: ChainNetwork;
  address: string;
  sources: string[];
  score: number;
  roi30d: number;
  realizedProfitUsd: number;
  unrealizedProfitUsd: number | null;
  winRate: number;
  swaps30d: number;
  activeTradingDays: number;
  avgTradesPerDay: number;
  sellEvents: number;
  closedTrades: number;
  ageDays: number | null;
  maxDrawdownPct: number | null;
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
  network?: ChainNetwork;
  source: "HELIUS_MULTI_DEX_SCAN" | "MORALIS_EVM_SCAN";
  scope: string;
  discoveredCandidates: number;
  scannedCandidates: number;
  successfulAnalyses: number;
  qualified: WalletScore[];
  evaluated: WalletScore[];
  rankingPool?: WalletScore[];
  fetchedAt: string;
};

export type WalletScanPhase =
  | "IDLE"
  | "DISCOVERING"
  | "ANALYZING"
  | "RISK_CHECKING"
  | "SAVING"
  | "COMPLETED"
  | "FAILED";

export type WalletScanState = {
  network?: ChainNetwork;
  id: string | null;
  status: "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";
  phase: WalletScanPhase;
  message: string;
  discoveredCandidates: number;
  targetCandidates: number;
  analyzedCandidates: number;
  successfulAnalyses: number;
  startedAt: string | null;
  completedAt: string | null;
  databaseEnabled: boolean;
  result: WalletScanResponse | null;
  error: string | null;
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
  id?: string;
  network?: ChainNetwork;
  address: string;
  label: string;
  origin: "MANUAL" | "AUTO" | "FAVORITE";
  enabled: boolean;
  addedAt: string;
  lastObservedSignature?: string | null;
  lastCheckedAt?: string | null;
  score?: WalletScore;
};

export type CopyMonitorStatus = {
  running: boolean;
  lastCycleAt: string | null;
  monitoredWallets: number;
  manualWallets: number;
  autoWallets: number;
  favoriteWallets: number;
  newBuyCount: number;
  createdPositions: number;
  skippedTrades: number;
  lastError: string | null;
};

export type ChainNetwork = "SOLANA" | "ETHEREUM" | "BASE";

export type EvmNativePrice = {
  network: "ETHEREUM";
  symbol: "ETH";
  priceUsd: number;
  priceChange24h: number | null;
  fetchedAt: string;
};

export type FavoriteToken = LiveTokenQuote & {
  addedAt: string;
};

export type ModePerformance = {
  mode: "LIVE" | "PAPER";
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  todayPnlUsd: number;
  winRate: number;
  closedCount: number;
  winCount: number;
  lossCount: number;
  openCount: number;
  averageWinUsd: number;
  averageLossUsd: number;
  maxWinUsd: number;
  maxLossUsd: number;
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
