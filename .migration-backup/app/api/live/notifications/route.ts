import { requireAppSession } from "../../../lib/app-auth";
import { getNtfySubscribeUrl, isNtfyConfigured, sendTradeNotification } from "../../../lib/push-notify";

export async function GET(request: Request) {
  const unauthorized = await requireAppSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(
    {
      configured: isNtfyConfigured(),
      subscribeUrl: getNtfySubscribeUrl(),
      appInstallUrls: {
        ios: "https://apps.apple.com/app/ntfy/id1625396347",
        android: "https://play.google.com/store/apps/details?id=io.heckel.ntfy",
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const unauthorized = await requireAppSession(request);
  if (unauthorized) return unauthorized;
  const result = await sendTradeNotification("buy", {
    symbol: "TEST",
    amountUsd: 1,
    priceUsd: 1,
    executionMode: "LIVE",
  });
  return Response.json(
    {
      configured: isNtfyConfigured(),
      subscribeUrl: getNtfySubscribeUrl(),
      sent: result.sent,
      reason: result.reason,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
