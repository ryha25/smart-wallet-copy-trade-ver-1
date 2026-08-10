import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const SESSION_COOKIE = "next_trade_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = { username: string; expiresAt: number };

function credentials() {
  return {
    username: process.env["APP_USERNAME"]?.trim() ?? "",
    passcode: process.env["APP_PASSCODE"]?.trim() ?? "",
    secret: process.env["SESSION_SECRET"]?.trim() ?? "",
  };
}

function sign(value: string) {
  return createHmac("sha256", credentials().secret).update(value).digest("base64url");
}

function equal(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function authConfigurationError() {
  const { username, passcode, secret } = credentials();
  if (!username || !passcode || !secret) {
    return "Replit SecretsにAPP_USERNAME、APP_PASSCODE、SESSION_SECRETを設定してください";
  }
  if (Array.from(passcode).length !== 6) return "APP_PASSCODEは6文字で設定してください";
  return null;
}

export function validateLogin(username: string, passcode: string) {
  const configurationError = authConfigurationError();
  if (configurationError) return { ok: false as const, error: configurationError };
  const configured = credentials();
  return equal(username, configured.username) && equal(passcode, configured.passcode)
    ? { ok: true as const }
    : { ok: false as const, error: "ユーザー名またはパスコードが違います" };
}

export function createSessionToken(username: string) {
  const payload: SessionPayload = {
    username,
    expiresAt: Date.now() + SESSION_DURATION_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function getSession(request: Request): SessionPayload | null {
  if (authConfigurationError()) return null;
  const token = String(request.cookies?.[SESSION_COOKIE] ?? "");
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const encoded = token.slice(0, separator);
  if (!equal(token.slice(separator + 1), sign(encoded))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    return payload.username && payload.expiresAt > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(response: Response, token: string) {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    maxAge: SESSION_DURATION_SECONDS * 1000,
    path: "/",
  });
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
}

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  if (getSession(request)) {
    next();
    return;
  }
  response.status(401).json({
    error: "ログインが必要です",
    details: authConfigurationError() ?? "session=missing_or_expired",
  });
}
