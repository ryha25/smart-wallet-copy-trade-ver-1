import { apiError } from "../../../lib/api-errors";
import { requireAppSession } from "../../../lib/app-auth";
import { analyzeWallet } from "../../../services/solana-live";

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const address = new URL(request.url, "http://localhost").searchParams.get("address")?.trim() ?? "";
    const data = await analyzeWallet(address);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "wallet.score"), { status: 400 });
  }
}
