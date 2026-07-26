import type { LiveTokenQuote, LiveWalletEvent, LiveWalletResponse } from "../lib/live-types";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD5G6zQeL1b8L4mM2P8NfV";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;

type RpcTokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmountString?: string | null };
};

type RpcTransaction = {
  blockTime: number | null;
  transaction: { message: { accountKeys: Array<string | { pubkey: string }> } };
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: RpcTokenBalance[];
    postTokenBalances?: RpcTokenBalance[];
  } | null;
};

function rpcEndpoint() {
  if (process.env.HELIUS_API_KEY) {
    return {
      url: `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY)}`,
      source: "HELIUS_RPC" as const,
    };
  }
  return {
    url: process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    source: "SOLANA_PUBLIC_RPC" as const,
  };
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const { url } = rpcEndpoint();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Solana RPC error: ${response.status}`);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? "Solana RPC request failed");
  if (payload.result === undefined) throw new Error("Solana RPC returned no result");
  return payload.result;
}

function tokenDeltas(tx: RpcTransaction, address: string) {
  const amounts = new Map<string, number>();
  for (const balance of tx.meta?.preTokenBalances ?? []) {
    if (balance.owner !== address) continue;
    amounts.set(balance.mint, (amounts.get(balance.mint) ?? 0) - Number(balance.uiTokenAmount.uiAmountString ?? 0));
  }
  for (const balance of tx.meta?.postTokenBalances ?? []) {
    if (balance.owner !== address) continue;
    amounts.set(balance.mint, (amounts.get(balance.mint) ?? 0) + Number(balance.uiTokenAmount.uiAmountString ?? 0));
  }
  return amounts;
}

function nativeSolDelta(tx: RpcTransaction, address: string) {
  const keys = tx.transaction.message.accountKeys.map(key => typeof key === "string" ? key : key.pubkey);
  const index = keys.indexOf(address);
  if (index < 0 || !tx.meta) return 0;
  let lamports = tx.meta.postBalances[index] - tx.meta.preBalances[index];
  if (index === 0) lamports += tx.meta.fee;
  return lamports / LAMPORTS_PER_SOL;
}

function quoteDelta(deltas: Map<string, number>, solDelta: number) {
  if ((deltas.get(USDC_MINT) ?? 0) !== 0) return { kind: "USDC" as const, amount: deltas.get(USDC_MINT) ?? 0 };
  if ((deltas.get(USDT_MINT) ?? 0) !== 0) return { kind: "USDT" as const, amount: deltas.get(USDT_MINT) ?? 0 };
  if ((deltas.get(WRAPPED_SOL_MINT) ?? 0) !== 0) return { kind: "SOL" as const, amount: deltas.get(WRAPPED_SOL_MINT) ?? 0 };
  if (Math.abs(solDelta) > 0.00001) return { kind: "SOL" as const, amount: solDelta };
  return { kind: "UNKNOWN" as const, amount: 0 };
}

export async function getTokenQuotes(mints: string[]): Promise<Map<string, LiveTokenQuote>> {
  const unique = [...new Set(mints)].filter(Boolean).slice(0, 30);
  if (!unique.length) return new Map();
  const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${unique.join(",")}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`DEX Screener error: ${response.status}`);
  const pairs = await response.json() as Array<{
    dexId?: string;
    url?: string;
    baseToken?: { address?: string; name?: string; symbol?: string };
    priceUsd?: string | null;
    priceChange?: { h24?: number };
    liquidity?: { usd?: number };
    marketCap?: number | null;
    fdv?: number | null;
  }>;
  const result = new Map<string, LiveTokenQuote>();
  for (const pair of pairs) {
    const mint = pair.baseToken?.address;
    const priceUsd = Number(pair.priceUsd ?? 0);
    if (!mint || !Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    const liquidityUsd = Number(pair.liquidity?.usd ?? 0);
    const existing = result.get(mint);
    if (existing && existing.liquidityUsd >= liquidityUsd) continue;
    result.set(mint, {
      mint,
      symbol: pair.baseToken?.symbol ?? `${mint.slice(0, 4)}…`,
      name: pair.baseToken?.name ?? "Unknown token",
      priceUsd,
      liquidityUsd,
      marketCapUsd: Number(pair.marketCap ?? pair.fdv ?? 0),
      priceChange24h: pair.priceChange?.h24 ?? null,
      dex: pair.dexId ?? "unknown",
      pairUrl: pair.url ?? null,
    });
  }
  return result;
}

export async function getLiveWalletActivity(address: string): Promise<LiveWalletResponse> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) throw new Error("Solanaウォレットアドレスが正しくありません");
  const signatures = await rpc<Array<{ signature: string; blockTime: number | null; err: unknown }>>(
    "getSignaturesForAddress",
    [address, { limit: 12, commitment: "confirmed" }],
  );
  const successful = signatures.filter(item => !item.err).slice(0, 10);
  const transactions = await Promise.all(successful.map(item =>
    rpc<RpcTransaction | null>("getTransaction", [
      item.signature,
      { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    ]).catch(() => null),
  ));

  const candidates: Array<Omit<LiveWalletEvent, "current"> & { quoteAmountNative: number }> = [];
  transactions.forEach((tx, index) => {
    if (!tx?.meta || tx.meta.err) return;
    const deltas = tokenDeltas(tx, address);
    const solDelta = nativeSolDelta(tx, address);
    const quote = quoteDelta(deltas, solDelta);
    for (const [mint, delta] of deltas) {
      if ([USDC_MINT, USDT_MINT, WRAPPED_SOL_MINT].includes(mint) || Math.abs(delta) <= 0) continue;
      const pairedSwap = (delta > 0 && quote.amount < 0) || (delta < 0 && quote.amount > 0);
      if (!pairedSwap) continue;
      const quoteUsd = quote.kind === "USDC" || quote.kind === "USDT" ? Math.abs(quote.amount) : null;
      candidates.push({
        signature: successful[index].signature,
        blockTime: tx.blockTime ?? successful[index].blockTime ?? 0,
        side: delta > 0 ? "BUY" : "SELL",
        mint,
        tokenAmount: Math.abs(delta),
        sourcePriceUsd: quoteUsd && Math.abs(delta) ? quoteUsd / Math.abs(delta) : null,
        quoteAmountUsd: quoteUsd,
        quoteKind: quote.kind,
        quoteAmountNative: Math.abs(quote.amount),
      });
    }
  });

  const quoteMints = [...new Set([...candidates.map(item => item.mint), WRAPPED_SOL_MINT])];
  const quotes = await getTokenQuotes(quoteMints).catch(() => new Map<string, LiveTokenQuote>());
  const solPrice = quotes.get(WRAPPED_SOL_MINT)?.priceUsd ?? null;
  const events = candidates.map(({ quoteAmountNative, ...item }) => {
    const quoteAmountUsd = item.quoteAmountUsd ?? (item.quoteKind === "SOL" && solPrice
      ? quoteAmountNative * solPrice
      : null);
    const sourcePriceUsd = item.sourcePriceUsd ?? (quoteAmountUsd && item.tokenAmount
      ? quoteAmountUsd / item.tokenAmount
      : null);
    return { ...item, quoteAmountUsd, sourcePriceUsd, current: quotes.get(item.mint) ?? null };
  });

  const warnings = [
    "オンチェーン残高差分からスワップ候補を判定しています。送金や複雑なDeFi取引は除外・誤判定される場合があります。",
    "USDC/USDT建て以外の過去約定価格は表示せず、コピー価格には現在のDEX価格を使用します。",
  ];
  return { address, source: rpcEndpoint().source, fetchedAt: new Date().toISOString(), events, warnings };
}
