import { requireAppSession } from "../../../lib/app-auth";
import { apiError } from "../../../lib/api-errors";
import { getLiveTradingStatus } from "../../../services/live-trading";

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    return Response.json(await getLiveTradingStatus(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "live-trading.status"), { status: 500 });
  }
}
