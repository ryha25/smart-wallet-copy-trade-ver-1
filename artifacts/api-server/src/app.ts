import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { installCopyMonitor } from "./services/copy-monitor";
import { csrfOriginCheck } from "./middleware/csrf";

function buildAllowedOrigins(): string[] {
  const origins: string[] = [];
  const devDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (devDomain) {
    origins.push(`https://${devDomain}`, `http://${devDomain}`);
  }
  if (process.env.NODE_ENV !== "production") {
    // Allow localhost variants in development
    for (const port of [3000, 5173, 8080, 18245]) {
      origins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
    }
  }
  return origins;
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
      const allowed = buildAllowedOrigins();
      if (allowed.includes(origin)) {
        callback(null, true);
      } else {
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
