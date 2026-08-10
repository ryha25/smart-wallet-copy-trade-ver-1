import { apiError } from "../../../lib/api-errors";
import { createSessionCookie, validateLogin } from "../../../lib/app-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { username?: string; passcode?: string };
    const username = body.username?.trim() ?? "";
    const passcode = body.passcode?.trim() ?? "";
    console.info("[NEXT-TRADE][auth.login]", {
      usernameLength: Array.from(username).length,
      passcodeLength: Array.from(passcode).length,
      hasAppUsername: Boolean(process.env.APP_USERNAME?.trim()),
      hasAppPasscode: Boolean(process.env.APP_PASSCODE?.trim()),
      hasSessionSecret: Boolean(process.env.SESSION_SECRET?.trim()),
      nodeVersion: process.version,
    });
    if (!username || Array.from(passcode).length !== 6) {
      return Response.json({ error: "ユーザー名と6文字のパスコードを入力してください" }, { status: 400 });
    }
    const result = validateLogin(username, passcode);
    if (!result.ok) return Response.json({ error: result.error }, { status: 401 });
    return Response.json(
      { authenticated: true, username },
      { headers: { "set-cookie": await createSessionCookie(username), "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(apiError(error, "auth.login"), { status: 500 });
  }
}
