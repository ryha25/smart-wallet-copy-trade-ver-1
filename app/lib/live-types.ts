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

export type LivePaperPosition = {
  id: string;
  signature: string;
  wallet: string;
  mint: string;
  symbol: string;
  openedAt: string;
  copyPriceUsd: number;
  currentPriceUsd: number;
  amountUsd: number;
  liquidityUsd: number;
};
