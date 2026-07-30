import { runCopyMonitorCycle, runPositionMonitorCycle } from "../app/services/copy-monitor";

const intervalSeconds = Math.max(10, Number(process.env.COPY_MONITOR_INTERVAL_SECONDS ?? "15") || 15);
const positionIntervalMs = Math.max(
  1_000,
  Number(process.env.POSITION_MONITOR_INTERVAL_MS ?? "1000") || 1_000,
);
let stopping = false;

async function cycle() {
  if (stopping) return;
  try {
    await runCopyMonitorCycle();
  } catch (error) {
    console.error("[NEXT-TRADE][copy.worker]", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

console.info("[NEXT-TRADE][copy.worker]", `バックグラウンド監視を${intervalSeconds}秒間隔で開始`);
await cycle();
const timer = setInterval(() => void cycle(), intervalSeconds * 1000);
const positionTimer = setInterval(() => void runPositionMonitorCycle().catch(error => {
  console.error("[NEXT-TRADE][position.worker]", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}), positionIntervalMs);
await runPositionMonitorCycle();

function shutdown(signal: string) {
  stopping = true;
  clearInterval(timer);
  clearInterval(positionTimer);
  console.info("[NEXT-TRADE][copy.worker]", `${signal}を受信したため停止`);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
