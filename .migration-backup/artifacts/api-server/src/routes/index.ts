import { Router, type IRouter } from "express";
import healthRouter from "./health";
import liveRouter from "./live";
import authRouter from "./auth";
import { requireAuth } from "../lib/app-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/live", requireAuth, liveRouter);

export default router;
