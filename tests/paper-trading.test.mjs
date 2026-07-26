import test from "node:test";
import assert from "node:assert/strict";

const settings = { enabled:true, amountPerTrade:250, maxPositions:8, maxDailyAmount:1500, minLiquidity:100000, minMarketCap:1000000, maxDetectionSeconds:20, maxPriceRise:5, allowDuplicate:false, favoritesOnly:false };
function evaluate(signal,state) {
  if (!settings.enabled || !state.walletEnabled) return "コピー対象外";
  if (!signal.riskPassed) return "危険トークン";
  if (signal.liquidityUsd < settings.minLiquidity) return "流動性不足";
  if (signal.detectedAfterSeconds > settings.maxDetectionSeconds) return "検知遅延超過";
  if (((signal.currentPrice-signal.sourcePrice)/signal.sourcePrice)*100 >= settings.maxPriceRise) return "価格上昇済み";
  return null;
}

test("安全なシグナルを受け入れる", () => {
  assert.equal(evaluate({riskPassed:true,liquidityUsd:500000,detectedAfterSeconds:3,sourcePrice:1,currentPrice:1.02},{walletEnabled:true}), null);
});
test("低流動性を見送る", () => {
  assert.equal(evaluate({riskPassed:true,liquidityUsd:1000,detectedAfterSeconds:3,sourcePrice:1,currentPrice:1},{walletEnabled:true}), "流動性不足");
});
test("上昇済み価格を見送る", () => {
  assert.equal(evaluate({riskPassed:true,liquidityUsd:500000,detectedAfterSeconds:3,sourcePrice:1,currentPrice:1.08},{walletEnabled:true}), "価格上昇済み");
});
