import { apiError } from "../../../lib/api-errors";
import { requireAppSession } from "../../../lib/app-auth";
import { scanWalletsForToken } from "../../../services/solana-live";

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const mint = new URL(request.url, "http://localhost").searchParams.get("mint")?.trim() ?? "";
    const data = await scanWalletsForToken(mint);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "favorite.wallets"), { status: 500 });
  }
}
