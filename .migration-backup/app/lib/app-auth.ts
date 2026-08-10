const SESSION_COOKIE = "next_trade_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  username: string;
  expiresAt: number;
};

function configuredCredentials() {
  return {
    username: process.env.APP_USERNAME?.trim() ?? "",
    passcode: process.env.APP_PASSCODE?.trim() ?? "",
    secret: process.env.SESSION_SECRET?.trim() ?? "",
  };
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return "";
}

export function authConfigurationError() {
  const { username, passcode, secret } = configuredCredentials();
  if (!username || !passcode || !secret) {
    return "Replit SecretsにAPP_USERNAME、APP_PASSCODE、SESSION_SECRETを設定してください";
  }
  if (Array.from(passcode).length !== 6) {
    return "APP_PASSCODEは6文字で設定してください";
  }
  return null;
}

export function validateLogin(username: string, passcode: string) {
  const configurationError = authConfigurationError();
  if (configurationError) return { ok: false as const, error: configurationError };
  const configured = configuredCredentials();
  const valid = constantTimeEqual(username, configured.username)
    && constantTimeEqual(passcode, configured.passcode);
  return valid
    ? { ok: true as const }
    : { ok: false as const, error: "ユーザー名またはパスコードが違います" };
}

export async function createSessionCookie(username: string) {
  const { secret } = configuredCredentials();
  const payload: SessionPayload = {
    username,
    expiresAt: Date.now() + SESSION_DURATION_SECONDS * 1000,
  };
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(encoded, secret);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encoded}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function getAppSession(request: Request): Promise<SessionPayload | null> {
  const configurationError = authConfigurationError();
  if (configurationError) return null;
  const token = readCookie(request, SESSION_COOKIE);
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const encoded = token.slice(0, separator);
  const receivedSignature = token.slice(separator + 1);
  const expectedSignature = await sign(encoded, configuredCredentials().secret);
  if (!constantTimeEqual(receivedSignature, expectedSignature)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SessionPayload;
    if (!payload.username || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function requireAppSession(request: Request) {
  if (await getAppSession(request)) return null;
  return Response.json(
    { error: "ログインが必要です", details: authConfigurationError() ?? "session=missing_or_expired" },
    { status: 401 },
  );
}
