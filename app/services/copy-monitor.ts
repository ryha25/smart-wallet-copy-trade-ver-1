import { Prisma } from "@prisma/client";
import { defaultSettings } from "../lib/default-settings";
import { evaluateCopySignal } from "../lib/paper-trading";
import { prisma } from "../lib/prisma";
import type { CopyMonitorStatus, LiveWalletEvent } from "../lib/live-types";
import type { CopySettings } from "../lib/types";
import { getLiveWalletActivity, getTokenRisk } from "./solana-live";

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
  const user = await ensureAppUser();
  const saved = await prisma.copySettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      enabled: settings.enabled,
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
  return markerIndex < 0 ? [] : ordered.slice(0, markerIndex);
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
  const slippage = sourcePrice > 0 ? Math.abs(event.current.priceUsd - sourcePrice) / sourcePrice * 100 : 0;
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
      copyPriceUsd: event.current.priceUsd,
      slippagePercent: slippage,
      amountUsd: settings.amountPerTrade,
      amountSol: 0,
      quantity: settings.amountPerTrade / event.current.priceUsd,
      status: "OPEN",
    },
    update: {},
  });
  runtime.createdPositions++;
  await logEvent("copy.created", "ペーパートレードを作成", {
    wallet: wallet.address,
    signature: event.signature,
    mint: event.mint,
    amountUsd: settings.amountPerTrade,
    copyPriceUsd: event.current.priceUsd,
  }, true);
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
    const entryPrice = Number(position.copyPriceUsd);
    const pnlPercent = (exitPrice - entryPrice) / entryPrice * 100;
    const pnlUsd = Number(position.amountUsd) * pnlPercent / 100;
    await prisma.paperPosition.update({
      where: { id: position.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        exitPriceUsd: exitPrice,
        pnlPercent,
        pnlUsd,
        pnlSol: 0,
        settlementReason: "SOURCE_SOLD",
      },
    });
    await logEvent("copy.closed", "コピー元の売却でペーパートレードを決済", {
      wallet: wallet.address,
      signature: event.signature,
      mint: event.mint,
      pnlPercent,
      pnlUsd,
    }, true);
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

    const pnlUsd = Number(position.amountUsd) * pnlPercent / 100;
    await prisma.paperPosition.update({
      where: { id: position.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        exitPriceUsd: currentPrice,
        pnlPercent,
        pnlUsd,
        pnlSol: 0,
        settlementReason: reason,
      },
    });
    await logEvent("copy.closed", `Automatic exit: ${reason}`, {
      wallet: wallet.address,
      positionId: position.id,
      mint: position.tokenMint,
      pnlPercent,
      pnlUsd,
    }, true);
  }
}

async function monitorWallet(
  userId: string,
  wallet: {
    id: string;
    address: string;
    origin: string;
    isCopyEnabled: boolean;
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
    if (event.side === "BUY") await processBuy(userId, wallet, event, settings);
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
    const allWallets = await prisma.trackedWallet.findMany({
      where: { network: "SOLANA", isBlocked: false },
      orderBy: { createdAt: "asc" },
    });
    const monitored = allWallets.filter(wallet => wallet.isCopyEnabled);
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
    if (settings.enabled) {
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

export function installCopyMonitor() {
  if (runtime.timer || !prisma) return;
  const seconds = Math.max(10, Number(process.env.COPY_MONITOR_INTERVAL_SECONDS ?? "15") || 15);
  runtime.timer = setInterval(() => { void runCopyMonitorCycle(); }, seconds * 1000);
  runtime.timer.unref?.();
  void runCopyMonitorCycle();
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
