import test from "node:test";
import assert from "node:assert/strict";

const settings = {
  enabled: true,
  amountPerTrade: 250,
  maxPositions: 8,
  maxDailyAmount: 1500,
  minLiquidity: 100000,
  minMarketCap: 1000000,
  maxDetectionSeconds: 20,
  maxPriceRise: 5,
  allowDuplicate: false,
};

function evaluate(signal, state) {
  if (!settings.enabled || !state.walletEnabled) return "コピー対象外";
  if (signal.liquidityUsd < settings.minLiquidity) return "流動性不足";
  if (signal.marketCapUsd < settings.minMarketCap) return "最低時価総額未満";
  if (signal.detectedAfterSeconds > settings.maxDetectionSeconds) return "検知遅延超過";
  if (signal.sourcePrice && ((signal.currentPrice - signal.sourcePrice) / signal.sourcePrice) * 100 >= settings.maxPriceRise) return "価格上昇済み";
  return null;
}

test("条件内のシグナルを受け入れる", () => {
  assert.equal(evaluate({ liquidityUsd: 500000, marketCapUsd: 2000000, detectedAfterSeconds: 3, sourcePrice: 1, currentPrice: 1.02 }, { walletEnabled: true }), null);
});

test("低流動性を見送る", () => {
  assert.equal(evaluate({ liquidityUsd: 1000, marketCapUsd: 2000000, detectedAfterSeconds: 3, sourcePrice: 1, currentPrice: 1 }, { walletEnabled: true }), "流動性不足");
});

test("上昇済み価格を見送る", () => {
  assert.equal(evaluate({ liquidityUsd: 500000, marketCapUsd: 2000000, detectedAfterSeconds: 3, sourcePrice: 1, currentPrice: 1.08 }, { walletEnabled: true }), "価格上昇済み");
});
