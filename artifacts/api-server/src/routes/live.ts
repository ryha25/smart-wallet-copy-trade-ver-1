import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import { apiError } from "../lib/api-errors";
import {
  analyzeWallet,
  getJupiterPaperQuote,
  getLiveWalletActivity,
  getTokenQuotes,
  getTokenRisk,
  scanWalletsForToken,
} from "../services/solana-live";
import {
  ensureFreshWalletScan,
  installWalletScanScheduler,
  startWalletScan,
} from "../services/wallet-scan-manager";
import {
  ensureFreshEvmScan,
  installEvmScanScheduler,
  parseEvmNetwork,
  startEvmScan,
} from "../services/evm-wallet-scan-manager";

const router = Router();

router.get("/token", async (request, response) => {
  const mint = String(request.query["mint"] ?? "").trim();
  console.info("[NEXT-TRADE][favorite.token] input CA", { mint });
  try {
    try {
      new PublicKey(mint);
    } catch (publicKeyError) {
      throw new Error(`CAをPublicKeyとして解析できません: ${mint}`, { cause: publicKeyError });
    }
    const quote = (await getTokenQuotes([mint])).get(mint);
    if (!quote) {
      response.status(404).json({
        error: "DexScreenerで取引ペアが見つかりません",
        details: `mint=${mint}, pairs=empty`,
      });
      return;
    }
    response.setHeader("cache-control", "no-store").json(quote);
  } catch (error) {
    response.status(400).json(apiError(error, "favorite.token"));
  }
});

router.get("/token-wallets", async (request, response) => {
  try {
    const mint = String(request.query["mint"] ?? "").trim();
    const data = await scanWalletsForToken(mint);
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "favorite.wallets"));
  }
});

router.get("/risk", async (request, response) => {
  try {
    const data = await getTokenRisk(String(request.query["mint"] ?? "").trim());
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "token.risk"));
  }
});

router.get("/quote", async (request, response) => {
  try {
    const data = await getJupiterPaperQuote(
      String(request.query["mint"] ?? "").trim(),
      Number(request.query["amountUsd"] ?? 0),
      Number(request.query["slippageBps"] ?? 50),
    );
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(400).json(apiError(error, "jupiter.quote"));
  }
});

router.get("/wallet", async (request, response) => {
  try {
    const data = await getLiveWalletActivity(String(request.query["address"] ?? "").trim());
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(400).json(apiError(error, "wallet.activity"));
  }
});

router.get("/score", async (request, response) => {
  try {
    const data = await analyzeWallet(String(request.query["address"] ?? "").trim());
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(400).json(apiError(error, "wallet.score"));
  }
});

router.get("/scan", async (_request, response) => {
  try {
    installWalletScanScheduler();
    const data = await ensureFreshWalletScan();
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "wallet.scan"));
  }
});

router.post("/scan", async (_request, response) => {
  try {
    const data = await startWalletScan();
    response.status(data.status === "RUNNING" ? 202 : 200);
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "wallet.scan.start"));
  }
});

router.get("/evm-scan", async (request, response) => {
  try {
    const network = parseEvmNetwork(String(request.query["network"] ?? ""));
    installEvmScanScheduler(network);
    const data = await ensureFreshEvmScan(network);
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "evm.wallet.scan"));
  }
});

router.post("/evm-scan", async (request, response) => {
  try {
    const network = parseEvmNetwork(String(request.query["network"] ?? ""));
    const data = await startEvmScan(network);
    response.status(data.status === "RUNNING" ? 202 : 200);
    response.setHeader("cache-control", "no-store").json(data);
  } catch (error) {
    response.status(500).json(apiError(error, "evm.wallet.scan.start"));
  }
});

export default router;
