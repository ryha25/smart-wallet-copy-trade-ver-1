import { getJupiterPaperQuote } from "../../../services/solana-live";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mint = url.searchParams.get("mint")?.trim() ?? "";
  const amountUsd = Number(url.searchParams.get("amountUsd") ?? 0);
  const slippageBps = Number(url.searchParams.get("slippageBps") ?? 50);
  try {
    const data = await getJupiterPaperQuote(mint, amountUsd, slippageBps);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Jupiter見積もりに失敗しました";
    return Response.json({ error: message }, { status: 400 });
  }
}
