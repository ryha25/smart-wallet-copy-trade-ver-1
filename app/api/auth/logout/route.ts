import { clearSessionCookie } from "../../../lib/app-auth";

export async function POST() {
  return Response.json(
    { authenticated: false },
    { headers: { "set-cookie": clearSessionCookie(), "cache-control": "no-store" } },
  );
}
