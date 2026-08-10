import { apiError } from "../../../lib/api-errors";
import { createSessionCookie, validateLogin } from "../../../lib/app-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { username?: string; passcode?: string };
    const username = body.username?.trim() ?? "";
    const passcode = body.passcode?.trim() ?? "";
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
