import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { installCopyMonitor } from "./services/copy-monitor";
import { csrfOriginCheck } from "./middleware/csrf";

function buildAllowedOrigins(): string[] {
  const origins = new Set<string>();
  const addOrigin = (value?: string) => {
    const raw = value?.trim();
    if (!raw) return;
    for (const item of raw.split(",")) {
      const entry = item.trim();
      if (!entry) continue;
      if (/^https?:\/\//i.test(entry)) {
        origins.add(entry.replace(/\/+$/, ""));
      } else {
        origins.add(`https://${entry}`);
        origins.add(`http://${entry}`);
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
    addOrigin(process.env[key]);
  }

  if (process.env.NODE_ENV !== "production") {
    // Allow localhost variants in development
    for (const port of [3000, 5173, 8080, 18245]) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }
  return Array.from(origins);
}

function isAllowedOrigin(origin: string): boolean {
  const normalizedOrigin = origin.replace(/\/+$/, "");
  if (buildAllowedOrigins().includes(normalizedOrigin)) return true;
  try {
    const hostname = new URL(normalizedOrigin).hostname;
    return hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname.endsWith(".replit.app")
      || hostname.endsWith(".pike.replit.dev");
  } catch {
    return false;
  }
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        // Same-origin or non-browser request
        callback(null, true);
        return;
      }
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        logger.warn({ origin, allowedOrigins: buildAllowedOrigins() }, "CORS origin rejected");
        callback(new Error("CORS: origin not allowed"));
      }
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(csrfOriginCheck);

app.use("/api", router);
installCopyMonitor();

export default app;
