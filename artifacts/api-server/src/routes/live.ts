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
import {
  getCopyMonitorStatus,
  getOrCreateCopySettings,
  installCopyMonitor,
  runCopyMonitorCycle,
  saveCopySettings,
} from "../services/copy-monitor";

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
    const wallets = await prisma.trackedWallet.findMany({ orderBy: { createdAt: "asc" } });
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
        currentPriceUsd: Number(position.exitPriceUsd ?? position.copyPriceUsd),
        amountUsd: Number(position.amountUsd),
        liquidityUsd: 0,
        status: position.status === "OPEN" ? "OPEN" : "CLOSED",
        closedAt: position.closedAt?.toISOString(),
        exitPriceUsd: position.exitPriceUsd ? Number(position.exitPriceUsd) : undefined,
        exitReason: position.settlementReason ?? undefined,
      })),
      skipped: skipped.map(item => ({
        id: item.id,
        signature: item.sourceSignature ?? item.id,
        wallet: item.sourceWallet.address,
        mint: item.tokenMint,
        symbol: item.tokenSymbol ?? item.tokenMint.slice(0, 8),
        detectedAt: item.detectedAt.toISOString(),
        reason: item.reasonDetail ?? item.reasonCode,
      })),
    });
  } catch (error) {
    response.status(500).json(apiError(error, "copy-monitor.trades"));
  }
});

router.patch("/copy-monitor", async (request, response) => {
  try {
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const body = request.body as { id?: string; exitPriceUsd?: number };
    if (!body.id || !Number.isFinite(body.exitPriceUsd) || Number(body.exitPriceUsd) <= 0) {
      throw new Error("決済対象と決済価格を確認してください");
    }
    const position = await prisma.paperPosition.findUniqueOrThrow({ where: { id: body.id } });
    const exitPrice = Number(body.exitPriceUsd);
    const entryPrice = Number(position.copyPriceUsd);
    const pnlPercent = (exitPrice - entryPrice) / entryPrice * 100;
    const pnlUsd = Number(position.amountUsd) * pnlPercent / 100;
    const updated = await prisma.paperPosition.update({
      where: { id: position.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        exitPriceUsd: exitPrice,
        pnlPercent,
        pnlUsd,
        pnlSol: 0,
        settlementReason: "MANUAL",
      },
    });
    response.setHeader("cache-control", "no-store").json({ id: updated.id, status: updated.status });
  } catch (error) {
    response.status(400).json(apiError(error, "copy-monitor.settle"));
  }
});

export default router;
