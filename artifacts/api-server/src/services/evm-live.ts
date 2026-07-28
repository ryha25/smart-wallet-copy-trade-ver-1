import type { ChainNetwork, WalletScanResponse, WalletScore } from "../lib/live-types";

export type EvmNetwork = Extract<ChainNetwork, "ETHEREUM" | "BASE">;

export type EvmScanProgress = {
  phase: "DISCOVERING" | "ANALYZING" | "RISK_CHECKING" | "SAVING";
  message: string;
  discoveredCandidates: number;
  targetCandidates: number;
  analyzedCandidates: number;
  successfulAnalyses: number;
};

type TopTrader = {
  address?: string;
  count_of_trades?: number;
  realized_profit_percentage?: number | string;
  realized_profit_usd?: number | string;
};

type PnlSummary = {
  total_count_of_trades?: number;
  total_realized_profit_usd?: number | string;
  total_realized_profit_percentage?: number | string;
  total_buys?: number;
  total_sells?: number;
};

type PnlRow = {
  token_address?: string;
  count_of_trades?: number;
  realized_profit_usd?: number | string;
  realized_profit_percentage?: number | string;
  total_buys?: number;
  total_sells?: number;
  symbol?: string;
  possible_spam?: boolean;
};

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const MORALIS_BASE = "https://deep-index.moralis.io/api/v2.2";

const DEFAULT_DISCOVERY_TOKENS: Record<EvmNetwork, string[]> = {
  ETHEREUM: [
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
  ],
  BASE: [
    "0x4200000000000000000000000000000000000006",
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    "0x532f27101965dd16442E59d40670FaF5eBB142E4",
  ],
};

const chainParam = (network: EvmNetwork) => network === "ETHEREUM" ? "eth" : "base";
const numberValue = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function configuredTokens(network: EvmNetwork) {
  const key = network === "ETHEREUM" ? "EVM_ETH_DISCOVERY_TOKENS" : "EVM_BASE_DISCOVERY_TOKENS";
  const configured = (process.env[key] ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(value => EVM_ADDRESS.test(value));
  return [...new Set(configured.length ? configured : DEFAULT_DISCOVERY_TOKENS[network])];
}

function requiredConfig(network: EvmNetwork) {
  const moralisKey = process.env.MORALIS_API_KEY?.trim();
  const alchemyKey = process.env.ALCHEMY_API_KEY?.trim();
  const rpcUrl = network === "ETHEREUM"
    ? process.env.ETHEREUM_RPC_URL?.trim() || (alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : "")
    : process.env.BASE_RPC_URL?.trim() || (alchemyKey ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}` : "");
  const missing = [
    !moralisKey && "MORALIS_API_KEY",
    !rpcUrl && (network === "ETHEREUM" ? "ETHEREUM_RPC_URL または ALCHEMY_API_KEY" : "BASE_RPC_URL または ALCHEMY_API_KEY"),
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`${network === "ETHEREUM" ? "Ethereum" : "Base"}実データ解析に必要なSecretsが未設定です: ${missing.join("、")}`);
  }
  return { moralisKey: moralisKey!, rpcUrl };
}

async function fetchJson<T>(url: string, apiKey: string, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "X-API-Key": apiKey, accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Moralis API ${response.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function isExternallyOwnedAccount(address: string, rpcUrl: string) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
    cache: "no-store",
  });
  const payload = await response.json() as { result?: string; error?: { message?: string } };
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? `RPC ${response.status}`);
  return !payload.result || payload.result === "0x" || payload.result === "0x0";
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

function buildScore(
  network: EvmNetwork,
  address: string,
  sourceSymbols: string[],
  summary: PnlSummary,
  rows: PnlRow[],
  eoa: boolean,
): WalletScore {
  const trades = Math.max(0, Math.trunc(numberValue(summary.total_count_of_trades)));
  const sells = Math.max(0, Math.trunc(numberValue(summary.total_sells)));
  const realized = numberValue(summary.total_realized_profit_usd);
  const roi = numberValue(summary.total_realized_profit_percentage);
  const closedRows = rows.filter(row => numberValue(row.total_sells) > 0 && !row.possible_spam);
  const profitableRows = closedRows.filter(row => numberValue(row.realized_profit_usd) > 0);
  const winRate = closedRows.length ? profitableRows.length / closedRows.length * 100 : 0;
  const positiveProfit = profitableRows.reduce((sum, row) => sum + numberValue(row.realized_profit_usd), 0);
  const largestProfit = profitableRows.reduce((max, row) => Math.max(max, numberValue(row.realized_profit_usd)), 0);
  const concentration = positiveProfit > 0 ? largestProfit / positiveProfit : 1;
  const avgTradesPerDay = trades / 30;

  const roiPoints = Math.min(25, Math.max(0, roi / 100 * 25));
  const profitPoints = Math.min(15, Math.max(0, Math.log10(Math.max(1, realized)) / 4 * 15));
  const winPoints = Math.min(15, Math.max(0, winRate / 100 * 15));
  const frequencyPoints = Math.min(10, avgTradesPerDay / 3 * 10);
  const consistencyPoints = Math.min(15, profitableRows.length * 2 + winRate / 20);
  const concentrationPenalty = concentration > 0.8 ? 12 : concentration > 0.65 ? 6 : 0;
  const score = eoa && sells > 0
    ? Math.max(0, Math.min(100, Math.round(roiPoints + profitPoints + winPoints + frequencyPoints + consistencyPoints - concentrationPenalty)))
    : 0;

  const warnings: string[] = [
    "ウォレット経過日数と最大ドローダウンは現在のEVMデータ範囲外（加点なし）",
    "勝率は30日間に決済した銘柄単位で算出",
    "含み損益は取得対象外",
  ];
  if (trades < 20) warnings.push("30日取引回数が20回未満");
  if (avgTradesPerDay < 1) warnings.push("1日平均取引回数が1回未満");
  if (profitableRows.length < 3) warnings.push("利益継続性の確認対象が少ない");
  if (concentration > 0.65) warnings.push("特定銘柄への利益集中");

  const blockers: string[] = [];
  if (!eoa) blockers.push("DEX・流動性プール・プログラムアドレス");
  if (sells === 0) blockers.push("売却履歴なし");
  if (score === 0 && blockers.length === 0) blockers.push("スコア0");

  const qualified = blockers.length === 0
    && roi >= 60
    && realized > 0
    && trades >= 20
    && winRate >= 60
    && profitableRows.length >= 2;

  return {
    network,
    address,
    sources: sourceSymbols,
    score,
    roi30d: Number(roi.toFixed(2)),
    realizedProfitUsd: Number(realized.toFixed(2)),
    unrealizedProfitUsd: null,
    winRate: Number(winRate.toFixed(2)),
    swaps30d: trades,
    activeTradingDays: 0,
    avgTradesPerDay: Number(avgTradesPerDay.toFixed(2)),
    sellEvents: sells,
    closedTrades: closedRows.length,
    ageDays: null,
    maxDrawdownPct: null,
    profitableWeeks: 0,
    evaluatedTransactions: trades,
    valuedEvents: rows.length,
    addable: blockers.length === 0,
    qualified,
    warnings,
    blockers,
    reasons: [...blockers, ...warnings],
    evaluatedAt: new Date().toISOString(),
  };
}

export async function scanProfitableEvmWallets(
  network: EvmNetwork,
  onProgress?: (progress: EvmScanProgress) => void | Promise<void>,
): Promise<WalletScanResponse> {
  const { moralisKey, rpcUrl } = requiredConfig(network);
  const chain = chainParam(network);
  const tokens = configuredTokens(network);
  const candidates = new Map<string, Set<string>>();

  await onProgress?.({
    phase: "DISCOVERING",
    message: `${network === "ETHEREUM" ? "Ethereum" : "Base"}の実トレーダーを収集中`,
    discoveredCandidates: 0,
    targetCandidates: 0,
    analyzedCandidates: 0,
    successfulAnalyses: 0,
  });

  for (const token of tokens) {
    const url = `${MORALIS_BASE}/erc20/${token}/top-gainers?chain=${chain}&days=30`;
    const payload = await fetchJson<{ symbol?: string; possible_spam?: boolean | string; result?: TopTrader[] }>(url, moralisKey);
    if (payload.possible_spam === true || payload.possible_spam === "true") continue;
    const symbol = payload.symbol?.trim() || `${token.slice(0, 6)}…${token.slice(-4)}`;
    for (const trader of payload.result ?? []) {
      const address = trader.address?.trim().toLowerCase();
      if (!address || !EVM_ADDRESS.test(address)) continue;
      const sources = candidates.get(address) ?? new Set<string>();
      sources.add(symbol);
      candidates.set(address, sources);
    }
  }

  const configuredLimit = Number(process.env.EVM_SCAN_ANALYSIS_LIMIT ?? "40");
  const analysisLimit = Number.isFinite(configuredLimit) ? Math.min(150, Math.max(10, configuredLimit)) : 40;
  const addresses = [...candidates.keys()].slice(0, analysisLimit);
  let analyzed = 0;
  let successful = 0;

  const evaluated = (await mapConcurrent(addresses, 3, async address => {
    try {
      const encodedAddress = encodeURIComponent(address);
      const query = `chain=${chain}&days=30`;
      const [summary, breakdown, eoa] = await Promise.all([
        fetchJson<PnlSummary>(`${MORALIS_BASE}/wallets/${encodedAddress}/profitability/summary?${query}`, moralisKey),
        fetchJson<{ result?: PnlRow[] }>(`${MORALIS_BASE}/wallets/${encodedAddress}/profitability?${query}`, moralisKey),
        isExternallyOwnedAccount(address, rpcUrl),
      ]);
      successful++;
      return buildScore(network, address, [...(candidates.get(address) ?? [])], summary, breakdown.result ?? [], eoa);
    } catch (error) {
      console.error("[NEXT-TRADE][evm.scan.analysis]", {
        network,
        address,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return null;
    } finally {
      analyzed++;
      await onProgress?.({
        phase: "ANALYZING",
        message: `${analyzed} / ${addresses.length}ウォレットを解析`,
        discoveredCandidates: candidates.size,
        targetCandidates: addresses.length,
        analyzedCandidates: analyzed,
        successfulAnalyses: successful,
      });
    }
  })).filter((score): score is WalletScore => score !== null);

  const rankingPool = evaluated.sort((a, b) =>
    b.avgTradesPerDay - a.avgTradesPerDay
    || b.winRate - a.winRate
    || b.score - a.score
    || b.realizedProfitUsd - a.realizedProfitUsd,
  );
  const top = rankingPool.slice(0, 10);
  return {
    network,
    source: "MORALIS_EVM_SCAN",
    scope: `${network === "ETHEREUM" ? "Ethereum" : "Base"}・Moralis 30日確定損益・${tokens.length}実トークン横断`,
    discoveredCandidates: candidates.size,
    scannedCandidates: addresses.length,
    successfulAnalyses: successful,
    qualified: top.filter(score => score.addable).slice(0, 5),
    evaluated: top,
    rankingPool,
    fetchedAt: new Date().toISOString(),
  };
}
