import { Router } from "express";
import { getLiveWalletActivity } from "../services/solana-live";

const router = Router();

router.get("/live/wallet", async (req, res) => {
  const address = (req.query["address"] as string | undefined)?.trim() ?? "";
  try {
    const data = await getLiveWalletActivity(address);
    res.setHeader("cache-control", "no-store");
    res.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "実データの取得に失敗しました";
    res.status(400).json({ error: message });
  }
});

export default router;
