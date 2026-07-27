import { apiError } from "../../../lib/api-errors";
import { requireAppSession } from "../../../lib/app-auth";
import { scanProfitableWallets } from "../../../services/solana-live";

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const data = await scanProfitableWallets();
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "wallet.scan"), { status: 500 });
  }
}
