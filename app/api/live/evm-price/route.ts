import { apiError } from "../../../lib/api-errors";
import { requireAppSession } from "../../../lib/app-auth";
import { getEthereumPrice } from "../../../services/evm-live";

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const data = await getEthereumPrice();
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "evm.ethereum.price"), { status: 500 });
  }
}
