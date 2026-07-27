import type {
  FavoriteWalletScanResponse,
  LiveTokenQuote,
  LiveWalletEvent,
  LiveWalletResponse,
  WalletScanResponse,
  WalletScore,
  TokenRiskCheck,
} from "../lib/live-types";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD5G6zK9y7J9pB6K7dVn";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_V6_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const LAMPORTS_PER_SOL = 1_000_000_000;
const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type RpcTokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmountString?: string | null };
};

type RpcTransaction = {
  blockTime: number | null;
  transaction: {
    signatures?: string[];
    message: { accountKeys: Array<string | { pubkey: string }> };
  };
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: RpcTokenBalance[];
    postTokenBalances?: RpcTokenBalance[];
  } | null;
};

type HeliusHistory<T> = { data: T[]; paginationToken?: string | null };

type RawSwap = Omit<LiveWalletEvent, "current" | "sourcePriceUsd" | "quoteAmountUsd"> & {
  quoteAmountNative: number;
};

type ParsedMintAccount = {
  value: {
    data?: {
      parsed?: {
        info?: {
          mintAuthority?: string | null;
          freezeAuthority?: string | null;
        };
      };
    };
  } | null;
};

function env(name: string) {
  return process.env[name]?.trim().replace(/^(['"])(.*)\1$/, "$2") ?? "";
}

function rpcEndpoint() {
  const heliusKey = env("HELIUS_API_KEY");
  if (heliusKey) {
    return {
      url: `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}`,
      source: "HELIUS_RPC" as const,
    };
  }
  const configuredUrl = env("SOLANA_RPC_URL") || env("NEXT_PUBLIC_SOLANA_RPC_URL");
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`unsupported protocol: ${parsed.protocol}`);
      return { url: parsed.toString(), source: "SOLANA_PUBLIC_RPC" as const };
    } catch (error) {
      console.error("[NEXT-TRADE][rpc.config] Invalid RPC URL; falling back to public RPC", {
        configuredValue: configuredUrl,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
  return {
    url: "https://api.mainnet-beta.solana.com",
    source: "SOLANA_PUBLIC_RPC" as const,
  };
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcEndpoint().url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Solana RPC error: ${response.status}`);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? "Solana RPC request failed");
  if (payload.result === undefined) throw new Error("Solana RPC returned no result");
  return payload.result;
}

function accountKeys(tx: RpcTransaction) {
  return tx.transaction.message.accountKeys.map(key => typeof key === "string" ? key : key.pubkey);
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
  const index = accountKeys(tx).indexOf(address);
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

function swapsFromTransaction(tx: RpcTransaction, address: string, signature: string): RawSwap[] {
  if (!tx.meta || tx.meta.err) return [];
  const deltas = tokenDeltas(tx, address);
  const quote = quoteDelta(deltas, nativeSolDelta(tx, address));
  const events: RawSwap[] = [];
  for (const [mint, delta] of deltas) {
    if ([USDC_MINT, USDT_MINT, WRAPPED_SOL_MINT].includes(mint) || Math.abs(delta) <= 0) continue;
    if (!((delta > 0 && quote.amount < 0) || (delta < 0 && quote.amount > 0))) continue;
    events.push({
      signature,
      blockTime: tx.blockTime ?? 0,
      side: delta > 0 ? "BUY" : "SELL",
      mint,
      tokenAmount: Math.abs(delta),
      quoteKind: quote.kind,
      quoteAmountNative: Math.abs(quote.amount),
    });
  }
  return events;
}

async function getHeliusHistory(
  address: string,
  options: {
    transactionDetails: "full" | "signatures";
    limit: number;
    sortOrder?: "asc" | "desc";
    filters?: Record<string, unknown>;
  },
) {
  if (!env("HELIUS_API_KEY")) throw new Error("ウォレットスキャンにはHELIUS_API_KEYが必要です");
  return rpc<HeliusHistory<RpcTransaction & { signature?: string }>>("getTransactionsForAddress", [
    address,
    {
      encoding: "jsonParsed",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
      ...options,
    },
  ]);
}

async function solPriceHistory(from: number, to: number) {
  const key = env("BIRDEYE_API_KEY");
  if (!key) return [] as Array<{ unixTime: number; value: number }>;
  const url = new URL("https://public-api.birdeye.so/defi/history_price");
  url.searchParams.set("address", WRAPPED_SOL_MINT);
  url.searchParams.set("address_type", "token");
  url.searchParams.set("type", "1H");
  url.searchParams.set("time_from", String(from));
  url.searchParams.set("time_to", String(to));
  const response = await fetch(url, {
    headers: { "X-API-KEY": key, "x-chain": "solana", accept: "application/json" },
  });
  if (!response.ok) return [];
  const payload = await response.json() as { data?: { items?: Array<{ unixTime: number; value: number }> } };
  return payload.data?.items?.filter(item => Number.isFinite(item.value) && item.value > 0) ?? [];
}

function nearestHistoricalPrice(
  points: Array<{ unixTime: number; value: number }>,
  timestamp: number,
  currentSolPrice: number | null,
) {
  if (!points.length) return currentSolPrice;
  let closest = points[0];
  for (const point of points) {
    if (Math.abs(point.unixTime - timestamp) < Math.abs(closest.unixTime - timestamp)) closest = point;
  }
  return closest.value;
}

function valueSwaps(
  swaps: RawSwap[],
  solHistory: Array<{ unixTime: number; value: number }>,
  currentSolPrice: number | null,
  quotes: Map<string, LiveTokenQuote>,
): LiveWalletEvent[] {
  return swaps.map(({ quoteAmountNative, ...event }) => {
    const quoteAmountUsd = event.quoteKind === "USDC" || event.quoteKind === "USDT"
      ? quoteAmountNative
      : event.quoteKind === "SOL"
        ? quoteAmountNative * (nearestHistoricalPrice(solHistory, event.blockTime, currentSolPrice) ?? 0)
        : null;
    return {
      ...event,
      quoteAmountUsd: quoteAmountUsd && quoteAmountUsd > 0 ? quoteAmountUsd : null,
      sourcePriceUsd: quoteAmountUsd && event.tokenAmount > 0 ? quoteAmountUsd / event.tokenAmount : null,
      current: quotes.get(event.mint) ?? null,
    };
  });
}

export async function getTokenQuotes(mints: string[]): Promise<Map<string, LiveTokenQuote>> {
  const unique = [...new Set(mints)].filter(Boolean).slice(0, 30);
  if (!unique.length) return new Map();
  const dexScreenerUrl = `https://api.dexscreener.com/tokens/v1/solana/${unique.map(encodeURIComponent).join(",")}`;
  console.info("[NEXT-TRADE][dexscreener] request", { mints: unique, url: dexScreenerUrl });
  const response = await fetch(dexScreenerUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(45_000),
  });
  const rawResponse = await response.text();
  console.info("[NEXT-TRADE][dexscreener] raw response", {
    status: response.status,
    statusText: response.statusText,
    body: rawResponse,
  });
  if (!response.ok) throw new Error(`DexScreener API error: HTTP ${response.status} ${response.statusText}; body=${rawResponse.slice(0, 1000)}`);
  let parsedResponse: unknown;
  try {
    parsedResponse = JSON.parse(rawResponse);
  } catch (error) {
    throw new Error(`DexScreener APIのJSON解析に失敗しました: ${rawResponse.slice(0, 1000)}`, { cause: error });
  }
  if (!Array.isArray(parsedResponse)) {
    throw new Error(`DexScreener APIのレスポンス形式が不正です: ${rawResponse.slice(0, 1000)}`);
  }
  const pairs = parsedResponse as Array<{
    dexId?: string;
    url?: string;
    baseToken?: { address?: string; name?: string; symbol?: string };
    priceUsd?: string | null;
    priceChange?: { h24?: number };
    liquidity?: { usd?: number };
    marketCap?: number | null;
    fdv?: number | null;
  }>;
  if (pairs.length === 0) {
    console.warn("[NEXT-TRADE][dexscreener] pairs is empty", { mints: unique, url: dexScreenerUrl });
    return new Map();
  }
  const result = new Map<string, LiveTokenQuote>();
  for (const pair of pairs) {
    const mint = pair.baseToken?.address;
    const priceUsd = Number(pair.priceUsd ?? 0);
    if (!mint || !Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    const liquidityUsd = Number(pair.liquidity?.usd ?? 0);
    if ((result.get(mint)?.liquidityUsd ?? -1) >= liquidityUsd) continue;
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

export async function getTokenRisk(mint: string): Promise<TokenRiskCheck> {
  if (!ADDRESS_PATTERN.test(mint)) throw new Error("SolanaのCAを確認してください");
  const [mintAccount, rugResponse] = await Promise.all([
    rpc<ParsedMintAccount>("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]).catch(() => null),
    fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report/summary`, {
      headers: { accept: "application/json" },
    }).catch(() => null),
  ]);
  const info = mintAccount?.value?.data?.parsed?.info;
  const mintAuthority = info?.mintAuthority ?? null;
  const freezeAuthority = info?.freezeAuthority ?? null;
  let rugCheckScore: number | null = null;
  const risks: string[] = [];
  if (rugResponse?.ok) {
    const report = await rugResponse.json() as {
      score_normalised?: number;
      risks?: Array<{ name?: string; level?: string; description?: string }>;
    };
    rugCheckScore = Number.isFinite(report.score_normalised) ? Number(report.score_normalised) : null;
    for (const risk of report.risks ?? []) {
      if (["danger", "error"].includes((risk.level ?? "").toLowerCase())) {
        risks.push(risk.name ?? risk.description ?? "RugCheck risk");
      }
    }
  } else {
    risks.push("RugCheckの判定を取得できない");
  }
  if (mintAuthority) risks.push("Mint権限が残っている");
  if (freezeAuthority) risks.push("Freeze権限が残っている");
  if (rugCheckScore !== null && rugCheckScore >= 50) risks.push(`RugCheck高リスクスコア ${rugCheckScore}`);
  return {
    mint,
    safe: risks.length === 0,
    rugCheckScore,
    mintAuthority,
    freezeAuthority,
    risks: [...new Set(risks)],
    checkedAt: new Date().toISOString(),
  };
}

async function recentTransactions(address: string) {
  if (env("HELIUS_API_KEY")) {
    const history = await getHeliusHistory(address, {
      transactionDetails: "full",
      limit: 20,
      sortOrder: "desc",
      filters: { status: "succeeded", tokenAccounts: "balanceChanged" },
    });
    return history.data;
  }
  const signatures = await rpc<Array<{ signature: string; blockTime: number | null; err: unknown }>>(
    "getSignaturesForAddress",
    [address, { limit: 12, commitment: "confirmed" }],
  );
  const successful = signatures.filter(item => !item.err).slice(0, 10);
  const transactions = await Promise.all(successful.map(async item => {
    const tx = await rpc<RpcTransaction | null>("getTransaction", [
      item.signature,
      { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    ]).catch(() => null);
    if (!tx) return null;
    tx.transaction.signatures ??= [item.signature];
    return tx;
  }));
  return transactions.filter((tx): tx is RpcTransaction => Boolean(tx));
}

export async function getLiveWalletActivity(address: string): Promise<LiveWalletResponse> {
  if (!ADDRESS_PATTERN.test(address)) throw new Error("Solanaウォレットアドレスが正しくありません");
  const transactions = await recentTransactions(address);
  const raw = transactions.flatMap(tx =>
    swapsFromTransaction(tx, address, tx.transaction.signatures?.[0] ?? crypto.randomUUID()),
  );
  const quoteMints = [...new Set([...raw.map(item => item.mint), WRAPPED_SOL_MINT])];
  const quotes = await getTokenQuotes(quoteMints).catch(() => new Map<string, LiveTokenQuote>());
  const now = Math.floor(Date.now() / 1000);
  const oldest = Math.min(...raw.map(item => item.blockTime).filter(Boolean), now);
  const history = raw.some(item => item.quoteKind === "SOL")
    ? await solPriceHistory(oldest, now).catch(() => [])
    : [];
  return {
    address,
    source: rpcEndpoint().source,
    fetchedAt: new Date().toISOString(),
    events: valueSwaps(raw, history, quotes.get(WRAPPED_SOL_MINT)?.priceUsd ?? null, quotes),
    warnings: [
      "表示している売買はオンチェーン残高差から判定した実取引です。複雑なDeFi操作は売買として解釈できない場合があります。",
      "実資金の注文は送信しません。コピー取引はすべて仮想資金によるペーパートレードです。",
    ],
  };
}

type ClosedTrade = { pnl: number; cost: number; mint: string; blockTime: number };

function closeTrades(events: LiveWalletEvent[]) {
  const lots = new Map<string, Array<{ quantity: number; costPerToken: number }>>();
  const closed: ClosedTrade[] = [];
  for (const event of [...events].sort((a, b) => a.blockTime - b.blockTime)) {
    if (!event.quoteAmountUsd || !event.tokenAmount) continue;
    if (event.side === "BUY") {
      const tokenLots = lots.get(event.mint) ?? [];
      tokenLots.push({ quantity: event.tokenAmount, costPerToken: event.quoteAmountUsd / event.tokenAmount });
      lots.set(event.mint, tokenLots);
      continue;
    }
    let remaining = event.tokenAmount;
    let cost = 0;
    const tokenLots = lots.get(event.mint) ?? [];
    while (remaining > 0 && tokenLots.length) {
      const lot = tokenLots[0];
      const matched = Math.min(remaining, lot.quantity);
      cost += matched * lot.costPerToken;
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity <= 1e-12) tokenLots.shift();
    }
    const matchedQuantity = event.tokenAmount - remaining;
    if (matchedQuantity <= 0 || cost <= 0) continue;
    const proceeds = event.quoteAmountUsd * (matchedQuantity / event.tokenAmount);
    closed.push({ pnl: proceeds - cost, cost, mint: event.mint, blockTime: event.blockTime });
  }
  return closed;
}

function scoreWallet(address: string, events: LiveWalletEvent[], ageDays: number, evaluatedTransactions: number): WalletScore {
  const closed = closeTrades(events);
  const realizedProfitUsd = closed.reduce((sum, trade) => sum + trade.pnl, 0);
  const cost = closed.reduce((sum, trade) => sum + trade.cost, 0);
  const roi30d = cost > 0 ? realizedProfitUsd / cost * 100 : 0;
  const winRate = closed.length ? closed.filter(trade => trade.pnl > 0).length / closed.length * 100 : 0;
  let running = 0;
  let peak = 0;
  let maxDrawdownUsd = 0;
  for (const trade of closed) {
    running += trade.pnl;
    peak = Math.max(peak, running);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - running);
  }
  const maxDrawdownPct = cost > 0 ? maxDrawdownUsd / cost * 100 : 0;
  const weeks = new Map<number, number>();
  for (const trade of closed) {
    const week = Math.floor(trade.blockTime / (7 * 86400));
    weeks.set(week, (weeks.get(week) ?? 0) + trade.pnl);
  }
  const profitableWeeks = [...weeks.values()].filter(pnl => pnl > 0).length;
  const profitByMint = new Map<string, number>();
  for (const trade of closed) profitByMint.set(trade.mint, (profitByMint.get(trade.mint) ?? 0) + Math.max(0, trade.pnl));
  const positiveProfit = [...profitByMint.values()].reduce((sum, value) => sum + value, 0);
  const concentration = positiveProfit > 0 ? Math.max(0, ...profitByMint.values()) / positiveProfit : 1;

  let score = 0;
  score += Math.min(25, Math.max(0, roi30d / 60 * 25));
  score += Math.min(15, Math.max(0, Math.log10(Math.max(1, realizedProfitUsd)) / 4 * 15));
  score += Math.min(15, Math.max(0, winRate / 60 * 15));
  score += Math.min(15, profitableWeeks / 4 * 15);
  score += Math.max(0, 10 - maxDrawdownPct / 3);
  score += Math.min(10, events.length / 20 * 10);
  score += Math.min(5, ageDays / 90 * 5);
  if (concentration > 0.8) score -= 12;
  if (closed.length < 3) score -= 10;
  score = Math.round(Math.max(0, Math.min(95, score)));

  const reasons: string[] = [];
  if (roi30d < 60) reasons.push("30日ROIが60%未満");
  if (realizedProfitUsd <= 0) reasons.push("30日確定利益がプラスではない");
  if (winRate < 60) reasons.push("勝率が60%未満");
  if (events.length < 20) reasons.push("30日売買件数が20件未満");
  if (ageDays < 90) reasons.push("初回取引から90日未満");
  if (closed.length < 3) reasons.push("複数の決済実績が不足");
  if (profitableWeeks < 2) reasons.push("利益継続性が不足");
  if (concentration > 0.8) reasons.push("利益が特定銘柄に集中");

  return {
    address,
    score,
    roi30d: Number(roi30d.toFixed(2)),
    realizedProfitUsd: Number(realizedProfitUsd.toFixed(2)),
    winRate: Number(winRate.toFixed(2)),
    swaps30d: events.length,
    closedTrades: closed.length,
    ageDays,
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    profitableWeeks,
    evaluatedTransactions,
    valuedEvents: events.filter(event => event.quoteAmountUsd).length,
    qualified: reasons.length === 0,
    reasons,
    evaluatedAt: new Date().toISOString(),
  };
}

async function analyzeWalletWithEvents(address: string): Promise<{ score: WalletScore; events: LiveWalletEvent[] }> {
  if (!ADDRESS_PATTERN.test(address)) throw new Error("Solanaウォレットアドレスが正しくありません");
  const now = Math.floor(Date.now() / 1000);
  const since = now - 30 * 86400;
  const [history, first] = await Promise.all([
    getHeliusHistory(address, {
      transactionDetails: "full",
      limit: 250,
      sortOrder: "asc",
      filters: { status: "succeeded", tokenAccounts: "balanceChanged", blockTime: { gte: since } },
    }),
    getHeliusHistory(address, { transactionDetails: "signatures", limit: 1, sortOrder: "asc" }),
  ]);
  const raw = history.data.flatMap(tx =>
    swapsFromTransaction(tx, address, tx.transaction.signatures?.[0] ?? crypto.randomUUID()),
  );
  const needsSol = raw.some(item => item.quoteKind === "SOL");
  const [solHistory, quotes] = await Promise.all([
    needsSol ? solPriceHistory(since, now).catch(() => []) : Promise.resolve([]),
    getTokenQuotes(needsSol ? [WRAPPED_SOL_MINT] : []).catch(() => new Map<string, LiveTokenQuote>()),
  ]);
  const events = valueSwaps(raw, solHistory, quotes.get(WRAPPED_SOL_MINT)?.priceUsd ?? null, new Map());
  const firstTime = first.data[0]?.blockTime ?? now;
  const ageDays = Math.max(0, Math.floor((now - firstTime) / 86400));
  const score = scoreWallet(address, events, ageDays, history.data.length);
  const mostTradedMints = [...new Set(events.map(event => event.mint))].slice(0, 3);
  const mintAccounts = await Promise.all(mostTradedMints.map(async mint => {
    const account = await rpc<ParsedMintAccount>("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]).catch(() => null);
    return account?.value?.data?.parsed?.info;
  }));
  if (mintAccounts.some(info => info?.mintAuthority === address || info?.freezeAuthority === address)) {
    score.qualified = false;
    score.reasons.push("トークン開発者権限との関連を検知");
    score.score = Math.max(0, score.score - 30);
  }
  if (events.length >= 150) {
    score.qualified = false;
    score.reasons.push("極端な高頻度取引のためBOT疑い");
    score.score = Math.max(0, score.score - 15);
  }
  if (score.winRate >= 98 && score.closedTrades >= 5) {
    score.qualified = false;
    score.reasons.push("異常に高い勝率のため内部取引疑い");
    score.score = Math.max(0, score.score - 15);
  }
  return { score, events };
}

export async function analyzeWallet(address: string): Promise<WalletScore> {
  return (await analyzeWalletWithEvents(address)).score;
}

export async function scanProfitableWallets(): Promise<WalletScanResponse> {
  const discovery = await getHeliusHistory(JUPITER_V6_PROGRAM, {
    transactionDetails: "full",
    limit: 80,
    sortOrder: "desc",
    filters: { status: "succeeded" },
  });
  const candidates = [...new Set(
    discovery.data
      .map(tx => accountKeys(tx)[0])
      .filter(address => ADDRESS_PATTERN.test(address) && address !== JUPITER_V6_PROGRAM),
  )].slice(0, 10);
  const analyzed = (await Promise.all(candidates.map(address => analyzeWalletWithEvents(address).catch(() => null))))
    .filter((item): item is Awaited<ReturnType<typeof analyzeWalletWithEvents>> => Boolean(item));
  await Promise.all(analyzed.map(async item => {
    if (!item.score.qualified) return;
    const recentMints = [...new Set(
      [...item.events]
        .filter(event => event.side === "BUY")
        .sort((a, b) => b.blockTime - a.blockTime)
        .map(event => event.mint),
    )].slice(0, 2);
    const checks = await Promise.all(recentMints.map(mint => getTokenRisk(mint).catch(() => null)));
    const unsafe = checks.filter((check): check is TokenRiskCheck => Boolean(check && !check.safe));
    if (unsafe.length) {
      item.score.qualified = false;
      item.score.score = Math.max(0, item.score.score - 20);
      item.score.reasons.push(`直近取引トークンに危険判定: ${unsafe.flatMap(check => check.risks).slice(0, 2).join("、")}`);
    }
  }));
  const evaluated = analyzed.map(item => item.score).sort((a, b) => b.score - a.score);
  return {
    source: "HELIUS_JUPITER_SCAN",
    scope: "直近80件のJupiter v6成功取引から抽出した最大10ウォレットを30日履歴で評価",
    scannedCandidates: candidates.length,
    qualified: evaluated.filter(wallet => wallet.qualified).slice(0, 5),
    evaluated,
    fetchedAt: new Date().toISOString(),
  };
}

export async function scanWalletsForToken(tokenMint: string): Promise<FavoriteWalletScanResponse> {
  if (!ADDRESS_PATTERN.test(tokenMint)) throw new Error("SolanaのCAを確認してください");
  const tokenRisk = await getTokenRisk(tokenMint);
  if (!tokenRisk.safe) {
    return {
      tokenMint,
      scannedCandidates: 0,
      matches: [],
      scope: `危険判定のためウォレット候補から除外: ${tokenRisk.risks.join("、")}`,
      fetchedAt: new Date().toISOString(),
      tokenRisk,
    };
  }
  const discovery = await getHeliusHistory(tokenMint, {
    transactionDetails: "full",
    limit: 80,
    sortOrder: "desc",
    filters: { status: "succeeded" },
  });
  const candidates = [...new Set(
    discovery.data
      .map(tx => accountKeys(tx)[0])
      .filter(address => ADDRESS_PATTERN.test(address) && address !== tokenMint),
  )].slice(0, 10);
  const analyzed = (await Promise.all(candidates.map(address => analyzeWalletWithEvents(address).catch(() => null))))
    .filter((item): item is Awaited<ReturnType<typeof analyzeWalletWithEvents>> => Boolean(item));
  const matches = analyzed.flatMap(({ score, events }) => {
    const tokenClosed = closeTrades(events.filter(event => event.mint === tokenMint));
    const tokenRealizedProfitUsd = tokenClosed.reduce((sum, trade) => sum + trade.pnl, 0);
    if (tokenClosed.length === 0 || tokenRealizedProfitUsd <= 0) return [];
    return [{
      ...score,
      tokenMint,
      tokenRealizedProfitUsd: Number(tokenRealizedProfitUsd.toFixed(2)),
      tokenClosedTrades: tokenClosed.length,
    }];
  }).sort((a, b) =>
    b.tokenRealizedProfitUsd - a.tokenRealizedProfitUsd || b.score - a.score,
  ).slice(0, 5);
  return {
    tokenMint,
    scannedCandidates: candidates.length,
    matches,
    scope: "CAの直近80件の成功取引から最大10ウォレットを抽出し、対象コインの確定利益がプラスの上位5件を表示",
    fetchedAt: new Date().toISOString(),
    tokenRisk,
  };
}

export async function getJupiterPaperQuote(inputMint: string, amountUsd: number, slippageBps: number) {
  const key = env("JUPITER_API_KEY");
  if (!key) throw new Error("JUPITER_API_KEYが設定されていません");
  const amount = Math.max(1, Math.round(amountUsd * 1_000_000));
  const url = new URL("https://api.jup.ag/swap/v1/quote");
  url.searchParams.set("inputMint", USDC_MINT);
  url.searchParams.set("outputMint", inputMint);
  url.searchParams.set("amount", String(amount));
  url.searchParams.set("slippageBps", String(Math.max(1, Math.round(slippageBps))));
  const response = await fetch(url, {
    headers: { "x-api-key": key, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Jupiter quote error: ${response.status}`);
  const payload = await response.json() as { outAmount?: string; priceImpactPct?: string; routePlan?: unknown[] };
  if (!payload.outAmount || Number(payload.outAmount) <= 0) throw new Error("Jupiterで交換経路が見つかりません");
  return {
    inputUsd: amount / 1_000_000,
    outputRawAmount: payload.outAmount,
    priceImpactPct: Number(payload.priceImpactPct ?? 0),
    routeCount: payload.routePlan?.length ?? 0,
    quotedAt: new Date().toISOString(),
  };
}
