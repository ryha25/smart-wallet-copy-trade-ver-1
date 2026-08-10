import { Router } from "express";
import {
  authConfigurationError,
  clearSessionCookie,
  createSessionToken,
  getSession,
  setSessionCookie,
  validateLogin,
} from "../lib/app-auth";
import { apiError } from "../lib/api-errors";

const router = Router();

router.get("/session", (request, response) => {
  const session = getSession(request);
  response
    .status(session ? 200 : 401)
    .setHeader("cache-control", "no-store")
    .json(session
      ? { authenticated: true, username: session.username }
      : { authenticated: false, configurationError: authConfigurationError() });
});

router.post("/login", (request, response) => {
  try {
    const username = String(request.body?.username ?? "").trim();
    const passcode = String(request.body?.passcode ?? "").trim();
    if (!username || Array.from(passcode).length !== 6) {
      response.status(400).json({ error: "ユーザー名と6文字のパスコードを入力してください" });
      return;
    }
    const result = validateLogin(username, passcode);
    if (!result.ok) {
      response.status(401).json({ error: result.error });
      return;
    }
    setSessionCookie(response, createSessionToken(username));
    response.setHeader("cache-control", "no-store").json({ authenticated: true, username });
  } catch (error) {
    response.status(500).json(apiError(error, "auth.login"));
  }
});

router.post("/logout", (_request, response) => {
  clearSessionCookie(response);
  response.setHeader("cache-control", "no-store").json({ authenticated: false });
});

export default router;
