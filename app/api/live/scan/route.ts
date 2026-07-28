import { apiError } from "../../../lib/api-errors";
import { requireAppSession } from "../../../lib/app-auth";
import { ensureFreshWalletScan, startWalletScan } from "../../../services/wallet-scan-manager";

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const data = await ensureFreshWalletScan();
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "wallet.scan"), { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const data = await startWalletScan();
    return Response.json(data, {
      status: data.status === "RUNNING" ? 202 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(apiError(error, "wallet.scan.start"), { status: 500 });
  }
}
