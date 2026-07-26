import { analyzeWallet } from "../../../services/solana-live";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim() ?? "";
  try {
    const data = await analyzeWallet(address);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ウォレット評価に失敗しました";
    return Response.json({ error: message }, { status: 400 });
  }
}
