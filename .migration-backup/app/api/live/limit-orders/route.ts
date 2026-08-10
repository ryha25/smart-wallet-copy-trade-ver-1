import { requireAppSession } from "../../../lib/app-auth";
import { apiError } from "../../../lib/api-errors";
import { prisma } from "../../../lib/prisma";
import { ensureAppUser } from "../../../services/copy-monitor";
import type { LimitOrder } from "../../../lib/types";

function toDto(order: {
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

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const user = await ensureAppUser();
    const url = new URL(request.url, "http://localhost");
    const mint = url.searchParams.get("mint");
    const positionId = url.searchParams.get("positionId");
    const orders = await prisma.limitOrder.findMany({
      where: {
        userId: user.id,
        status: { in: ["PENDING", "FAILED"] },
        ...(mint ? { tokenMint: mint } : {}),
        ...(positionId ? { positionId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return Response.json(orders.map(toDto), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "limit-orders.list"), { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const user = await ensureAppUser();
    const body = await request.json() as {
      tokenMint: string;
      tokenSymbol: string;
      side: "BUY" | "SELL";
      targetPriceUsd: number;
      amountUsd?: number;
      sellPercent?: number;
      positionId?: string;
    };
    if (!body.tokenMint || !body.side || !body.targetPriceUsd || body.targetPriceUsd <= 0) {
      throw new Error("tokenMint・side・targetPriceUsd（>0）は必須です");
    }
    if (body.side === "BUY" && (!body.amountUsd || body.amountUsd <= 0)) {
      throw new Error("指値買いには購入金額（amountUsd）が必要です");
    }
    if (body.side === "SELL" && (!body.sellPercent || body.sellPercent <= 0 || body.sellPercent > 100)) {
      throw new Error("指値売りには売却割合（sellPercent: 1〜100）が必要です");
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
    return Response.json(toDto(order), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "limit-orders.create"), { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    if (!prisma) throw new Error("DATABASE_URLが未設定です");
    const user = await ensureAppUser();
    const url = new URL(request.url, "http://localhost");
    const id = url.searchParams.get("id");
    if (!id) throw new Error("idは必須です");
    const order = await prisma.limitOrder.findUniqueOrThrow({ where: { id } });
    if (order.userId !== user.id) throw new Error("権限がありません");
    const updated = await prisma.limitOrder.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    return Response.json(toDto(updated), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "limit-orders.cancel"), { status: 400 });
  }
}
