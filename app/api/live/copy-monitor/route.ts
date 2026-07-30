import { requireAppSession } from "../../../lib/app-auth";
import { apiError } from "../../../lib/api-errors";
import { prisma } from "../../../lib/prisma";
import {
  getCopyMonitorStatus,
  installCopyMonitor,
  runCopyMonitorCycle,
  settlePositionById,
  getLiveDailyLoss,
} from "../../../services/copy-monitor";
import { getTokenQuotes } from "../../../services/solana-live";
import type { ModePerformance } from "../../../lib/live-types";

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
    const openMints = positions
      .filter(position => position.status === "OPEN")
      .map(position => position.tokenMint);
    const quotes = await getTokenQuotes(openMints, { verbose: false }).catch(() => new Map());
    const todayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const performanceFor = (mode: "LIVE" | "PAPER"): ModePerformance => {
      const scoped = positions.filter(position => position.executionMode === mode);
      const closed = scoped.filter(position => position.status === "CLOSED" && position.pnlUsd != null);
      const open = scoped.filter(position => position.status === "OPEN");
      const pnls = closed.map(position => Number(position.pnlUsd ?? 0));
      const wins = pnls.filter(value => value > 0);
      const losses = pnls.filter(value => value < 0);
      const unrealizedPnlUsd = open.reduce((total, position) => {
        const currentPrice = quotes.get(position.tokenMint)?.priceUsd ?? Number(position.copyPriceUsd);
        return total + Number(position.quantity) * currentPrice - Number(position.amountUsd);
      }, 0);
      const todayPnlUsd = closed
        .filter(position => position.closedAt && new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(position.closedAt) === todayKey)
        .reduce((total, position) => total + Number(position.pnlUsd ?? 0), 0);
      return {
        mode,
        realizedPnlUsd: pnls.reduce((total, value) => total + value, 0),
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
