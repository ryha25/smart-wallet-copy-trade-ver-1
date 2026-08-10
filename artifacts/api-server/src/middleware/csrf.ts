import type { Request, Response, NextFunction } from "express";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Validates that mutating requests originate from the same host.
 * Browsers always include the Origin header on cross-origin requests,
 * so checking it prevents CSRF attacks from third-party sites.
 */
export function csrfOriginCheck(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!MUTATING_METHODS.has(request.method)) {
    next();
    return;
  }

  const origin = request.headers["origin"];
  if (!origin) {
    // No Origin header — non-browser client (curl, server-to-server) or
    // same-origin form POST in some browsers. Allow through; auth will gate access.
    next();
    return;
  }

  const host = request.headers["host"] ?? "";
  const devDomain = process.env.REPLIT_DEV_DOMAIN?.trim();

  try {
    const parsed = new URL(origin);

    // Same-host check (covers reverse-proxy setups where Host is forwarded)
    if (parsed.host === host) {
      next();
      return;
    }

    // Replit dev/prod domain check
    if (devDomain && parsed.hostname === devDomain) {
      next();
      return;
    }
  } catch {
    // Malformed Origin — reject
  }

  response.status(403).json({
    error: "CSRF protection: cross-origin request denied",
    code: "CSRF_REJECTED",
  });
}
