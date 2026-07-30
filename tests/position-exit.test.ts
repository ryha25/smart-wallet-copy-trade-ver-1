import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePositionExit } from "../app/lib/paper-trading";

const settings = {
  stopLossEnabled: true,
  stopLoss: 12,
  takeProfitEnabled: true,
  takeProfit: 20,
};

test("12%未満の下落ではSTOP_LOSSを発動しない", () => {
  assert.equal(evaluatePositionExit(100, 88.01, settings).reason, null);
});

test("12%到達時にSTOP_LOSSを発動する", () => {
  const result = evaluatePositionExit(100, 88, settings);
  assert.equal(result.reason, "STOP_LOSS");
  assert.equal(result.pnlPercent, -12);
});

test("1回の価格更新で66%急落しても即座にSTOP_LOSS判定する", () => {
  const result = evaluatePositionExit(100, 34, settings);
  assert.equal(result.reason, "STOP_LOSS");
  assert.equal(result.pnlPercent, -66);
});

test("損切りOFFの場合は下落を無視する", () => {
  assert.equal(evaluatePositionExit(100, 34, { ...settings, stopLossEnabled: false }).reason, null);
});
