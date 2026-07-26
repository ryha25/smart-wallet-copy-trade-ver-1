import { getTokenQuotes } from "../../../services/solana-live";

export async function GET(request: Request) {
  const mint = new URL(request.url).searchParams.get("mint")?.trim() ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return Response.json({ error: "SolanaのCAを確認してください" }, { status: 400 });
  }
  try {
    const quote = (await getTokenQuotes([mint])).get(mint);
    if (!quote) {
      return Response.json({ error: "DEX上の実データを取得できないため登録できません" }, { status: 404 });
    }
    return Response.json(quote, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "コイン情報の取得に失敗しました";
    return Response.json({ error: message }, { status: 500 });
  }
}
