import { apiError } from "../../../lib/api-errors";
import { requireAppSession } from "../../../lib/app-auth";
import { getJupiterPaperQuote } from "../../../services/solana-live";

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const url = new URL(request.url, "http://localhost");
    const mint = url.searchParams.get("mint")?.trim() ?? "";
    const amountUsd = Number(url.searchParams.get("amountUsd") ?? 0);
    const slippageBps = Number(url.searchParams.get("slippageBps") ?? 50);
    const data = await getJupiterPaperQuote(mint, amountUsd, slippageBps);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "jupiter.quote"), { status: 400 });
  }
}
