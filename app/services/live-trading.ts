import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { prisma } from "../lib/prisma";
import type { LiveTradingStatus } from "../lib/types";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_SWAP_URL = "https://api.jup.ag/swap/v2";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

type SwapSide = "BUY" | "SELL";

type JupiterOrder = {
  transaction?: string;
  requestId?: string;
  outAmount?: string;
  error?: string;
  errorMessage?: string;
};

type JupiterExecution = {
  status?: string;
  signature?: string;
  code?: number;
  totalInputAmount?: string;
  totalOutputAmount?: string;
  inputAmountResult?: string;
  outputAmountResult?: string;
  error?: string;
};

export type LiveSwapResult = {
  signature: string;
  inputAmount: string;
  outputAmount: string;
  requestId: string;
  orderRequestedAt: string;
  orderReceivedAt: string;
  executeSubmittedAt: string;
  executeCompletedAt: string;
};

function decodeBase58(value: string) {
  const bytes = [0];
  for (const character of value) {
    const index = BASE58_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("秘密鍵のBase58形式が正しくありません");
    let carry = index;
    for (let position = 0; position < bytes.length; position++) {
      carry += bytes[position] * 58;
      bytes[position] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let index = 0; value[index] === "1" && index < value.length - 1; index++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

function parseSecretKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("TRADING_WALLET_SECRET_KEYが未設定です");
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some(item => !Number.isInteger(item) || item < 0 || item > 255)) {
      throw new Error("秘密鍵のJSON配列は0〜255の64個の整数で指定してください");
    }
    return Uint8Array.from(parsed as number[]);
  }
  const decoded = decodeBase58(trimmed);
  if (decoded.length !== 64) throw new Error(`秘密鍵は64バイト必要です（現在${decoded.length}バイト）`);
  return decoded;
}

function loadTradingWallet() {
  const secret = process.env.TRADING_WALLET_SECRET_KEY ?? "";
  const expectedAddress = process.env.TRADING_WALLET_PUBLIC_KEY?.trim();
  if (!expectedAddress) throw new Error("TRADING_WALLET_PUBLIC_KEYが未設定です");
  const wallet = Keypair.fromSecretKey(parseSecretKey(secret));
  const actualAddress = wallet.publicKey.toBase58();
  if (actualAddress !== expectedAddress) {
    throw new Error("秘密鍵から導出した公開鍵がTRADING_WALLET_PUBLIC_KEYと一致しません");
  }
  return wallet;
}

function requireLiveEnvironment() {
  if (process.env.LIVE_TRADING_ENABLED !== "true") {
    throw new Error("Replit SecretのLIVE_TRADING_ENABLEDがtrueではありません");
  }
  if (!process.env.JUPITER_API_KEY?.trim()) throw new Error("JUPITER_API_KEYが未設定です");
  return loadTradingWallet();
}

function getConnection() {
  return new Connection(
    process.env.SOLANA_RPC_URL?.trim()
      || process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
      || "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
}

async function readJson<T>(response: Response, operation: string): Promise<T> {
  const raw = await response.text();
  let body: T & { error?: string; errorMessage?: string };
  try {
    body = JSON.parse(raw) as T & { error?: string; errorMessage?: string };
  } catch {
    throw new Error(`${operation}のレスポンスがJSONではありません (HTTP ${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`${operation}失敗 (HTTP ${response.status}): ${body.errorMessage ?? body.error ?? raw.slice(0, 300)}`);
  }
  return body;
}

export async function getLiveTradingStatus(): Promise<LiveTradingStatus> {
  const environmentEnabled = process.env.LIVE_TRADING_ENABLED === "true";
  try {
    const wallet = loadTradingWallet();
    const connection = getConnection();
    const [lamports, tokenAccounts] = await Promise.all([
      connection.getBalance(wallet.publicKey),
      connection.getParsedTokenAccountsByOwner(wallet.publicKey, { mint: new PublicKey(USDC_MINT) }),
    ]);
    const usdcBalance = tokenAccounts.value.reduce((total, account) => {
      const value = account.account.data.parsed.info.tokenAmount.uiAmountString;
      return total + Number(value ?? 0);
    }, 0);
    return {
      environmentEnabled,
      configured: Boolean(process.env.JUPITER_API_KEY?.trim()),
      ready: environmentEnabled && Boolean(process.env.JUPITER_API_KEY?.trim()),
      address: wallet.publicKey.toBase58(),
      solBalance: lamports / 1_000_000_000,
      usdcBalance,
      error: null,
    };
  } catch (error) {
    return {
      environmentEnabled,
      configured: false,
      ready: false,
      address: process.env.TRADING_WALLET_PUBLIC_KEY?.trim() || null,
      solBalance: null,
      usdcBalance: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getMintDecimals(mint: string) {
  const supply = await getConnection().getTokenSupply(new PublicKey(mint));
  return supply.value.decimals;
}

export async function getLiveTokenRawBalance(mint: string) {
  const wallet = loadTradingWallet();
  const accounts = await getConnection().getParsedTokenAccountsByOwner(
    wallet.publicKey,
    { mint: new PublicKey(mint) },
  );
  return accounts.value.reduce((total, account) => {
    const amount = account.account.data.parsed.info.tokenAmount.amount;
    return total + BigInt(String(amount ?? "0"));
  }, BigInt(0));
}

export async function executeLiveSwap(input: {
  idempotencyKey: string;
  userId: string;
  sourceWalletId: string;
  paperPositionId?: string;
  side: SwapSide;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  maxSlippagePercent: number;
}): Promise<LiveSwapResult> {
  if (!prisma) throw new Error("DATABASE_URLが未設定です");
  const wallet = requireLiveEnvironment();

  const existing = await prisma.liveTradeExecution.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing?.status === "SUCCESS" && existing.signature && existing.outputAmount && existing.requestId) {
    const completedAt = existing.updatedAt.toISOString();
    return {
      signature: existing.signature,
      inputAmount: existing.inputAmount,
      outputAmount: existing.outputAmount,
      requestId: existing.requestId,
      orderRequestedAt: existing.createdAt.toISOString(),
      orderReceivedAt: completedAt,
      executeSubmittedAt: completedAt,
      executeCompletedAt: completedAt,
    };
  }
  if (existing?.status === "EXECUTING") {
    throw new Error("同じ注文がすでに実行中です。二重発注を防止しました");
  }

  if (existing) {
    await prisma.liveTradeExecution.update({
      where: { id: existing.id },
      data: { status: "EXECUTING", error: null, inputAmount: input.inputAmount },
    });
  } else {
    await prisma.liveTradeExecution.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        userId: input.userId,
        sourceWalletId: input.sourceWalletId,
        paperPositionId: input.paperPositionId,
        side: input.side,
        status: "EXECUTING",
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        inputAmount: input.inputAmount,
      },
    });
  }

  try {
    const orderRequestedAt = new Date();
    const query = new URLSearchParams({
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      amount: input.inputAmount,
      taker: wallet.publicKey.toBase58(),
      slippageBps: String(Math.max(1, Math.round(input.maxSlippagePercent * 100))),
    });
    const orderResponse = await fetch(`${JUPITER_SWAP_URL}/order?${query}`, {
      headers: { "x-api-key": process.env.JUPITER_API_KEY! },
      signal: AbortSignal.timeout(30_000),
    });
    const order = await readJson<JupiterOrder>(orderResponse, "Jupiter注文作成");
    const orderReceivedAt = new Date();
    if (!order.transaction || !order.requestId) {
      throw new Error(`Jupiterで交換ルートを作成できません: ${order.errorMessage ?? order.error ?? "取引データなし"}`);
    }

    await prisma.liveTradeExecution.update({
      where: { idempotencyKey: input.idempotencyKey },
      data: { requestId: order.requestId },
    });
    const transaction = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
    transaction.sign([wallet]);
    const signedTransaction = Buffer.from(transaction.serialize()).toString("base64");
    const executeSubmittedAt = new Date();
    console.info("[NEXT-TRADE][live.swap.submitted]", {
      side: input.side,
      idempotencyKey: input.idempotencyKey,
      requestId: order.requestId,
      submittedAt: executeSubmittedAt.toISOString(),
    });
    const executeResponse = await fetch(`${JUPITER_SWAP_URL}/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.JUPITER_API_KEY!,
      },
      body: JSON.stringify({ signedTransaction, requestId: order.requestId }),
      signal: AbortSignal.timeout(60_000),
    });
    const execution = await readJson<JupiterExecution>(executeResponse, "Jupiter注文実行");
    const executeCompletedAt = new Date();
    const outputAmount = execution.totalOutputAmount ?? execution.outputAmountResult;
    const inputAmount = execution.totalInputAmount ?? execution.inputAmountResult ?? input.inputAmount;
    if (execution.status !== "Success" || !execution.signature || !outputAmount) {
      throw new Error(`Jupiter注文が成立しませんでした: ${execution.error ?? `code=${execution.code ?? "unknown"}`}`);
    }

    await prisma.liveTradeExecution.update({
      where: { idempotencyKey: input.idempotencyKey },
      data: {
        status: "SUCCESS",
        signature: execution.signature,
        inputAmount,
        outputAmount,
        error: null,
      },
    });
    console.info("[NEXT-TRADE][live.swap.success]", {
      side: input.side,
      signature: execution.signature,
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      inputAmount,
      outputAmount,
      orderLatencyMs: orderReceivedAt.getTime() - orderRequestedAt.getTime(),
      executionLatencyMs: executeCompletedAt.getTime() - executeSubmittedAt.getTime(),
    });
    return {
      signature: execution.signature,
      inputAmount,
      outputAmount,
      requestId: order.requestId,
      orderRequestedAt: orderRequestedAt.toISOString(),
      orderReceivedAt: orderReceivedAt.toISOString(),
      executeSubmittedAt: executeSubmittedAt.toISOString(),
      executeCompletedAt: executeCompletedAt.toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.liveTradeExecution.update({
      where: { idempotencyKey: input.idempotencyKey },
      data: { status: "FAILED", error: message.slice(0, 2000) },
    }).catch(() => undefined);
    console.error("[NEXT-TRADE][live.swap.failed]", {
      side: input.side,
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      error: message,
    });
    throw error;
  }
}
