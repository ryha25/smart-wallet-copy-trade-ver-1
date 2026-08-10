import { spawn } from "node:child_process";

const sharedEnvironment = { ...process.env, COPY_MONITOR_EXTERNAL_WORKER: "true" };
const server = spawn(process.execPath, [
  "node_modules/vinext/dist/cli.js",
  "start",
  "--hostname",
  "0.0.0.0",
  "--port",
  "8080",
], { stdio: "inherit", env: sharedEnvironment });
const worker = spawn(process.execPath, [
  "--import",
  "tsx",
  "scripts/copy-monitor-worker.ts",
], { stdio: "inherit", env: sharedEnvironment });

let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.kill("SIGTERM");
  worker.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 2_000).unref();
}

server.on("exit", code => shutdown(code ?? 1));
worker.on("exit", code => shutdown(code ?? 1));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
