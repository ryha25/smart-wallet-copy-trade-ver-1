import { requireAppSession } from "../../../lib/app-auth";
import { apiError } from "../../../lib/api-errors";
import { prisma } from "../../../lib/prisma";
import {
  getCopyMonitorStatus,
  installCopyMonitor,
  runCopyMonitorCycle,
  settlePositionById,
} from "../../../services/copy-monitor";

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    installCopyMonitor();
    return Response.json(getCopyMonitorStatus(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "copy-monitor.status"), { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const status = await runCopyMonitorCycle();
    return Response.json(status, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "copy-monitor.run"), { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const positions = await prisma.paperPosition.findMany({
      include: { sourceWallet: true },
      orderBy: { copiedAt: "desc" },
      take: 500,
    });
    const skipped = await prisma.skippedTrade.findMany({
      include: { sourceWallet: true },
      orderBy: { detectedAt: "desc" },
      take: 500,
    });
    return Response.json({
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
        executionMode: position.executionMode,
        buySignature: position.buySignature ?? undefined,
        sellSignature: position.sellSignature ?? undefined,
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
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "copy-monitor.trades"), { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const body = await request.json() as { id?: string; exitPriceUsd?: number };
    if (!body.id) throw new Error("決済対象を確認してください");
    const updated = await settlePositionById(body.id, "MANUAL", body.exitPriceUsd);
    return Response.json({ id: updated.id, status: updated.status }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "copy-monitor.settle"), { status: 400 });
  }
}
