import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { walletAddress: "MOCK_USER" },
    update: {},
    create: { walletAddress: "MOCK_USER", displayName: "Demo Trader" },
  });

  const seeds = [
    ["7xKXtg2CW8m3YqA9", "Delta Harvester", 418],
    ["F3tR9vLq1Pk7NwB2", "Quiet Compounder", 302],
    ["9kT2pLm8Zaq4HxC1", "Wave Rider", 221],
  ] as const;

  for (const [address, displayName, ageDays] of seeds) {
    const wallet = await prisma.trackedWallet.upsert({
      where: { address },
      update: {},
      create: {
        address, displayName, isCopyEnabled: displayName !== "Wave Rider",
        firstTradeAt: new Date(Date.now() - ageDays * 86_400_000),
      },
    });
    await prisma.walletStatistic.create({
      data: {
        walletId: wallet.id, periodStart: new Date(Date.now() - 30 * 86_400_000), periodEnd: new Date(),
        roi30d: displayName === "Delta Harvester" ? 184.2 : 98.4,
        realizedProfitUsd: displayName === "Delta Harvester" ? 48210 : 22680,
        realizedProfitSol: 124.4, unrealizedProfitUsd: 3850, unrealizedProfitSol: 9.9,
        winRate: 71.2, averageRoi: 9.8, averageWinRate: 14.8, averageLossRate: -5.2,
        averageHoldingSec: 12240, maxDrawdown: -11.8, tradeCount: 67, sellCount: 31, profitableTradeCount: 24,
      },
    });
  }

  await prisma.copySettings.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id, enabled: true, amountPerTradeUsd: 250, maxPositions: 8,
      maxDailyAmountUsd: 1500, stopLossPercent: 8, takeProfitPercent: 20,
      maxSlippagePercent: 2, maxWallets: 5, minLiquidityUsd: 100000,
      minMarketCapUsd: 1000000, maxDetectionSeconds: 20, maxPriceRisePercent: 5,
    },
  });
}

main().finally(() => prisma.$disconnect());
