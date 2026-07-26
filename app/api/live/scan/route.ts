import { scanProfitableWallets } from "../../../services/solana-live";

export async function GET() {
  try {
    const data = await scanProfitableWallets();
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ウォレットスキャンに失敗しました";
    return Response.json({ error: message }, { status: 500 });
  }
}
