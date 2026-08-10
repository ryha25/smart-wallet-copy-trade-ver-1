import { PublicKey } from "@solana/web3.js";
import { apiError } from "../../../lib/api-errors";
import { requireAppSession } from "../../../lib/app-auth";
import { getTokenQuotes } from "../../../services/solana-live";

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;

    const mint = new URL(request.url, "http://localhost").searchParams.get("mint")?.trim() ?? "";
    console.info("[NEXT-TRADE][favorite.token] input CA", { mint });
    try {
      new PublicKey(mint);
    } catch (publicKeyError) {
      throw new Error(`CAをPublicKeyとして解析できません: ${mint}`, { cause: publicKeyError });
    }

    const quote = (await getTokenQuotes([mint])).get(mint);
    if (!quote) {
      return Response.json(
        { error: "DexScreenerで取引ペアが見つかりません", details: `mint=${mint}, pairs=empty` },
        { status: 404 },
      );
    }
    return Response.json(quote, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "favorite.token"), { status: 400 });
  }
}
