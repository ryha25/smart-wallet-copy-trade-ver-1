import { Prisma } from "@prisma/client";
import { databaseEnabled, prisma } from "../lib/prisma";
import type { WalletScanResponse, WalletScanState, WalletScore } from "../lib/live-types";
import { scanProfitableEvmWallets, type EvmNetwork, type EvmScanProgress } from "./evm-live";

type Runtime = {
  state: WalletScanState;
  task: Promise<void> | null;
  scheduler: ReturnType<typeof setInterval> | null;
};

const runtimeRoot = globalThis as typeof globalThis & {
  nextTradeEvmScanRuntimes?: Partial<Record<EvmNetwork, Runtime>>;
};
const runtimes = runtimeRoot.nextTradeEvmScanRuntimes ?? {};
runtimeRoot.nextTradeEvmScanRuntimes = runtimes;

function idleState(network: EvmNetwork): WalletScanState {
  return {
    network,
    id: null,
    status: "IDLE",
    phase: "IDLE",
    message: `${network === "ETHEREUM" ? "Ethereum" : "Base"}の保存済みランキングはありません`,
    discoveredCandidates: 0,
    targetCandidates: 0,
    analyzedCandidates: 0,
    successfulAnalyses: 0,
    startedAt: null,
    completedAt: null,
    databaseEnabled: databaseEnabled(),
    result: null,
    error: null,
  };
}

function runtimeFor(network: EvmNetwork) {
  return runtimes[network] ??= { state: idleState(network), task: null, scheduler: null };
}

function runToState(network: EvmNetwork, run: {
  id: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  phase: string;
  message: string;
  discoveredCandidates: number;
  targetCandidates: number;
  analyzedCandidates: number;
  successfulAnalyses: number;
  result: Prisma.JsonValue | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}): WalletScanState {
  return {
    network,
    id: run.id,
    status: run.status,
    phase: run.phase as WalletScanState["phase"],
    message: run.message,
    discoveredCandidates: run.discoveredCandidates,
    targetCandidates: run.targetCandidates,
    analyzedCandidates: run.analyzedCandidates,
    successfulAnalyses: run.successfulAnalyses,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    databaseEnabled: databaseEnabled(),
    result: run.result as WalletScanResponse | null,
    error: run.error,
  };
}

export function parseEvmNetwork(value: string | null): EvmNetwork {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "ETHEREUM" || normalized === "BASE") return normalized;
  throw new Error("networkはETHEREUMまたはBASEを指定してください");
}

export async function getEvmScanState(network: EvmNetwork) {
  const runtime = runtimeFor(network);
  if (runtime.task || !prisma) return runtime.state;
  try {
    const [latest, completed] = await Promise.all([
      prisma.walletScanRun.findFirst({ where: { network }, orderBy: { startedAt: "desc" } }),
      prisma.walletScanRun.findFirst({
        where: { network, status: "COMPLETED", result: { not: Prisma.JsonNull } },
        orderBy: { completedAt: "desc" },
      }),
    ]);
    if (!latest) return runtime.state;
    const state = runToState(network, latest);
    if (!state.result && completed?.result) state.result = completed.result as unknown as WalletScanResponse;
    if (latest.status === "RUNNING" && Date.now() - latest.updatedAt.getTime() > 10 * 60_000) {
      const failed = await prisma.walletScanRun.update({
        where: { id: latest.id },
        data: {
          status: "FAILED",
          phase: "FAILED",
          message: "プロセス再起動によりEVMスキャンが中断されました。再実行してください",
          error: "Background scan heartbeat expired",
          completedAt: new Date(),
        },
      });
      runtime.state = runToState(network, failed);
      runtime.state.result = state.result;
      return runtime.state;
    }
    runtime.state = state;
    return state;
  } catch (error) {
    console.error("[NEXT-TRADE][evm.scan.db.load]", error);
    return { ...runtime.state, databaseEnabled: false };
  }
}

async function saveScores(network: EvmNetwork, scores: WalletScore[]) {
  if (!prisma || scores.length === 0) return;
  const db = prisma;
  const analyzedAt = new Date();
  await db.$transaction(scores.map(score => db.walletAnalysisCache.upsert({
    where: { network_address: { network, address: score.address } },
    create: {
      network,
      address: score.address,
      score: score as unknown as Prisma.InputJsonValue,
      sources: score.sources,
      rankingEligible: true,
      lastSeenAt: analyzedAt,
      lastAnalyzedAt: analyzedAt,
    },
    update: {
      score: score as unknown as Prisma.InputJsonValue,
      sources: score.sources,
      rankingEligible: true,
      lastSeenAt: analyzedAt,
      lastAnalyzedAt: analyzedAt,
    },
  })));
}

async function mergeCached(network: EvmNetwork, result: WalletScanResponse) {
  if (!prisma) return result;
  const hours = Math.max(24, Number(process.env.WALLET_SCAN_CACHE_MAX_AGE_HOURS ?? "168") || 168);
  const rows = await prisma.walletAnalysisCache.findMany({
    where: {
      network,
      rankingEligible: true,
      lastAnalyzedAt: { gte: new Date(Date.now() - hours * 3_600_000) },
    },
    orderBy: { lastAnalyzedAt: "desc" },
    take: 2_000,
  });
  const scores = new Map<string, WalletScore>();
  for (const row of rows) scores.set(row.address, row.score as unknown as WalletScore);
  for (const score of result.rankingPool ?? result.evaluated) scores.set(score.address, score);
  const rankingPool = [...scores.values()].sort((a, b) =>
    b.avgTradesPerDay - a.avgTradesPerDay
    || b.winRate - a.winRate
    || b.score - a.score
    || b.realizedProfitUsd - a.realizedProfitUsd,
  );
  const evaluated = rankingPool.slice(0, 10);
  return {
    ...result,
    scope: `${result.scope}・直近${hours}時間のDB蓄積${scores.size}件を統合`,
    rankingPool,
    evaluated,
    qualified: evaluated.filter(score => score.addable).slice(0, 5),
  };
}

export async function startEvmScan(network: EvmNetwork) {
  const runtime = runtimeFor(network);
  const current = await getEvmScanState(network);
  if (runtime.task || current.status === "RUNNING") return current;

  const startedAt = new Date();
  let runId: string = crypto.randomUUID();
  if (prisma) {
    const run = await prisma.walletScanRun.create({
      data: {
        network,
        status: "RUNNING",
        phase: "DISCOVERING",
        message: `${network === "ETHEREUM" ? "Ethereum" : "Base"}スキャンを開始しました`,
      },
    });
    runId = run.id;
  }
  runtime.state = {
    ...idleState(network),
    id: runId,
    status: "RUNNING",
    phase: "DISCOVERING",
    message: `${network === "ETHEREUM" ? "Ethereum" : "Base"}の実データ候補を収集中`,
    startedAt: startedAt.toISOString(),
    result: current.result,
    completedAt: current.completedAt,
  };
  runtime.task = runBackground(network, runId).finally(() => { runtime.task = null; });
  return runtime.state;
}

async function runBackground(network: EvmNetwork, runId: string) {
  const runtime = runtimeFor(network);
  let lastWrite = 0;
  const onProgress = async (progress: EvmScanProgress) => {
    runtime.state = { ...runtime.state, ...progress, status: "RUNNING", error: null };
    if (!prisma || Date.now() - lastWrite < 2_000) return;
    lastWrite = Date.now();
    await prisma.walletScanRun.update({
      where: { id: runId },
      data: {
        phase: progress.phase,
        message: progress.message,
        discoveredCandidates: progress.discoveredCandidates,
        targetCandidates: progress.targetCandidates,
        analyzedCandidates: progress.analyzedCandidates,
        successfulAnalyses: progress.successfulAnalyses,
      },
    }).catch(error => console.error("[NEXT-TRADE][evm.scan.db.progress]", error));
  };

  try {
    const scanned = await scanProfitableEvmWallets(network, onProgress);
    await saveScores(network, scanned.rankingPool ?? scanned.evaluated);
    const result = await mergeCached(network, scanned);
    const completedAt = new Date();
    runtime.state = {
      ...runtime.state,
      status: "COMPLETED",
      phase: "COMPLETED",
      message: `${result.scannedCandidates}件のEVMウォレット解析が完了しました`,
      discoveredCandidates: result.discoveredCandidates,
      targetCandidates: result.scannedCandidates,
      analyzedCandidates: result.scannedCandidates,
      successfulAnalyses: result.successfulAnalyses,
      completedAt: completedAt.toISOString(),
      result,
      error: null,
    };
    if (prisma) {
      await prisma.walletScanRun.update({
        where: { id: runId },
        data: {
          status: "COMPLETED",
          phase: "COMPLETED",
          message: runtime.state.message,
          discoveredCandidates: result.discoveredCandidates,
          targetCandidates: result.scannedCandidates,
          analyzedCandidates: result.scannedCandidates,
          successfulAnalyses: result.successfulAnalyses,
          result: result as unknown as Prisma.InputJsonValue,
          completedAt,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = new Date();
    console.error("[NEXT-TRADE][evm.scan.background]", {
      network,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    runtime.state = {
      ...runtime.state,
      status: "FAILED",
      phase: "FAILED",
      message: `${network === "ETHEREUM" ? "Ethereum" : "Base"}スキャンに失敗しました`,
      completedAt: completedAt.toISOString(),
      error: message,
    };
    if (prisma) {
      await prisma.walletScanRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          phase: "FAILED",
          message: runtime.state.message,
          error: message.slice(0, 4_000),
          completedAt,
        },
      }).catch(dbError => console.error("[NEXT-TRADE][evm.scan.db.failure]", dbError));
    }
  }
}

export async function ensureFreshEvmScan(network: EvmNetwork) {
  const state = await getEvmScanState(network);
  const refreshHours = Math.max(0, Number(process.env.EVM_SCAN_AUTO_REFRESH_HOURS ?? "6") || 0);
  if (refreshHours === 0 || state.status === "RUNNING") return state;
  const reference = state.completedAt ?? state.startedAt;
  return !reference || Date.now() - new Date(reference).getTime() >= refreshHours * 3_600_000
    ? startEvmScan(network)
    : state;
}

export function installEvmScanScheduler(network: EvmNetwork) {
  const runtime = runtimeFor(network);
  if (runtime.scheduler || Number(process.env.EVM_SCAN_AUTO_REFRESH_HOURS ?? "6") === 0) return;
  runtime.scheduler = setInterval(() => {
    void ensureFreshEvmScan(network).catch(error => console.error("[NEXT-TRADE][evm.scan.scheduler]", error));
  }, 5 * 60_000);
  runtime.scheduler.unref?.();
}
