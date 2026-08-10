const DEFAULT_NTFY_BASE = "https://ntfy.sh";

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

type NtfyConfig = {
  configured: boolean;
  publishUrl: string | null;
  subscribeUrl: string | null;
  token: string | null;
};

function readEnv(name: string) {
  return process.env[name]?.trim().replace(/^(['"])(.*)\1$/, "$2") ?? "";
}

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function getNtfyConfig(): NtfyConfig {
  const directUrl = readEnv("NTFY_TOPIC_URL") || readEnv("NEXT_TRADE_NTFY_URL");
  const topic = readEnv("NTFY_TOPIC") || readEnv("NEXT_TRADE_NTFY_TOPIC");
  const base = cleanBaseUrl(readEnv("NTFY_BASE_URL") || readEnv("NTFY_URL") || DEFAULT_NTFY_BASE);
  const token = readEnv("NTFY_TOKEN") || readEnv("NTFY_ACCESS_TOKEN") || readEnv("NEXT_TRADE_NTFY_TOKEN") || null;

  if (directUrl) {
    return { configured: true, publishUrl: directUrl, subscribeUrl: directUrl, token };
  }
  if (!topic) {
    return { configured: false, publishUrl: null, subscribeUrl: null, token };
  }
  if (/^https?:\/\//i.test(topic)) {
    return { configured: true, publishUrl: topic, subscribeUrl: topic, token };
  }
  const path = encodeURIComponent(topic);
  return {
    configured: true,
    publishUrl: `${base}/${path}`,
    subscribeUrl: `${base}/${path}`,
    token,
  };
}

function money(value?: number) {
  if (value == null || !Number.isFinite(value)) return "-";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function pct(value?: number) {
  if (value == null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function eventLabel(event: NotifyEvent) {
  switch (event) {
    case "buy": return "BUY";
    case "sell": return "SELL";
    case "stop_loss": return "STOP LOSS";
    case "take_profit": return "TAKE PROFIT";
    case "limit_buy": return "LIMIT BUY";
    case "limit_sell": return "LIMIT SELL";
    case "force_close": return "FORCE CLOSED";
  }
}

function notificationBody(event: NotifyEvent, payload: NotifyPayload) {
  const lines = [
    `Event: ${eventLabel(event)}`,
    `Mode: ${payload.executionMode ?? "LIVE"}`,
    `Symbol: ${payload.symbol}`,
  ];
  if (payload.amountUsd != null) lines.push(`Amount: ${money(payload.amountUsd)}`);
  if (payload.priceUsd != null) lines.push(`Price: ${money(payload.priceUsd)}`);
  if (payload.pnlUsd != null || payload.pnlPct != null) {
    lines.push(`PnL: ${money(payload.pnlUsd)} (${pct(payload.pnlPct)})`);
  }
  return lines.join("\n");
}

function priorityFor(event: NotifyEvent, payload: NotifyPayload) {
  if (event === "stop_loss") return "urgent";
  if (event === "take_profit" || event === "limit_buy" || event === "limit_sell") return "high";
  if ((payload.executionMode ?? "LIVE") === "LIVE") return "high";
  return "default";
}

function tagsFor(event: NotifyEvent, payload: NotifyPayload) {
  if (event === "buy" || event === "limit_buy") return "chart_with_upwards_trend";
  if (event === "stop_loss") return "rotating_light";
  if (event === "take_profit") return "tada";
  if (event === "force_close") return "warning";
  return (payload.pnlUsd ?? 0) >= 0 ? "moneybag" : "chart_with_downwards_trend";
}

export async function sendTradeNotification(
  event: NotifyEvent,
  payload: NotifyPayload,
): Promise<{ sent: boolean; reason: string | null; url: string | null }> {
  const config = getNtfyConfig();
  if (!config.configured || !config.publishUrl) {
    return { sent: false, reason: "NTFY_NOT_CONFIGURED", url: null };
  }

  const headers: Record<string, string> = {
    Title: `NEXT-TRADE ${payload.executionMode ?? "LIVE"} ${eventLabel(event)}`,
    Priority: priorityFor(event, payload),
    Tags: tagsFor(event, payload),
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;

  try {
    const response = await fetch(config.publishUrl, {
      method: "POST",
      headers,
      body: notificationBody(event, payload),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const reason = `ntfy HTTP ${response.status}: ${body.slice(0, 300)}`;
      console.warn("[NEXT-TRADE][push-notify]", reason);
      return { sent: false, reason, url: config.subscribeUrl };
    }
    console.info("[NEXT-TRADE][push-notify.sent]", { event, symbol: payload.symbol, mode: payload.executionMode ?? "LIVE" });
    return { sent: true, reason: null, url: config.subscribeUrl };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("[NEXT-TRADE][push-notify.failed]", reason);
    return { sent: false, reason, url: config.subscribeUrl };
  }
}

export function getNtfySubscribeUrl(): string | null {
  return getNtfyConfig().subscribeUrl;
}

export function isNtfyConfigured(): boolean {
  return getNtfyConfig().configured;
}
