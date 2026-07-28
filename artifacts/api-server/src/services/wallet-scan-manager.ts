import { Prisma } from "@prisma/client";
import { databaseEnabled, prisma } from "../lib/prisma";
import type { WalletScanResponse, WalletScanState, WalletScore } from "../lib/live-types";
import { scanProfitableWallets, type WalletScanProgress } from "./solana-live";

const IDLE_STATE: WalletScanState = {
  id: null,
  status: "IDLE",
  phase: "IDLE",
  message: "保存済みランキングはありません",
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

type ScanRuntime = {
  state: WalletScanState;
  task: Promise<void> | null;
};

const runtimeRoot = globalThis as typeof globalThis & {
  nextTradeWalletScanRuntime?: ScanRuntime;
};

const runtime = runtimeRoot.nextTradeWalletScanRuntime ?? {
  state: { ...IDLE_STATE },
  task: null,
};
runtimeRoot.nextTradeWalletScanRuntime = runtime;

function jsonScore(score: WalletScore) {
  return score as unknown as Prisma.InputJsonValue;
}

function jsonResult(result: WalletScanResponse) {
  return result as unknown as Prisma.InputJsonValue;
}

function runToState(run: {
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

async function loadLatestState() {
  if (!prisma) return runtime.state;
  try {
    const [run, latestCompleted] = await Promise.all([
      prisma.walletScanRun.findFirst({ orderBy: { startedAt: "desc" } }),
      prisma.walletScanRun.findFirst({
        where: { status: "COMPLETED", result: { not: Prisma.JsonNull } },
        orderBy: { completedAt: "desc" },
      }),
    ]);
    if (!run) return runtime.state;
    if (run.status === "RUNNING" && !runtime.task) {
      const staleMs = Date.now() - run.updatedAt.getTime();
      if (staleMs > 10 * 60_000) {
        const failed = await prisma.walletScanRun.update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            phase: "FAILED",
            message: "プロセス再起動によりスキャンを中断しました。再実行してください",
            error: "Background scan heartbeat expired",
            completedAt: new Date(),
          },
        });
        const failedState = runToState(failed);
        if (!failedState.result && latestCompleted?.result) {
          failedState.result = latestCompleted.result as unknown as WalletScanResponse;
        }
        return failedState;
      }
    }
    const state = runToState(run);
    if (!state.result && latestCompleted?.result) {
      state.result = latestCompleted.result as unknown as WalletScanResponse;
    }
    return state;
  } catch (error) {
    console.error("[NEXT-TRADE][wallet.scan.db.load]", error);
    return { ...runtime.state, databaseEnabled: false };
  }
}

export async function getWalletScanState() {
  if (runtime.task) return runtime.state;
  runtime.state = await loadLatestState();
  return runtime.state;
}

async function saveScores(scores: WalletScore[], rankingEligible = false) {
  if (!prisma || scores.length === 0) return;
  const db = prisma;
  const analyzedAt = new Date();
  await db.$transaction(scores.map(score =>
    db.walletAnalysisCache.upsert({
      where: { address: score.address },
      create: {
        address: score.address,
        score: jsonScore(score),
        sources: score.sources,
        rankingEligible,
        lastSeenAt: analyzedAt,
        lastAnalyzedAt: analyzedAt,
      },
      update: {
        score: jsonScore(score),
        sources: score.sources,
        ...(rankingEligible ? { rankingEligible: true } : {}),
        lastSeenAt: analyzedAt,
        lastAnalyzedAt: analyzedAt,
      },
    }),
  ));
}

function rankScores(scores: WalletScore[]) {
  return [...scores].sort((a, b) =>
    b.score - a.score
    || b.avgTradesPerDay - a.avgTradesPerDay
    || b.activeTradingDays - a.activeTradingDays
    || b.realizedProfitUsd - a.realizedProfitUsd
    || a.address.localeCompare(b.address),
  );
}

async function mergeWithCachedRanking(result: WalletScanResponse) {
  if (!prisma) return result;
  const configuredHours = Number(process.env.WALLET_SCAN_CACHE_MAX_AGE_HOURS ?? "168");
  const maxAgeHours = Number.isFinite(configuredHours) ? Math.max(24, configuredHours) : 168;
  const rows = await prisma.walletAnalysisCache.findMany({
    where: {
      rankingEligible: true,
      lastAnalyzedAt: { gte: new Date(Date.now() - maxAgeHours * 3_600_000) },
    },
    orderBy: { lastAnalyzedAt: "desc" },
    take: 5_000,
  });
  const scores = new Map<string, WalletScore>();
  for (const row of rows) {
    const score = row.score as unknown as WalletScore;
    if (score && typeof score.address === "string" && Number.isFinite(score.score)) {
      scores.set(score.address, score);
    }
  }
  for (const score of result.evaluated) scores.set(score.address, score);
  const evaluated = rankScores([...scores.values()]).slice(0, 10);
  return {
    ...result,
    scope: `${result.scope}・直近${maxAgeHours}時間のDB蓄積${scores.size}件を統合`,
    evaluated,
    qualified: evaluated.filter(score => score.addable).slice(0, 5),
  };
}

export async function startWalletScan() {
  const current = await getWalletScanState();
  if (runtime.task || current.status === "RUNNING") return current;

  const startedAt = new Date();
  let runId: string = crypto.randomUUID();
  if (prisma) {
    const run = await prisma.walletScanRun.create({
      data: {
        status: "RUNNING",
        phase: "DISCOVERING",
        message: "バックグラウンドスキャンを開始しました",
      },
    });
    runId = run.id;
  }

  runtime.state = {
    ...IDLE_STATE,
    result: current.result,
    completedAt: current.completedAt,
    id: runId,
    status: "RUNNING",
    phase: "DISCOVERING",
    message: "バックグラウンドスキャンを開始しました",
    startedAt: startedAt.toISOString(),
    databaseEnabled: databaseEnabled(),
  };

  runtime.task = runBackgroundScan(runId).finally(() => {
    runtime.task = null;
  });
  return runtime.state;
}

async function runBackgroundScan(runId: string) {
  const scoreBuffer: WalletScore[] = [];
  let lastProgressWrite = 0;

  const flushScores = async () => {
    if (scoreBuffer.length === 0) return;
    const scores = scoreBuffer.splice(0, scoreBuffer.length);
    try {
      await saveScores(scores);
    } catch (error) {
      console.error("[NEXT-TRADE][wallet.scan.db.scores]", error);
    }
  };

  const updateProgress = async (progress: WalletScanProgress) => {
    runtime.state = {
      ...runtime.state,
      ...progress,
      status: "RUNNING",
      error: null,
    };
    const now = Date.now();
    if (!prisma || now - lastProgressWrite < 2_000) return;
    lastProgressWrite = now;
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
    }).catch(error => console.error("[NEXT-TRADE][wallet.scan.db.progress]", error));
  };

  try {
    const scanResult = await scanProfitableWallets({
      onProgress: updateProgress,
      onAnalyzed: async score => {
        scoreBuffer.push(score);
        if (scoreBuffer.length >= 20) await flushScores();
      },
    });
    await flushScores();
    await saveScores(scanResult.evaluated, true);
    const result = await mergeWithCachedRanking(scanResult);
    const completedAt = new Date();
    runtime.state = {
      ...runtime.state,
      status: "COMPLETED",
      phase: "COMPLETED",
      message: `${result.scannedCandidates}件の解析が完了しました`,
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
          result: jsonResult(result),
          completedAt,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = new Date();
    console.error("[NEXT-TRADE][wallet.scan.background]", {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    runtime.state = {
      ...runtime.state,
      status: "FAILED",
      phase: "FAILED",
      message: "バックグラウンドスキャンに失敗しました",
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
      }).catch(dbError => console.error("[NEXT-TRADE][wallet.scan.db.failure]", dbError));
    }
  }
}

export async function ensureFreshWalletScan() {
  const state = await getWalletScanState();
  const configuredHours = Number(process.env.WALLET_SCAN_AUTO_REFRESH_HOURS ?? "24");
  const refreshHours = Number.isFinite(configuredHours) ? Math.max(0, configuredHours) : 24;
  if (refreshHours === 0 || state.status === "RUNNING") return state;
  const reference = state.completedAt ?? state.startedAt;
  const stale = !reference || Date.now() - new Date(reference).getTime() >= refreshHours * 3_600_000;
  return stale ? startWalletScan() : state;
}
