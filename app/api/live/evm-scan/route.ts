import { apiError } from "../../../lib/api-errors";
import { requireAppSession } from "../../../lib/app-auth";
import {
  ensureFreshEvmScan,
  installEvmScanScheduler,
  parseEvmNetwork,
  startEvmScan,
} from "../../../services/evm-wallet-scan-manager";

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const network = parseEvmNetwork(new URL(request.url).searchParams.get("network"));
    installEvmScanScheduler(network);
    const data = await ensureFreshEvmScan(network);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "evm.wallet.scan"), { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const network = parseEvmNetwork(new URL(request.url).searchParams.get("network"));
    const data = await startEvmScan(network);
    return Response.json(data, {
      status: data.status === "RUNNING" ? 202 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(apiError(error, "evm.wallet.scan.start"), { status: 500 });
  }
}
