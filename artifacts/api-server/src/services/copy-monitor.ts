import { Prisma } from "@prisma/client";
import { defaultSettings } from "../lib/default-settings";
import { evaluateCopySignal, evaluatePositionExit } from "../lib/paper-trading";
import { prisma } from "../lib/prisma";
import type { CopyMonitorStatus, LiveTokenQuote, LiveWalletEvent } from "../lib/live-types";
import type { CopySettings } from "../lib/types";
import {
  executeLiveSwap,
  getLiveTokenRawBalance,
  getLiveTradingStatus,
  getMintDecimals,
  SOL_MINT,
  USDC_MINT,
} from "./live-trading";
import { getLiveWalletActivity, getTokenQuotes, getTokenRisk } from "./solana-live";

async function getSolPriceUsd(): Promise<number> {
  const quotes = await getTokenQuotes([SOL_MINT]);
  const sol = quotes.get(SOL_MINT);
  if (!sol?.priceUsd || sol.priceUsd <= 0) throw new Error("SOL価格を取得できません");
  return sol.priceUsd;
}

type MonitorRuntime = {
  running: boolean;
  timer: ReturnType<typeof setInterval> | null;
  lastCycleAt: string | null;
  monitoredWallets: number;
  manualWallets: number;
  autoWallets: number;
  favoriteWallets: number;
  newBuyCount: number;
  createdPositions: number;
  skippedTrades: number;
  lastError: string | null;
  lastBalanceReconcileAt: number;
  // position monitor
  positionTimer: ReturnType<typeof setInterval> | null;
  positionRunning: boolean;
  lastPositionCycleAt: string | null;
  monitoredPositions: number;
  positionLastError: string | null;
};

const runtimeRoot = globalThis as typeof globalThis & {
  nextTradeCopyMonitor?: MonitorRuntime;
};

const runtime = runtimeRoot.nextTradeCopyMonitor ?? {
  running: false,
  timer: null,
  lastCycleAt: null,
  monitoredWallets: 0,
  manualWallets: 0,
  autoWallets: 0,
  favoriteWallets: 0,
  newBuyCount: 0,
  createdPositions: 0,
  skippedTrades: 0,
  lastError: null,
  lastBalanceReconcileAt: 0,
  positionTimer: null,
  positionRunning: false,
  lastPositionCycleAt: null,
  monitoredPositions: 0,
  positionLastError: null,
};
runtimeRoot.nextTradeCopyMonitor = runtime;

export async function ensureAppUser() {
  if (!prisma) throw new Error("DATABASE_URLが未設定のためコピー監視を永続化できません");
  const loginName = process.env.APP_USERNAME?.trim() || "next-trade";
  return prisma.user.upsert({
    where: { loginName },
    create: { loginName, displayName: loginName },
    update: { displayName: loginName },
  });
}

function dbSettingsToClient(settings: {
  enabled: boolean;
  liveTradingEnabled: boolean;
  amountPerTradeUsd: Prisma.Decimal;
  maxPositions: number;
  maxDailyAmountUsd: Prisma.Decimal;
  stopLossEnabled: boolean;
  stopLossPercent: Prisma.Decimal;
  takeProfitEnabled: boolean;
  takeProfitPercent: Prisma.Decimal;
  maxSlippagePercent: Prisma.Decimal;
  allowDuplicateToken: boolean;
  maxDetectionSeconds: number;
  maxPriceRiseEnabled: boolean;
  maxPriceRisePercent: Prisma.Decimal;
}): CopySettings {
  return {
    enabled: settings.enabled,
    liveTradingEnabled: settings.liveTradingEnabled,
    amountPerTrade: Number(settings.amountPerTradeUsd),
    maxPositions: settings.maxPositions,
    maxDailyAmount: Number(settings.maxDailyAmountUsd),
    stopLossEnabled: settings.stopLossEnabled,
    stopLoss: Number(settings.stopLossPercent),
    takeProfitEnabled: settings.takeProfitEnabled,
    takeProfit: Number(settings.takeProfitPercent),
    maxSlippage: Number(settings.maxSlippagePercent),
    allowDuplicate: settings.allowDuplicateToken,
    maxDetectionSeconds: settings.maxDetectionSeconds,
    maxPriceRiseEnabled: settings.maxPriceRiseEnabled,
    maxPriceRise: Number(settings.maxPriceRisePercent),
  };
}

export async function getOrCreateCopySettings() {
  if (!prisma) return defaultSettings;
  const user = await ensureAppUser();
  const settings = await prisma.copySettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      enabled: defaultSettings.enabled,
      liveTradingEnabled: defaultSettings.liveTradingEnabled,
      amountPerTradeUsd: defaultSettings.amountPerTrade,
      maxPositions: defaultSettings.maxPositions,
      maxDailyAmountUsd: defaultSettings.maxDailyAmount,
      stopLossEnabled: defaultSettings.stopLossEnabled,
      stopLossPercent: defaultSettings.stopLoss,
      takeProfitEnabled: defaultSettings.takeProfitEnabled,
      takeProfitPercent: defaultSettings.takeProfit,
      maxSlippagePercent: defaultSettings.maxSlippage,
      maxWallets: 15,
      allowDuplicateToken: defaultSettings.allowDuplicate,
      favoritesOnly: false,
      maxDetectionSeconds: defaultSettings.maxDetectionSeconds,
      maxPriceRiseEnabled: defaultSettings.maxPriceRiseEnabled,
      maxPriceRisePercent: defaultSettings.maxPriceRise,
    },
    update: {},
  });
  return dbSettingsToClient(settings);
}

export async function saveCopySettings(settings: CopySettings) {
  if (!prisma) throw new Error("DATABASE_URLが未設定です");
  if (settings.liveTradingEnabled) {
    const status = await getLiveTradingStatus();
    if (!status.ready) throw new Error(`実売買を開始できません: ${status.error ?? "Replit Secretsを確認してください"}`);
  }
  const user = await ensureAppUser();
  const saved = await prisma.copySettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      enabled: settings.enabled,
      liveTradingEnabled: settings.liveTradingEnabled,
      amountPerTradeUsd: settings.amountPerTrade,
      maxPositions: settings.maxPositions,
      maxDailyAmountUsd: settings.maxDailyAmount,
      stopLossEnabled: settings.stopLossEnabled,
      stopLossPercent: settings.stopLoss,
      takeProfitEnabled: settings.takeProfitEnabled,
      takeProfitPercent: settings.takeProfit,
      maxSlippagePercent: settings.maxSlippage,
      maxWallets: 15,
      allowDuplicateToken: settings.allowDuplicate,
      favoritesOnly: false,
      maxDetectionSeconds: settings.maxDetectionSeconds,
      maxPriceRiseEnabled: settings.maxPriceRiseEnabled,
      maxPriceRisePercent: settings.maxPriceRise,
    },
    update: {
      enabled: settings.enabled,
      liveTradingEnabled: settings.liveTradingEnabled,
      amountPerTradeUsd: settings.amountPerTrade,
      maxPositions: settings.maxPositions,
      maxDailyAmountUsd: settings.maxDailyAmount,
      stopLossEnabled: settings.stopLossEnabled,
      stopLossPercent: settings.stopLoss,
      takeProfitEnabled: settings.takeProfitEnabled,
      takeProfitPercent: settings.takeProfit,
      maxSlippagePercent: settings.maxSlippage,
      allowDuplicateToken: settings.allowDuplicate,
      maxDetectionSeconds: settings.maxDetectionSeconds,
      maxPriceRiseEnabled: settings.maxPriceRiseEnabled,
      maxPriceRisePercent: settings.maxPriceRise,
    },
  });
  return dbSettingsToClient(saved);
}

async function logEvent(event: string, message: string, metadata?: Prisma.InputJsonValue, persist = false) {
  console.info(`[NEXT-TRADE][copy.monitor.${event}]`, message, metadata ?? "");
  if (!prisma || !persist) return;
  await prisma.systemLog.create({
    data: { level: "INFO", service: "copy-monitor", event, message, metadata },
  }).catch(error => console.error("[NEXT-TRADE][copy.monitor.log]", error));
}

function latestSignature(events: LiveWalletEvent[]) {
  return [...events].sort((a, b) => b.blockTime - a.blockTime)[0]?.signature ?? null;
}

function eventsAfterMarker(events: LiveWalletEvent[], marker: string) {
  const ordered = [...events].sort((a, b) => b.blockTime - a.blockTime);
  const markerIndex = ordered.findIndex(event => event.signature === marker);
  // markerIndex < 0 means the marker is older than our fetch window (wallet is very active).
  // Treat all fetched events as new — processBuy/skipTrade use upsert so duplicates are safe.
  return markerIndex < 0 ? ordered : ordered.slice(0, markerIndex);
}

async function skipTrade(
  userId: string,
  walletId: string,
  event: LiveWalletEvent,
  reason: string,
) {
  if (!prisma) return;
  await prisma.skippedTrade.upsert({
    where: {
      sourceWalletId_sourceSignature_tokenMint: {
        sourceWalletId: walletId,
        sourceSignature: event.signature,
        tokenMint: event.mint,
      },
    },
    create: {
      userId,
      sourceWalletId: walletId,
      sourceSignature: event.signature,
      tokenMint: event.mint,
      tokenSymbol: event.current?.symbol,
      detectedAt: new Date(),
      sourceBoughtAt: new Date(event.blockTime * 1000),
      reasonCode: reason,
      reasonDetail: reason,
      signalSnapshot: {
        signature: event.signature,
        sourcePriceUsd: event.sourcePriceUsd,
        currentPriceUsd: event.current?.priceUsd ?? null,
      },
    },
    update: { reasonCode: reason, reasonDetail: reason },
  });
  runtime.skippedTrades++;
  await logEvent("skipped", `見送り: ${reason}`, {
    walletId,
    signature: event.signature,
    mint: event.mint,
    reason,
  }, true);
}

async function processBuy(
  userId: string,
  wallet: { id: string; address: string; isCopyEnabled: boolean },
  event: LiveWalletEvent,
  settings: CopySettings,
) {
  if (!prisma) return;
  runtime.newBuyCount++;
  await logEvent("buy.detected", "新規BUYを検知", {
    wallet: wallet.address,
    signature: event.signature,
    mint: event.mint,
  });

  if (!event.current || event.current.priceUsd <= 0) {
    await skipTrade(userId, wallet.id, event, "現在価格を取得できない");
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [openPositions, dailyTrades, existingPosition] = await Promise.all([
    prisma.paperPosition.count({ where: { userId, status: "OPEN" } }),
    prisma.paperPosition.aggregate({
      where: { userId, copiedAt: { gte: today } },
      _sum: { amountUsd: true },
    }),
    prisma.paperPosition.findFirst({
      where: { userId, tokenMint: event.mint, status: "OPEN" },
      select: { id: true },
    }),
  ]);
  const delaySeconds = Math.max(0, Math.floor(Date.now() / 1000 - event.blockTime));
  const decision = evaluateCopySignal({
    sourcePrice: event.sourcePriceUsd,
    currentPrice: event.current.priceUsd,
    detectedAfterSeconds: delaySeconds,
  }, settings, {
    openPositions,
    spentTodayUsd: Number(dailyTrades._sum.amountUsd ?? 0),
    alreadyHolding: Boolean(existingPosition),
    walletEnabled: wallet.isCopyEnabled,
  });

  if (!decision.accepted) {
    await skipTrade(userId, wallet.id, event, decision.reason ?? "コピー条件外");
    return;
  }

  try {
    const risk = await getTokenRisk(event.mint);
    if (!risk.safe) {
      await skipTrade(userId, wallet.id, event, `危険トークン: ${risk.risks.slice(0, 3).join("・")}`);
      return;
    }
  } catch (error) {
    await skipTrade(userId, wallet.id, event, `危険判定失敗: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const sourcePrice = event.sourcePriceUsd ?? event.current.priceUsd;
  let amountUsd = settings.amountPerTrade;
  let quantity = settings.amountPerTrade / event.current.priceUsd;
  let copyPriceUsd = event.current.priceUsd;
  let executionMode: "PAPER" | "LIVE" = "PAPER";
  let rawTokenAmount: string | null = null;
  let tokenDecimals: number | null = null;
  let buySignature: string | null = null;
  if (settings.liveTradingEnabled) {
    try {
      tokenDecimals = await getMintDecimals(event.mint);
      const swap = await executeLiveSwap({
        idempotencyKey: `BUY:${wallet.id}:${event.signature}:${event.mint}`,
        userId, sourceWalletId: wallet.id, side: "BUY", inputMint: USDC_MINT, outputMint: event.mint,
        inputAmount: String(Math.round(settings.amountPerTrade * 1_000_000)),
        maxSlippagePercent: settings.maxSlippage,
      });
      rawTokenAmount = swap.outputAmount;
      quantity = Number(swap.outputAmount) / 10 ** tokenDecimals;
      amountUsd = Number(swap.inputAmount) / 1_000_000;
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Jupiterの受取数量が不正です");
      copyPriceUsd = amountUsd / quantity;
      executionMode = "LIVE";
      buySignature = swap.signature;
    } catch (error) {
      await skipTrade(userId, wallet.id, event, `実売買失敗: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }
  const slippage = sourcePrice > 0 ? Math.abs(copyPriceUsd - sourcePrice) / sourcePrice * 100 : 0;
  await prisma.paperPosition.upsert({
    where: {
      sourceWalletId_sourceSignature_tokenMint: {
        sourceWalletId: wallet.id,
        sourceSignature: event.signature,
        tokenMint: event.mint,
      },
    },
    create: {
      userId,
      sourceWalletId: wallet.id,
      sourceSignature: event.signature,
      tokenMint: event.mint,
      tokenSymbol: event.current.symbol,
      sourceBoughtAt: new Date(event.blockTime * 1000),
      copiedAt: new Date(),
      detectionDelayMs: delaySeconds * 1000,
      sourcePriceUsd: sourcePrice,
      copyPriceUsd,
      slippagePercent: slippage,
      amountUsd,
      amountSol: 0,
      quantity,
      executionMode,
      rawTokenAmount,
      tokenDecimals,
      buySignature,
      status: "OPEN",
    },
    update: {},
  });
  runtime.createdPositions++;
  await logEvent("copy.created", executionMode === "LIVE" ? "実売買ポジションを作成" : "ペーパートレードを作成", {
    wallet: wallet.address,
    signature: event.signature,
    mint: event.mint,
    amountUsd,
    copyPriceUsd,
    executionMode,
    buySignature,
  }, true);
}

export async function forceClosePositionById(positionId: string) {
  if (!prisma) throw new Error("DATABASE_URLが未設定です");
  const position = await prisma.paperPosition.findUniqueOrThrow({ where: { id: positionId }, include: { sourceWallet: true } });
  if (position.status !== "OPEN") return position;
  let exitPrice = Number(position.copyPriceUsd);
  try {
    const { getTokenQuotes } = await import("./solana-live");
    const quotes = await getTokenQuotes([position.tokenMint], { verbose: false });
    const q = quotes.get(position.tokenMint);
    if (q?.priceUsd && q.priceUsd > 0) exitPrice = q.priceUsd;
  } catch { /* best-effort */ }
  const pnlUsd = Number(position.quantity) * exitPrice - Number(position.amountUsd);
  const pnlPercent = (exitPrice / Number(position.copyPriceUsd) - 1) * 100;
  const updated = await prisma.paperPosition.update({
    where: { id: position.id },
    data: { status: "CLOSED", exitPriceUsd: exitPrice, closedAt: new Date(), pnlUsd, pnlPercent, pnlSol: 0, settlementReason: "MANUAL", rawTokenAmount: null },
  });
  await logEvent("copy.force-closed", "ポジション強制CLOSED", {
    positionId, mint: position.tokenMint, exitPrice, pnlUsd,
  }, true);
  return updated;
}

export async function settlePositionById(
  positionId: string,
  settlementReason: "SOURCE_SOLD" | "TAKE_PROFIT" | "STOP_LOSS" | "MANUAL" | "MAX_HOLDING_TIME" | "RISK_DETECTED",
  quotedExitPrice?: number,
) {
  if (!prisma) throw new Error("DATABASE_URLが未設定です");
  const position = await prisma.paperPosition.findUniqueOrThrow({ where: { id: positionId }, include: { sourceWallet: true } });
  if (position.status !== "OPEN") return position;
  let exitPrice = quotedExitPrice;
  let pnlUsd: number;
  let sellSignature: string | undefined;
  if (position.executionMode === "LIVE") {
    if (!position.rawTokenAmount) throw new Error("実売買ポジションのトークン数量が保存されていません");
    const settings = await getOrCreateCopySettings();
    try {
      const swap = await executeLiveSwap({
        idempotencyKey: `SELL:${position.id}`, userId: position.userId, sourceWalletId: position.sourceWalletId,
        paperPositionId: position.id, side: "SELL", inputMint: position.tokenMint, outputMint: USDC_MINT,
        inputAmount: position.rawTokenAmount, maxSlippagePercent: settings.maxSlippage,
      });
      const proceedsUsd = Number(swap.outputAmount) > 0
        ? Number(swap.outputAmount) / 1_000_000
        : (quotedExitPrice ?? 0) * Number(position.quantity);
      exitPrice = proceedsUsd / Number(position.quantity);
      pnlUsd = proceedsUsd - Number(position.amountUsd);
      sellSignature = swap.signature;
    } catch (swapError) {
      // トークン残高が0の場合（ゴーストポジション）は強制CLOSEDにする
      const msg = swapError instanceof Error ? swapError.message : String(swapError);
      if (msg.includes("Insufficient funds") || msg.includes("insufficient")) {
        await logEvent("copy.ghost-closed", "残高0のゴーストポジションを強制CLOSED", { positionId, mint: position.tokenMint }, true);
        return prisma.paperPosition.update({
          where: { id: position.id },
          data: { status: "CLOSED", closedAt: new Date(), exitPriceUsd: quotedExitPrice ?? Number(position.copyPriceUsd), pnlUsd: 0, pnlPercent: 0, pnlSol: 0, settlementReason: "MANUAL", rawTokenAmount: null },
        });
      }
      throw swapError;
    }
  } else {
    if (!exitPrice || exitPrice <= 0) throw new Error("ペーパートレードの決済価格を取得できません");
    pnlUsd = Number(position.quantity) * exitPrice - Number(position.amountUsd);
  }
  if (!exitPrice || !Number.isFinite(exitPrice) || exitPrice <= 0) throw new Error("決済価格が不正です");
  const pnlPercent = pnlUsd / Number(position.amountUsd) * 100;
  const updated = await prisma.paperPosition.update({ where: { id: position.id }, data: {
    status: "CLOSED", closedAt: new Date(), exitPriceUsd: exitPrice, pnlPercent, pnlUsd, pnlSol: 0,
    sellSignature, settlementReason,
  } });
  await logEvent("copy.closed", position.executionMode === "LIVE" ? "実売買ポジションを決済" : "ペーパートレードを決済", {
    wallet: position.sourceWallet.address, positionId: position.id, mint: position.tokenMint,
    executionMode: position.executionMode, settlementReason, sellSignature, pnlPercent, pnlUsd,
  }, true);
  return updated;
}

async function processSell(
  wallet: { id: string; address: string },
  event: LiveWalletEvent,
) {
  if (!prisma) return;
  const exitPrice = event.current?.priceUsd ?? event.sourcePriceUsd;
  if (!exitPrice || exitPrice <= 0) return;
  const positions = await prisma.paperPosition.findMany({
    where: { sourceWalletId: wallet.id, tokenMint: event.mint, status: "OPEN" },
  });
  for (const position of positions) {
    await settlePositionById(position.id, "SOURCE_SOLD", exitPrice);
  }
}

async function applyAutomaticExits(
  wallet: { id: string; address: string },
  events: LiveWalletEvent[],
  settings: CopySettings,
) {
  if (!prisma || (!settings.takeProfitEnabled && !settings.stopLossEnabled)) return;
  const latestPriceByMint = new Map<string, number>();
  for (const event of [...events].sort((a, b) => b.blockTime - a.blockTime)) {
    const price = event.current?.priceUsd;
    if (price && price > 0 && !latestPriceByMint.has(event.mint)) {
      latestPriceByMint.set(event.mint, price);
    }
  }

  const positions = await prisma.paperPosition.findMany({
    where: { sourceWalletId: wallet.id, status: "OPEN" },
  });
  for (const position of positions) {
    const currentPrice = latestPriceByMint.get(position.tokenMint);
    if (!currentPrice) continue;
    const entryPrice = Number(position.copyPriceUsd);
    const pnlPercent = (currentPrice - entryPrice) / entryPrice * 100;
    const reason =
      settings.takeProfitEnabled && pnlPercent >= settings.takeProfit
        ? "TAKE_PROFIT"
        : settings.stopLossEnabled && pnlPercent <= -settings.stopLoss
          ? "STOP_LOSS"
          : null;
    if (!reason) continue;

    await settlePositionById(position.id, reason, currentPrice);
  }
}

async function monitorWallet(
  userId: string,
  wallet: {
    id: string;
    address: string;
    origin: string;
    isCopyEnabled: boolean;
    isBlocked: boolean;
    lastObservedSignature: string | null;
  },
  settings: CopySettings,
) {
  if (!prisma) return;
  const activity = await getLiveWalletActivity(wallet.address);
  await applyAutomaticExits(wallet, activity.events, settings);
  const newest = latestSignature(activity.events);
  await logEvent("wallet.checked", "監視ウォレットを確認", {
    address: wallet.address,
    origin: wallet.origin,
    copyEnabled: wallet.isCopyEnabled,
    lastObservedSignature: wallet.lastObservedSignature,
    newestSignature: newest,
  });
  if (!newest) {
    await prisma.trackedWallet.update({
      where: { id: wallet.id },
      data: { lastCheckedAt: new Date() },
    });
    return;
  }
  if (!wallet.lastObservedSignature) {
    await prisma.trackedWallet.update({
      where: { id: wallet.id },
      data: { lastObservedSignature: newest, lastCheckedAt: new Date() },
    });
    return;
  }
  const newEvents = eventsAfterMarker(activity.events, wallet.lastObservedSignature);
  for (const event of [...newEvents].sort((a, b) => a.blockTime - b.blockTime)) {
    if (event.side === "BUY") {
      if (settings.enabled && wallet.isCopyEnabled && !wallet.isBlocked) await processBuy(userId, wallet, event, settings);
    }
    else await processSell(wallet, event);
  }
  await prisma.trackedWallet.update({
    where: { id: wallet.id },
    data: { lastObservedSignature: newest, lastCheckedAt: new Date() },
  });
}

export async function runCopyMonitorCycle() {
  if (runtime.running || !prisma) return getCopyMonitorStatus();
  runtime.running = true;
  runtime.newBuyCount = 0;
  runtime.createdPositions = 0;
  runtime.skippedTrades = 0;
  runtime.lastError = null;
  try {
    const user = await ensureAppUser();
    const settings = await getOrCreateCopySettings();
    const [allWallets, openPositions] = await Promise.all([
      prisma.trackedWallet.findMany({
        where: { network: "SOLANA" },
        orderBy: { createdAt: "asc" },
      }),
      prisma.paperPosition.findMany({
        where: { userId: user.id, status: "OPEN" },
        select: { sourceWalletId: true },
        distinct: ["sourceWalletId"],
      }),
    ]);
    const openSourceIds = new Set(openPositions.map(position => position.sourceWalletId));
    const monitored = allWallets.filter(wallet => (wallet.isCopyEnabled && !wallet.isBlocked) || openSourceIds.has(wallet.id));
    runtime.monitoredWallets = monitored.length;
    runtime.manualWallets = monitored.filter(wallet => wallet.origin === "MANUAL").length;
    runtime.autoWallets = monitored.filter(wallet => wallet.origin === "AUTO").length;
    runtime.favoriteWallets = monitored.filter(wallet => wallet.origin === "FAVORITE").length;

    await logEvent("cycle.start", "コピー監視サイクル開始", {
      total: monitored.length,
      manual: runtime.manualWallets,
      auto: runtime.autoWallets,
      favorite: runtime.favoriteWallets,
      wallets: allWallets.map(wallet => ({
        address: wallet.address,
        origin: wallet.origin,
        copyEnabled: wallet.isCopyEnabled,
        lastObservedSignature: wallet.lastObservedSignature,
      })),
    });
    for (const wallet of monitored) {
      try {
        await monitorWallet(user.id, wallet, settings);
      } catch (error) {
        await logEvent("wallet.error", "ウォレット監視エラー", {
          address: wallet.address,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    runtime.lastCycleAt = new Date().toISOString();
    await logEvent("cycle.completed", "コピー監視サイクル完了", {
      newBuyCount: runtime.newBuyCount,
      createdPositions: runtime.createdPositions,
      skippedTrades: runtime.skippedTrades,
    });
  } catch (error) {
    runtime.lastError = error instanceof Error ? error.message : String(error);
    console.error("[NEXT-TRADE][copy.monitor.cycle]", {
      message: runtime.lastError,
      stack: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    runtime.running = false;
  }
  return getCopyMonitorStatus();
}

function isEffectivelyEmptyBalance(balance: bigint, expected: bigint) {
  if (balance === BigInt(0)) return true;
  if (expected <= BigInt(0)) return false;
  // Jupiterや外部ウォレットの売却後に残る極小dustは保有として扱わない。
  const dustThreshold = expected / BigInt(1_000);
  return balance <= (dustThreshold > BigInt(1) ? dustThreshold : BigInt(1));
}

async function reconcileLivePositionBalances(
  positions: Array<{
    id: string;
    userId: string;
    tokenMint: string;
    copiedAt: Date;
    rawTokenAmount: string | null;
    amountUsd: Prisma.Decimal;
    quantity: Prisma.Decimal;
  }>,
) {
  if (!prisma) return new Set<string>();
  const intervalMs = Math.max(
    5_000,
    Number(process.env.LIVE_BALANCE_RECONCILE_INTERVAL_MS ?? "15000") || 15_000,
  );
  const now = Date.now();
  if (now - runtime.lastBalanceReconcileAt < intervalMs) return new Set<string>();
  runtime.lastBalanceReconcileAt = now;
  const graceMs = Math.max(
    30_000,
    Number(process.env.LIVE_BALANCE_RECONCILE_GRACE_MS ?? "60000") || 60_000,
  );

  const groups = new Map<string, typeof positions>();
  for (const position of positions) {
    // BUY直後はRPC反映前に残高0が返る場合があるため、誤決済を防ぐ。
    if (now - position.copiedAt.getTime() < graceMs) continue;
    const current = groups.get(position.tokenMint) ?? [];
    current.push(position);
    groups.set(position.tokenMint, current);
  }

  const reconciled = new Set<string>();
  for (const [mint, mintPositions] of groups) {
    const expected = mintPositions.reduce((total, position) => {
      try {
        return total + BigInt(position.rawTokenAmount ?? "0");
      } catch {
        return total;
      }
    }, BigInt(0));
    if (expected <= BigInt(0)) continue;

    try {
      const actual = await getLiveTokenRawBalance(mint);
      if (!isEffectivelyEmptyBalance(actual, expected)) continue;

      for (const position of mintPositions) {
        const successfulSell = await prisma.liveTradeExecution.findFirst({
          where: {
            paperPositionId: position.id,
            side: "SELL",
            status: "SUCCESS",
          },
          orderBy: { updatedAt: "desc" },
        });
        const proceedsUsd = successfulSell?.outputAmount
          ? Number(successfulSell.outputAmount) / 1_000_000
          : null;
        const quantity = Number(position.quantity);
        const amountUsd = Number(position.amountUsd);
        const hasExactExecution = proceedsUsd != null
          && Number.isFinite(proceedsUsd)
          && proceedsUsd >= 0
          && quantity > 0;

        await prisma.paperPosition.updateMany({
          where: { id: position.id, status: "OPEN", executionMode: "LIVE" },
          data: {
            status: "CLOSED",
            closedAt: successfulSell?.updatedAt ?? new Date(),
            exitPriceUsd: hasExactExecution ? proceedsUsd / quantity : null,
            pnlPercent: hasExactExecution && amountUsd > 0
              ? (proceedsUsd - amountUsd) / amountUsd * 100
              : null,
            pnlUsd: hasExactExecution ? proceedsUsd - amountUsd : null,
            pnlSol: null,
            sellSignature: successfulSell?.signature ?? null,
            settlementReason: "MANUAL",
          },
        });
        reconciled.add(position.id);
        await logEvent("position.balance-reconciled", "ウォレット残高0のためLIVE保有状態を決済済みに同期", {
          positionId: position.id,
          tokenMint: mint,
          expectedRawBalance: position.rawTokenAmount,
          walletRawBalance: actual.toString(),
          sellExecutionFound: Boolean(successfulSell),
          realizedPnlRecorded: hasExactExecution,
          sellSignature: successfulSell?.signature ?? null,
        }, true);
      }
    } catch (error) {
      await logEvent("position.balance-reconcile-failed", "LIVEトークン残高との照合に失敗", {
        tokenMint: mint,
        positionIds: mintPositions.map(position => position.id),
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      }, true);
    }
  }
  return reconciled;
}

function tokyoDayRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(part => part.type === type)?.value);
  const start = new Date(Date.UTC(value("year"), value("month") - 1, value("day")) - 9 * 60 * 60 * 1000);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export async function getLiveDailyLoss(userId?: string) {
  if (!prisma) return { lossUsd: 0, nextResetAt: null as string | null };
  const resolvedUserId = userId ?? (await ensureAppUser()).id;
  const { start, end } = tokyoDayRange();
  const losses = await prisma.paperPosition.findMany({
    where: {
      userId: resolvedUserId,
      executionMode: "LIVE",
      status: "CLOSED",
      closedAt: { gte: start, lt: end },
      pnlUsd: { lt: 0 },
    },
    select: { pnlUsd: true },
  });
  return {
    lossUsd: losses.reduce((total, item) => total + Math.abs(Number(item.pnlUsd ?? 0)), 0),
    nextResetAt: end.toISOString(),
  };
}

export async function runPositionMonitorCycle() {
  if (runtime.positionRunning || !prisma) {
    return {
      running: runtime.positionRunning,
      lastCycleAt: runtime.lastPositionCycleAt,
      monitoredPositions: runtime.monitoredPositions,
      lastError: runtime.positionLastError,
    };
  }
  runtime.positionRunning = true;
  runtime.positionLastError = null;
  try {
    const settings = await getOrCreateCopySettings();
    if (!settings.stopLossEnabled && !settings.takeProfitEnabled) {
      runtime.lastPositionCycleAt = new Date().toISOString();
      runtime.positionRunning = false;
      return {
        running: false,
        lastCycleAt: runtime.lastPositionCycleAt,
        monitoredPositions: runtime.monitoredPositions,
        lastError: null,
      };
    }
    const positions = await prisma.paperPosition.findMany({
      where: { status: "OPEN" },
      orderBy: { copiedAt: "asc" },
    });
    runtime.monitoredPositions = positions.length;
    if (!positions.length) {
      runtime.lastPositionCycleAt = new Date().toISOString();
      runtime.positionRunning = false;
      return {
        running: false,
        lastCycleAt: runtime.lastPositionCycleAt,
        monitoredPositions: 0,
        lastError: null,
      };
    }
    const uniqueMints = [...new Set(positions.map(p => p.tokenMint))];
    const quotes = new Map<string, LiveTokenQuote>();
    for (let i = 0; i < uniqueMints.length; i += 30) {
      const batch = await getTokenQuotes(uniqueMints.slice(i, i + 30), { verbose: false });
      for (const [mint, quote] of batch) quotes.set(mint, quote);
    }
    for (const position of positions) {
      const quote = quotes.get(position.tokenMint);
      if (!quote?.priceUsd || quote.priceUsd <= 0) continue;
      const entryPrice = Number(position.copyPriceUsd);
      const pnlPercent = (quote.priceUsd - entryPrice) / entryPrice * 100;
      const reason: "TAKE_PROFIT" | "STOP_LOSS" | null =
        settings.takeProfitEnabled && pnlPercent >= settings.takeProfit ? "TAKE_PROFIT"
        : settings.stopLossEnabled && pnlPercent <= -settings.stopLoss ? "STOP_LOSS"
        : null;
      if (!reason) continue;
      try {
        await settlePositionById(position.id, reason, quote.priceUsd);
      } catch {
        // continue monitoring other positions
      }
    }
    runtime.lastPositionCycleAt = new Date().toISOString();
  } catch (error) {
    runtime.positionLastError = error instanceof Error ? error.message : String(error);
  } finally {
    runtime.positionRunning = false;
  }
  return {
    running: runtime.positionRunning,
    lastCycleAt: runtime.lastPositionCycleAt,
    monitoredPositions: runtime.monitoredPositions,
    lastError: runtime.positionLastError,
  };
}

export function installCopyMonitor() {
  if (process.env.COPY_MONITOR_EXTERNAL_WORKER === "true") return;
  if (!prisma) return;
  if (!runtime.timer) {
    const seconds = Math.max(10, Number(process.env.COPY_MONITOR_INTERVAL_SECONDS ?? "15") || 15);
    runtime.timer = setInterval(() => { void runCopyMonitorCycle(); }, seconds * 1000);
    runtime.timer.unref?.();
    void runCopyMonitorCycle();
  }
  if (!runtime.positionTimer) {
    const intervalMs = Math.max(
      1_000,
      Number(process.env.POSITION_MONITOR_INTERVAL_MS ?? "1000") || 1_000,
    );
    runtime.positionTimer = setInterval(() => { void runPositionMonitorCycle(); }, intervalMs);
    runtime.positionTimer.unref?.();
    void runPositionMonitorCycle();
  }
}

export function getCopyMonitorStatus(): CopyMonitorStatus {
  return {
    running: runtime.running,
    lastCycleAt: runtime.lastCycleAt,
    monitoredWallets: runtime.monitoredWallets,
    manualWallets: runtime.manualWallets,
    autoWallets: runtime.autoWallets,
    favoriteWallets: runtime.favoriteWallets,
    newBuyCount: runtime.newBuyCount,
    createdPositions: runtime.createdPositions,
    skippedTrades: runtime.skippedTrades,
    lastError: runtime.lastError,
  };
}
