/**
 * ntfy.sh を使ったプッシュ通知
 *
 * 設定方法:
 *   1. スマホに "ntfy" アプリをインストール (iOS / Android)
 *   2. 環境変数 NTFY_TOPIC に任意のランダム文字列を設定 (例: next-trade-abc123)
 *   3. ntfy アプリで https://ntfy.sh/{NTFY_TOPIC} を購読
 *
 * オプション:
 *   NTFY_URL  — セルフホストの場合にベースURLを変更 (デフォルト: https://ntfy.sh)
 *   NTFY_TOKEN — ntfy.sh のアクセストークン (プライベートトピックの場合)
 */

const NTFY_BASE = (process.env.NTFY_URL ?? "https://ntfy.sh").replace(/\/$/, "");
const NTFY_TOPIC = process.env.NTFY_TOPIC?.trim();
const NTFY_TOKEN = process.env.NTFY_TOKEN?.trim();

export type NotifyEvent =
  | "buy"
  | "sell"
  | "stop_loss"
  | "take_profit"
  | "limit_buy"
  | "limit_sell"
  | "force_close";

export interface NotifyPayload {
  symbol: string;
  amountUsd?: number;
  pnlUsd?: number;
  pnlPct?: number;
  priceUsd?: number;
  executionMode?: "LIVE" | "PAPER";
}

export async function sendTradeNotification(
  event: NotifyEvent,
  payload: NotifyPayload,
): Promise<void> {
  if (!NTFY_TOPIC) return; // 未設定ならスキップ

  const { symbol, amountUsd, pnlUsd, pnlPct, priceUsd, executionMode = "LIVE" } = payload;
  const mode = executionMode === "LIVE" ? "💰" : "📄";
  const pnlSign = (pnlUsd ?? 0) >= 0 ? "+" : "";
  const priceStr = priceUsd ? ` @ $${priceUsd.toPrecision(4)}` : "";

  const cfg: { title: string; body: string; priority: number; tags: string[] } = (() => {
    switch (event) {
      case "buy":
        return {
          title: `${mode} ${symbol} 購入`,
          body: `投資額: $${amountUsd?.toFixed(2) ?? "?"}${priceStr}`,
          priority: 3,
          tags: ["chart_with_upwards_trend"],
        };
      case "sell":
        return {
          title: `${mode} ${symbol} 決済`,
          body: `損益: ${pnlSign}$${pnlUsd?.toFixed(2) ?? "?"} (${pnlSign}${pnlPct?.toFixed(1) ?? "?"}%)${priceStr}`,
          priority: (pnlUsd ?? 0) >= 0 ? 4 : 3,
          tags: [(pnlUsd ?? 0) >= 0 ? "tada" : "chart_with_downwards_trend"],
        };
      case "stop_loss":
        return {
          title: `🛑 損切り: ${symbol}`,
          body: `損益: ${pnlSign}$${pnlUsd?.toFixed(2) ?? "?"} (${pnlPct?.toFixed(1) ?? "?"}%)${priceStr}`,
          priority: 5,
          tags: ["rotating_light"],
        };
      case "take_profit":
        return {
          title: `🎉 利確: ${symbol}`,
          body: `損益: ${pnlSign}$${pnlUsd?.toFixed(2) ?? "?"} (+${pnlPct?.toFixed(1) ?? "?"}%)${priceStr}`,
          priority: 5,
          tags: ["tada"],
        };
      case "limit_buy":
        return {
          title: `🎯 指値買い発動: ${symbol}`,
          body: `$${amountUsd?.toFixed(2) ?? "?"} USDC 購入${priceStr}`,
          priority: 4,
          tags: ["white_check_mark"],
        };
      case "limit_sell":
        return {
          title: `🎯 指値売り発動: ${symbol}`,
          body: `損益: ${pnlSign}$${pnlUsd?.toFixed(2) ?? "?"}${priceStr}`,
          priority: 4,
          tags: ["white_check_mark"],
        };
      case "force_close":
        return {
          title: `⚠️ 強制CLOSED: ${symbol}`,
          body: `ゴーストポジションを強制決済`,
          priority: 3,
          tags: ["warning"],
        };
    }
  })();

  const headers: Record<string, string> = {
    "Title": encodeRFC5987(cfg.title),
    "Priority": String(cfg.priority),
    "Tags": cfg.tags.join(","),
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (NTFY_TOKEN) headers["Authorization"] = `Bearer ${NTFY_TOKEN}`;

  try {
    const res = await fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, {
      method: "POST",
      headers,
      // Node.js built-in fetch requires body to be a Buffer for non-ASCII text
      body: Buffer.from(cfg.body, "utf-8"),
    });
    if (!res.ok) {
      console.warn("[NEXT-TRADE][push-notify]", `ntfy returned ${res.status}`);
    }
  } catch (error) {
    console.warn("[NEXT-TRADE][push-notify]", "通知送信失敗:", error instanceof Error ? error.message : String(error));
  }
}

function encodeRFC5987(value: string): string {
  // HTTP ヘッダーに日本語を含む場合は ASCII のみ残し、それ以外は除く
  return value.replace(/[^\x20-\x7E]/g, "?");
}

export function getNtfySubscribeUrl(): string | null {
  if (!NTFY_TOPIC) return null;
  return `${NTFY_BASE}/${NTFY_TOPIC}`;
}

export function isNtfyConfigured(): boolean {
  return Boolean(NTFY_TOPIC);
}
