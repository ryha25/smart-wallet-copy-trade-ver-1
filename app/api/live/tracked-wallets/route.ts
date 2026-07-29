import { requireAppSession } from "../../../lib/app-auth";
import { apiError } from "../../../lib/api-errors";
import { prisma } from "../../../lib/prisma";
import type { ChainNetwork, TrackedWallet } from "../../../lib/live-types";
import { installCopyMonitor, runCopyMonitorCycle } from "../../../services/copy-monitor";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const NETWORKS = new Set<ChainNetwork>(["SOLANA", "ETHEREUM"]);
const ORIGINS = new Set<TrackedWallet["origin"]>(["MANUAL", "AUTO", "FAVORITE"]);

function databaseRequired() {
  if (!prisma) throw new Error("DATABASE_URLが未設定です");
  return prisma;
}

function mapWallet(wallet: {
  id: string;
  network: string;
  address: string;
  displayName: string;
  origin: string;
  isCopyEnabled: boolean;
  createdAt: Date;
  lastObservedSignature: string | null;
  lastCheckedAt: Date | null;
}): TrackedWallet {
  return {
    id: wallet.id,
    network: wallet.network as ChainNetwork,
    address: wallet.address,
    label: wallet.displayName,
    origin: wallet.origin as TrackedWallet["origin"],
    enabled: wallet.isCopyEnabled,
    addedAt: wallet.createdAt.toISOString(),
    lastObservedSignature: wallet.lastObservedSignature,
    lastCheckedAt: wallet.lastCheckedAt?.toISOString() ?? null,
  };
}

async function readBody(request: Request) {
  const body = await request.json() as Partial<TrackedWallet>;
  const network = (body.network ?? "SOLANA").toUpperCase() as ChainNetwork;
  const address = body.address?.trim() ?? "";
  const origin = body.origin ?? "MANUAL";
  if (!NETWORKS.has(network)) throw new Error("未対応ネットワークです");
  if (network === "SOLANA" ? !SOLANA_ADDRESS.test(address) : !EVM_ADDRESS.test(address)) {
    throw new Error(`${network}のウォレットアドレスを確認してください`);
  }
  if (!ORIGINS.has(origin)) throw new Error("登録経路が正しくありません");
  return {
    network,
    address: network === "SOLANA" ? address : address.toLowerCase(),
    displayName: body.label?.trim() || `${origin} ${address.slice(0, 6)}`,
    origin,
    enabled: Boolean(body.enabled),
  };
}

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const db = databaseRequired();
    installCopyMonitor();
    const wallets = await db.trackedWallet.findMany({
      where: { network: { in: ["SOLANA", "ETHEREUM"] } },
      orderBy: { createdAt: "asc" },
    });
    return Response.json(wallets.map(mapWallet), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "tracked-wallets.list"), { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const db = databaseRequired();
    const input = await readBody(request);
    const wallet = await db.trackedWallet.upsert({
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
    return Response.json(mapWallet(wallet), { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "tracked-wallets.create"), { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const db = databaseRequired();
    const input = await readBody(request);
    const wallet = await db.trackedWallet.update({
      where: { network_address: { network: input.network, address: input.address } },
      data: {
        displayName: input.displayName,
        origin: input.origin,
        isCopyEnabled: input.enabled,
      },
    });
    installCopyMonitor();
    if (wallet.isCopyEnabled) void runCopyMonitorCycle();
    return Response.json(mapWallet(wallet), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "tracked-wallets.update"), { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const db = databaseRequired();
    const input = await readBody(request);
    const wallet = await db.trackedWallet.findUniqueOrThrow({
      where: { network_address: { network: input.network, address: input.address } },
      select: { id: true },
    });
    await db.$transaction([
      db.paperTrade.deleteMany({ where: { sourceWalletId: wallet.id } }),
      db.paperPosition.deleteMany({ where: { sourceWalletId: wallet.id } }),
      db.skippedTrade.deleteMany({ where: { sourceWalletId: wallet.id } }),
      db.trackedWallet.delete({ where: { id: wallet.id } }),
    ]);
    return Response.json({ deleted: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "tracked-wallets.delete"), { status: 400 });
  }
}
