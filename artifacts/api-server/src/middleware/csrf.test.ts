import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import { csrfOriginCheck } from "./csrf";

// A minimal Express app wired with the CSRF middleware followed by a
// route that returns 200 so we can distinguish "allowed through" from "blocked".
function buildApp(devDomain?: string) {
  if (devDomain !== undefined) {
    process.env.REPLIT_DEV_DOMAIN = devDomain;
  } else {
    delete process.env.REPLIT_DEV_DOMAIN;
  }
  const app = express();
  app.use(csrfOriginCheck);
  // Sentinel endpoint for all methods
  app.use((_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("csrfOriginCheck middleware", () => {
  describe("mutating methods with cross-origin Origin header", () => {
    const app = buildApp("my-repl.example.repl.co");

    for (const method of ["post", "put", "patch", "delete"] as const) {
      it(`rejects ${method.toUpperCase()} with foreign origin`, async () => {
        const res = await (request(app) as any)[method]("/api/test")
          .set("Origin", "https://attacker.example.com")
          .set("Host", "my-repl.example.repl.co");
        expect(res.status).toBe(403);
        expect((res.body as { code?: string }).code).toBe("CSRF_REJECTED");
      });
    }
  });

  describe("mutating methods with same-host Origin header", () => {
    const app = buildApp("my-repl.example.repl.co");

    it("allows POST when Origin matches REPLIT_DEV_DOMAIN", async () => {
      const res = await request(app)
        .post("/api/test")
        .set("Origin", "https://my-repl.example.repl.co")
        .set("Host", "my-repl.example.repl.co");
      expect(res.status).toBe(200);
    });

    it("allows POST when Origin host matches Host header exactly", async () => {
      const app2 = buildApp(undefined);
      const res = await request(app2)
        .post("/api/test")
        .set("Origin", "http://localhost:8080")
        .set("Host", "localhost:8080");
      expect(res.status).toBe(200);
    });
  });

  describe("mutating methods with no Origin header", () => {
    const app = buildApp("my-repl.example.repl.co");

    it("allows POST with no Origin (non-browser / same-origin request)", async () => {
      const res = await request(app)
        .post("/api/test")
        .set("Host", "my-repl.example.repl.co");
      expect(res.status).toBe(200);
    });
  });

  describe("safe methods are never blocked", () => {
    const app = buildApp("my-repl.example.repl.co");

    for (const method of ["get", "head", "options"] as const) {
      it(`passes ${method.toUpperCase()} through even with foreign origin`, async () => {
        const res = await (request(app) as any)[method]("/api/test")
          .set("Origin", "https://attacker.example.com");
        // 200 = reached the sentinel; OPTIONS may return 200 or 204 depending on body
        expect(res.status).toBeLessThan(400);
      });
    }
  });
});
