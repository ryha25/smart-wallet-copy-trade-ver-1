import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import { apiError } from "../lib/api-errors";
import { prisma } from "../lib/prisma";
import type { ChainNetwork, TrackedWallet } from "../lib/live-types";
import {
  analyzeWallet,
  getJupiterPaperQuote,
  getLiveWalletActivity,
  getTokenQuotes,
  getTokenRisk,
  scanWalletsForToken,
} from "../services/solana-live";
import {
  ensureFreshWalletScan,
  installWalletScanScheduler,
  startWalletScan,
} from "../services/wallet-scan-manager";
import {
  ensureFreshEvmScan,
  installEvmScanScheduler,
  parseEvmNetwork,
  startEvmScan,
} from "../services/evm-wallet-scan-manager";
import { getEthereumPrice } from "../services/evm-live";
import {
  ensureAppUser,
  getCopyMonitorStatus,
  getLiveDailyLoss,
  getOrCreateCopySettings,
  installCopyMonitor,
  partialSettlePositionById,
  runCopyMonitorCycle,
  saveCopySettings,
  settlePositionById,
  forceClosePositionById,
} from "../services/copy-monitor";
import type { LimitOrder } from "../lib/types";
import type { ModePerformance } from "../lib/live-types";
import { getLiveTradingStatus } from "../services/live-trading";
import { isNtfyConfigured, getNtfySubscribeUrl } from "../lib/push-notify";

const router = Router();

router.get("/token", async (request, response) => {
  const mint = String(request.query["mint"] ?? "").trim();
  console.info("[NEXT-TRADE][favorite.token] input CA", { mint });
  try {
    try {
      new PublicKey(mint);
    } catch (publicKeyError) {
      throw new Error(`CAをPublicKeyとして解析できません: ${mint}`, { cause: publicKeyError });
    }
    const quote = (await getTokenQuotes([mint])).get(mint);
    if (!quote) {
      response.status(404).json({
        error: "DexScreenerで取引ペアが見つかりません",
        details: `mint=${mint}, pairs=empty`,
      });
      return;
    }
    response.setHeader("cache-control", "no-store").json(quote);
  } catch (error) {
    response.status(400).json(apiError(error, "favorite.token"));
  }
});

router.get("/token-wallets", async (request, response) => {
  try {
    const mint = String(request.query["mint"] ?? "").trim();
    const data = await scanWalletsForToken(mint);
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "favorite.wallets"));
  }
});

router.get("/risk", async (request, response) => {
  try {
    const data = await getTokenRisk(String(request.query["mint"] ?? "").trim());
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "token.risk"));
  }
});

router.get("/quote", async (request, response) => {
  try {
    const data = await getJupiterPaperQuote(
      String(request.query["mint"] ?? "").trim(),
      Number(request.query["amountUsd"] ?? 0),
      Number(request.query["slippageBps"] ?? 50),
    );
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(400).json(apiError(error, "jupiter.quote"));
  }
});

router.get("/wallet", async (request, response) => {
  try {
    const data = await getLiveWalletActivity(String(request.query["address"] ?? "").trim());
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(400).json(apiError(error, "wallet.activity"));
  }
});

router.get("/score", async (request, response) => {
  try {
    const data = await analyzeWallet(String(request.query["address"] ?? "").trim());
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(400).json(apiError(error, "wallet.score"));
  }
});

router.get("/scan", async (_request, response) => {
  try {
    installWalletScanScheduler();
    const data = await ensureFreshWalletScan();
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "wallet.scan"));
  }
});

router.post("/scan", async (_request, response) => {
  try {
    const data = await startWalletScan();
    response.status(data.status === "RUNNING" ? 202 : 200);
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "wallet.scan.start"));
  }
});

router.get("/evm-scan", async (request, response) => {
  try {
    const network = parseEvmNetwork(String(request.query["network"] ?? ""));
    installEvmScanScheduler(network);
    const data = await ensureFreshEvmScan(network);
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "evm.wallet.scan"));
  }
});

router.post("/evm-scan", async (request, response) => {
  try {
    const network = parseEvmNetwork(String(request.query["network"] ?? ""));
    const data = await startEvmScan(network);
    response.status(data.status === "RUNNING" ? 202 : 200);
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "evm.wallet.scan.start"));
  }
});

router.get("/evm-price", async (_request, response) => {
  try {
    const data = await getEthereumPrice();
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "evm.ethereum.price"));
  }
});

const mapTrackedWallet = (wallet: {
  id: string;
  network: string;
  address: string;
  displayName: string;
  origin: string;
  isCopyEnabled: boolean;
  createdAt: Date;
  lastObservedSignature: string | null;
  lastCheckedAt: Date | null;
}): TrackedWallet => ({
  id: wallet.id,
  network: wallet.network as ChainNetwork,
  address: wallet.address,
  label: wallet.displayName,
  origin: wallet.origin as TrackedWallet["origin"],
  enabled: wallet.isCopyEnabled,
  addedAt: wallet.createdAt.toISOString(),
  lastObservedSignature: wallet.lastObservedSignature,
  lastCheckedAt: wallet.lastCheckedAt?.toISOString() ?? null,
});

function trackedWalletInput(body: Partial<TrackedWallet>) {
  const network = (body.network ?? "SOLANA").toUpperCase() as ChainNetwork;
  if (network !== "SOLANA" && network !== "ETHEREUM") throw new Error("未対応ネットワークです");
  const address = String(body.address ?? "").trim();
  const origin = body.origin ?? "MANUAL";
  const valid = network === "SOLANA"
    ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
    : /^0x[a-fA-F0-9]{40}$/.test(address);
  if (!valid) throw new Error(`${network}のウォレットアドレスを確認してください`);
  return {
    network,
    address: network === "SOLANA" ? address : address.toLowerCase(),
    displayName: String(body.label ?? "").trim() || `${origin} ${address.slice(0, 6)}`,
    origin,
    enabled: Boolean(body.enabled),
  };
}

router.get("/tracked-wallets", async (_request, response) => {
  try {
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    installCopyMonitor();
    const wallets = await prisma.trackedWallet.findMany({
      where: { network: { in: ["SOLANA", "ETHEREUM"] } },
      orderBy: { createdAt: "asc" },
    });
    response.setHeader("cache-control", "no-store").json(wallets.map(mapTrackedWallet));
  } catch (error) {
    response.status(500).json(apiError(error, "tracked-wallets.list"));
  }
});

router.post("/tracked-wallets", async (request, response) => {
  try {
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const input = trackedWalletInput(request.body as Partial<TrackedWallet>);
    const wallet = await prisma.trackedWallet.upsert({
      where: { network_address: { network: input.network, address: input.address } },
      create: {
        network: input.network,
        address: input.address,
        displayName: input.displayName,
        origin: input.origin,
        firstTradeAt: new Date(),
        isCopyEnabled: input.enabled,
      },
      update: {
        displayName: input.displayName,
        origin: input.origin,
        isCopyEnabled: input.enabled,
      },
    });
    installCopyMonitor();
    void runCopyMonitorCycle();
    response.status(201).setHeader("cache-control", "no-store").json(mapTrackedWallet(wallet));
  } catch (error) {
    response.status(400).json(apiError(error, "tracked-wallets.create"));
  }
});

router.patch("/tracked-wallets", async (request, response) => {
  try {
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const input = trackedWalletInput(request.body as Partial<TrackedWallet>);
    const wallet = await prisma.trackedWallet.update({
      where: { network_address: { network: input.network, address: input.address } },
      data: { displayName: input.displayName, origin: input.origin, isCopyEnabled: input.enabled },
    });
    if (wallet.isCopyEnabled) void runCopyMonitorCycle();
    response.setHeader("cache-control", "no-store").json(mapTrackedWallet(wallet));
  } catch (error) {
    response.status(400).json(apiError(error, "tracked-wallets.update"));
  }
});

router.delete("/tracked-wallets", async (request, response) => {
  try {
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const input = trackedWalletInput(request.body as Partial<TrackedWallet>);
    const wallet = await prisma.trackedWallet.findUniqueOrThrow({
      where: { network_address: { network: input.network, address: input.address } },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.paperTrade.deleteMany({ where: { sourceWalletId: wallet.id } }),
      prisma.paperPosition.deleteMany({ where: { sourceWalletId: wallet.id } }),
      prisma.skippedTrade.deleteMany({ where: { sourceWalletId: wallet.id } }),
      prisma.trackedWallet.delete({ where: { id: wallet.id } }),
    ]);
    response.setHeader("cache-control", "no-store").json({ deleted: true });
  } catch (error) {
    response.status(400).json(apiError(error, "tracked-wallets.delete"));
  }
});

router.get("/copy-settings", async (_request, response) => {
  try {
    response.setHeader("cache-control", "no-store").json(await getOrCreateCopySettings());
  } catch (error) {
    response.status(500).json(apiError(error, "copy-settings.get"));
  }
});

router.put("/copy-settings", async (request, response) => {
  try {
    response.setHeader("cache-control", "no-store").json(await saveCopySettings(request.body));
  } catch (error) {
    response.status(400).json(apiError(error, "copy-settings.save"));
  }
});

router.get("/copy-monitor", async (_request, response) => {
  installCopyMonitor();
  response.setHeader("cache-control", "no-store").json(getCopyMonitorStatus());
});

router.get("/live-trading", async (_request, response) => {
  try {
    response.setHeader("cache-control", "no-store").json(await getLiveTradingStatus());
  } catch (error) {
    response.status(500).json(apiError(error, "live-trading.status"));
  }
});

router.post("/copy-monitor", async (_request, response) => {
  try {
    response.setHeader("cache-control", "no-store").json(await runCopyMonitorCycle());
  } catch (error) {
    response.status(500).json(apiError(error, "copy-monitor.run"));
  }
});

router.put("/copy-monitor", async (_request, response) => {
  try {
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const [positions, skipped] = await Promise.all([
      prisma.paperPosition.findMany({ include: { sourceWallet: true }, orderBy: { copiedAt: "desc" }, take: 500 }),
      prisma.skippedTrade.findMany({ include: { sourceWallet: true }, orderBy: { detectedAt: "desc" }, take: 500 }),
    ]);
    const openMints = positions
      .filter(p => p.status === "OPEN")
      .map(p => p.tokenMint);
    const quotes = await getTokenQuotes(openMints).catch(() => new Map());
    const todayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const performanceFor = (mode: "LIVE" | "PAPER"): ModePerformance => {
      const scoped = positions.filter(p => p.executionMode === mode);
      const closed = scoped.filter(p => p.status === "CLOSED" && p.pnlUsd != null);
      const open = scoped.filter(p => p.status === "OPEN");
      const pnls = closed.map(p => Number(p.pnlUsd ?? 0));
      const wins = pnls.filter(v => v > 0);
      const losses = pnls.filter(v => v < 0);
      const unrealizedPnlUsd = open.reduce((total, p) => {
        const currentPrice = quotes.get(p.tokenMint)?.priceUsd ?? Number(p.copyPriceUsd);
        return total + Number(p.quantity) * currentPrice - Number(p.amountUsd);
      }, 0);
      const todayPnlUsd = closed
        .filter(p => p.closedAt && new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(p.closedAt) === todayKey)
        .reduce((total, p) => total + Number(p.pnlUsd ?? 0), 0);
      return {
        mode,
        realizedPnlUsd: pnls.reduce((a, b) => a + b, 0),
        unrealizedPnlUsd,
        todayPnlUsd,
        winRate: closed.length ? wins.length / closed.length * 100 : 0,
        closedCount: closed.length,
        winCount: wins.length,
        lossCount: losses.length,
        openCount: open.length,
        averageWinUsd: wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0,
        averageLossUsd: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
        maxWinUsd: wins.length ? Math.max(...wins) : 0,
        maxLossUsd: losses.length ? Math.min(...losses) : 0,
      };
    };
    const dailyLoss = await getLiveDailyLoss();
    response.setHeader("cache-control", "no-store").json({
      positions: positions.map(position => ({
        id: position.id,
        signature: position.sourceSignature ?? position.id,
        wallet: position.sourceWallet.address,
        mint: position.tokenMint,
        symbol: position.tokenSymbol,
        openedAt: position.copiedAt.toISOString(),
        sourceBlockTime: Math.floor(position.sourceBoughtAt.getTime() / 1000),
        detectionDelaySeconds: Math.floor(position.detectionDelayMs / 1000),
        sourcePriceUsd: Number(position.sourcePriceUsd),
        copyPriceUsd: Number(position.copyPriceUsd),
        currentPriceUsd: position.status === "OPEN"
          ? quotes.get(position.tokenMint)?.priceUsd ?? Number(position.copyPriceUsd)
          : Number(position.exitPriceUsd ?? position.copyPriceUsd),
        entryMarketCapUsd: position.entryMarketCapUsd ? Number(position.entryMarketCapUsd) : undefined,
        currentMarketCapUsd: position.status === "OPEN"
          ? quotes.get(position.tokenMint)?.marketCapUsd || undefined
          : position.exitMarketCapUsd ? Number(position.exitMarketCapUsd) : undefined,
        exitMarketCapUsd: position.exitMarketCapUsd ? Number(position.exitMarketCapUsd) : undefined,
        amountUsd: Number(position.amountUsd),
        liquidityUsd: 0,
        status: position.status === "OPEN" ? "OPEN" : "CLOSED",
        executionMode: position.executionMode,
        buySignature: position.buySignature ?? undefined,
        sellSignature: position.sellSignature ?? undefined,
        closedAt: position.closedAt?.toISOString(),
        exitPriceUsd: position.exitPriceUsd ? Number(position.exitPriceUsd) : undefined,
        exitReason: position.settlementReason ?? undefined,
        realizedPnlUsd: position.pnlUsd == null ? undefined : Number(position.pnlUsd),
      })),
      skipped: skipped.map(item => ({
        id: item.id,
        signature: item.sourceSignature ?? item.id,
        wallet: item.sourceWallet.address,
        mint: item.tokenMint,
        symbol: item.tokenSymbol ?? item.tokenMint.slice(0, 8),
        detectedAt: item.detectedAt.toISOString(),
        reason: item.reasonDetail ?? item.reasonCode,
        executionMode: item.executionMode ?? "UNKNOWN",
      })),
      performance: {
        LIVE: performanceFor("LIVE"),
        PAPER: performanceFor("PAPER"),
      },
      dailyLoss,
    });
  } catch (error) {
    response.status(500).json(apiError(error, "copy-monitor.trades"));
  }
});

router.patch("/copy-monitor", async (request, response) => {
  try {
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const body = request.body as { id?: string; exitPriceUsd?: number; sellPercent?: number; force?: boolean };
    if (!body.id) throw new Error("決済対象を確認してください");
    const updated = body.force
      ? await forceClosePositionById(body.id)
      : body.sellPercent != null && body.sellPercent < 100
        ? await partialSettlePositionById(body.id, body.sellPercent, body.exitPriceUsd)
        : await settlePositionById(body.id, "MANUAL", body.exitPriceUsd);
    response.setHeader("cache-control", "no-store").json({ id: updated.id, status: updated.status });
  } catch (error) {
    response.status(400).json(apiError(error, "copy-monitor.settle"));
  }
});

router.get("/notifications", (_request, response) => {
  response.setHeader("cache-control", "no-store").json({
    configured: isNtfyConfigured(),
    subscribeUrl: getNtfySubscribeUrl(),
    appInstallUrls: {
      ios: "https://apps.apple.com/app/ntfy/id1625396347",
      android: "https://play.google.com/store/apps/details?id=io.heckel.ntfy",
    },
  });
});

function limitOrderToDto(order: {
  id: string;
  tokenMint: string;
  tokenSymbol: string;
  side: string;
  targetPriceUsd: { toNumber(): number };
  amountUsd: { toNumber(): number } | null;
  sellPercent: { toNumber(): number } | null;
  positionId: string | null;
  status: string;
  createdAt: Date;
  triggeredAt: Date | null;
  errorMessage: string | null;
}): LimitOrder {
  return {
    id: order.id,
    tokenMint: order.tokenMint,
    tokenSymbol: order.tokenSymbol,
    side: order.side as LimitOrder["side"],
    targetPriceUsd: order.targetPriceUsd.toNumber(),
    amountUsd: order.amountUsd?.toNumber(),
    sellPercent: order.sellPercent?.toNumber(),
    positionId: order.positionId ?? undefined,
    status: order.status as LimitOrder["status"],
    createdAt: order.createdAt.toISOString(),
    triggeredAt: order.triggeredAt?.toISOString(),
    errorMessage: order.errorMessage ?? undefined,
  };
}

router.get("/limit-orders", async (request, response) => {
  try {
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const user = await ensureAppUser();
    const mint = request.query["mint"] ? String(request.query["mint"]) : undefined;
    const positionId = request.query["positionId"] ? String(request.query["positionId"]) : undefined;
    const orders = await prisma.limitOrder.findMany({
      where: {
        userId: user.id,
        status: { in: ["PENDING", "FAILED"] },
        ...(mint ? { tokenMint: mint } : {}),
        ...(positionId ? { positionId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    response.setHeader("cache-control", "no-store").json(orders.map(limitOrderToDto));
  } catch (error) {
    response.status(500).json(apiError(error, "limit-orders.list"));
  }
});

router.post("/limit-orders", async (request, response) => {
  try {
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const user = await ensureAppUser();
    const body = request.body as {
      tokenMint?: string;
      tokenSymbol?: string;
      side?: "BUY" | "SELL";
      targetPriceUsd?: number;
      amountUsd?: number;
      sellPercent?: number;
      positionId?: string;
    };
    if (!body.tokenMint || !body.side || !body.targetPriceUsd || body.targetPriceUsd <= 0) {
      response.status(400).json({ error: "tokenMint・side・targetPriceUsd（>0）は必須です" });
      return;
    }
    if (body.side === "BUY" && (!body.amountUsd || body.amountUsd <= 0)) {
      response.status(400).json({ error: "指値買いには購入金額（amountUsd）が必要です" });
      return;
    }
    if (body.side === "SELL" && (!body.sellPercent || body.sellPercent <= 0 || body.sellPercent > 100)) {
      response.status(400).json({ error: "指値売りには売却割合（sellPercent: 1〜100）が必要です" });
      return;
    }
    const order = await prisma.limitOrder.create({
      data: {
        userId: user.id,
        tokenMint: body.tokenMint,
        tokenSymbol: body.tokenSymbol || body.tokenMint.slice(0, 8),
        side: body.side,
        targetPriceUsd: body.targetPriceUsd,
        amountUsd: body.side === "BUY" ? body.amountUsd : undefined,
        sellPercent: body.side === "SELL" ? body.sellPercent : undefined,
        positionId: body.positionId,
        status: "PENDING",
      },
    });
    response.setHeader("cache-control", "no-store").json(limitOrderToDto(order));
  } catch (error) {
    response.status(400).json(apiError(error, "limit-orders.create"));
  }
});

router.delete("/limit-orders", async (request, response) => {
  try {
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const user = await ensureAppUser();
    const id = request.query["id"] ? String(request.query["id"]) : undefined;
    if (!id) {
      response.status(400).json({ error: "idは必須です" });
      return;
    }
    const order = await prisma.limitOrder.findUniqueOrThrow({ where: { id } });
    if (order.userId !== user.id) {
      response.status(403).json({ error: "権限がありません" });
      return;
    }
    const updated = await prisma.limitOrder.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    response.setHeader("cache-control", "no-store").json(limitOrderToDto(updated));
  } catch (error) {
    response.status(400).json(apiError(error, "limit-orders.cancel"));
  }
});

export default router;
