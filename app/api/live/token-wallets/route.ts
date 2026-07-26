import { scanWalletsForToken } from "../../../services/solana-live";

export async function GET(request: Request) {
  const mint = new URL(request.url).searchParams.get("mint")?.trim() ?? "";
  try {
    const data = await scanWalletsForToken(mint);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "対象コインのウォレット分析に失敗しました";
    return Response.json({ error: message }, { status: 500 });
  }
}
