import { authConfigurationError, getAppSession } from "../../../lib/app-auth";

export async function GET(request: Request) {
  const session = await getAppSession(request);
  return Response.json(
    session
      ? { authenticated: true, username: session.username }
      : { authenticated: false, configurationError: authConfigurationError() },
    { status: session ? 200 : 401, headers: { "cache-control": "no-store" } },
  );
}
