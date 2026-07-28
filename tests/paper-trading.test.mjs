import test from "node:test";
import assert from "node:assert/strict";

const settings = {
  enabled: true,
  amountPerTrade: 250,
  maxPositions: 8,
  maxDailyAmount: 1500,
  maxDetectionSeconds: 20,
  maxPriceRiseEnabled: true,
  maxPriceRise: 5,
  allowDuplicate: false,
};

function evaluate(signal, state) {
  if (!settings.enabled || !state.walletEnabled) return "コピー対象外";
  if (signal.detectedAfterSeconds > settings.maxDetectionSeconds) return "検知遅延超過";
  if (settings.maxPriceRiseEnabled && signal.sourcePrice && ((signal.currentPrice - signal.sourcePrice) / signal.sourcePrice) * 100 >= settings.maxPriceRise) return "価格上昇済み";
  return null;
}

test("条件内のシグナルを受け入れる", () => {
  assert.equal(evaluate({ liquidityUsd: 500000, marketCapUsd: 2000000, detectedAfterSeconds: 3, sourcePrice: 1, currentPrice: 1.02 }, { walletEnabled: true }), null);
});

test("流動性と時価総額はコピー条件に使用しない", () => {
  assert.equal(evaluate({ liquidityUsd: 0, marketCapUsd: 0, detectedAfterSeconds: 3, sourcePrice: 1, currentPrice: 1 }, { walletEnabled: true }), null);
});

test("上昇済み価格を見送る", () => {
  assert.equal(evaluate({ liquidityUsd: 500000, marketCapUsd: 2000000, detectedAfterSeconds: 3, sourcePrice: 1, currentPrice: 1.08 }, { walletEnabled: true }), "価格上昇済み");
});

test("価格上昇率をOFFにすると見送り判定を使わない", () => {
  settings.maxPriceRiseEnabled = false;
  assert.equal(evaluate({ detectedAfterSeconds: 3, sourcePrice: 1, currentPrice: 1.5 }, { walletEnabled: true }), null);
  settings.maxPriceRiseEnabled = true;
});
