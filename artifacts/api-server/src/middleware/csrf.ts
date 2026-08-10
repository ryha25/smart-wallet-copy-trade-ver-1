import type { Request, Response, NextFunction } from "express";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function configuredHosts(): Set<string> {
  const hosts = new Set<string>();
  const addHost = (value?: string) => {
    const raw = value?.trim();
    if (!raw) return;
    for (const item of raw.split(",")) {
      const entry = item.trim();
      if (!entry) continue;
      try {
        hosts.add(new URL(/^https?:\/\//i.test(entry) ? entry : `https://${entry}`).host);
      } catch {
        // Ignore malformed environment values.
      }
    }
  };

  for (const key of [
    "APP_ORIGIN",
    "PUBLIC_APP_URL",
    "NEXT_PUBLIC_APP_URL",
    "REPLIT_DOMAINS",
    "REPLIT_DEV_DOMAIN",
  ]) {
    addHost(process.env[key]);
  }
  return hosts;
}

function isTrustedReplitHost(hostname: string): boolean {
  return hostname.endsWith(".replit.app") || hostname.endsWith(".pike.replit.dev");
}

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

  try {
    const parsed = new URL(origin);

    // Same-host check (covers reverse-proxy setups where Host is forwarded)
    if (parsed.host === host) {
      next();
      return;
    }

    // Replit dev/prod domain check
    if (configuredHosts().has(parsed.host) || isTrustedReplitHost(parsed.hostname)) {
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
