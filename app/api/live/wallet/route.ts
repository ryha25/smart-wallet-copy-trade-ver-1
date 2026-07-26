import { getLiveWalletActivity } from "../../../services/solana-live";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim() ?? "";
  try {
    const data = await getLiveWalletActivity(address);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "実データの取得に失敗しました";
    return Response.json({ error: message }, { status: 400 });
  }
}
