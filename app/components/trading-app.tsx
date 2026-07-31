"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  Activity,
  ChevronDown,
  CircleDollarSign,
  Gauge,
  Menu,
  Radar,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { defaultSettings } from "../lib/default-settings";
import { COPY_SOURCE_WALLET_LIMIT } from "../lib/limits";
import { calculatePaperPnl, evaluateCopySignal } from "../lib/paper-trading";
import type {
  ChainNetwork,
  EvmNativePrice,
  LivePaperPosition,
  FavoriteToken,
  FavoriteWalletScanResponse,
  LiveWalletEvent,
  LiveWalletResponse,
  SkippedPaperTrade,
  TrackedWallet,
  WalletScanResponse,
  WalletScanState,
  WalletScore,
} from "../lib/live-types";
import type { CopySettings, LimitOrder, LiveTradingStatus, TradeModeFilter } from "../lib/types";

type View = "dashboard" | "sources" | "scanner" | "favorites" | "activity" | "settings";
type ActivityByWallet = Record<string, LiveWalletResponse>;

const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const INITIAL_PAPER_BALANCE = 10000;
const STORAGE = {
  wallets: "swt-v2-wallets",
  positions: "swt-v2-positions",
  skipped: "swt-v2-skipped",
  settings: "swt-v2-settings",
  processed: "swt-v2-processed",
  favorites: "swt-v2-favorites",
  performanceMode: "next-trade-performance-mode",
  historyMode: "next-trade-history-mode",
  valueDisplay: "next-trade-value-display",
};

type ApiErrorResponse = { error?: string; details?: string; stack?: string };

async function requestJson<T>(url: string, timeoutMs = 60_000, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new Error(`リクエストが${Math.round(timeoutMs / 1000)}秒でタイムアウトしました`)), timeoutMs);
  try {
    const response = await fetch(url, { ...init, cache: "no-store", credentials: "include", signal: controller.signal });
    const raw = await response.text();
    let payload: (T & ApiErrorResponse) | null = null;
    try {
      payload = raw ? JSON.parse(raw) as T & ApiErrorResponse : null;
    } catch (parseError) {
      throw new Error(
        `APIレスポンスをJSONとして解析できません\nendpoint=${url}\nstatus=${response.status}\nbody=${raw.slice(0, 1000)}`,
        { cause: parseError },
      );
    }
    if (!response.ok) {
      const detail = [payload?.error, payload?.details, payload?.stack]
        .filter(Boolean)
        .join("\n");
      throw new Error(detail || `APIエラー: HTTP ${response.status} (${url})`);
    }
    if (!payload) throw new Error(`APIレスポンスが空です: ${url}`);
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`処理がタイムアウトしました\nendpoint=${url}\ntimeoutMs=${timeoutMs}`, { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

const nav: Array<{ id: View; label: string; icon: typeof Gauge }> = [
  { id: "dashboard", label: "ダッシュボード", icon: Gauge },
  { id: "sources", label: "コピー元ウォレット", icon: WalletCards },
  { id: "scanner", label: "優秀ウォレットスキャン", icon: Radar },
  { id: "favorites", label: "お気に入りコイン", icon: CircleDollarSign },
  { id: "activity", label: "実取引・ペーパー履歴", icon: Activity },
  { id: "settings", label: "コピー設定", icon: SettingsIcon },
];

const money = (value: number, signed = false) =>
  `${signed && value >= 0 ? "+" : value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const shortAddress = (address: string) => `${address.slice(0, 5)}…${address.slice(-5)}`;
const compactMoney = (value?: number) => {
  if (value == null || !Number.isFinite(value) || value <= 0) return "取得不可";
  return `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
};
const tokenPrice = (value?: number) =>
  value == null || !Number.isFinite(value) || value <= 0
    ? "取得不可"
    : `$${value.toLocaleString("en-US", { maximumSignificantDigits: 8 })}`;

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 max-w-full rounded-2xl border border-white/[0.07] bg-[#101619] ${className}`}>{children}</section>;
}

function SectionHeader({
  title,
  note,
  action,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {note && <p className="mt-1 text-xs leading-5 text-[#7f9097]">{note}</p>}
      </div>
      {action}
    </div>
  );
}

function Badge({
  children,
  tone = "green",
}: {
  children: React.ReactNode;
  tone?: "green" | "red" | "amber" | "gray";
}) {
  const tones = {
    green: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    red: "border-rose-400/20 bg-rose-400/10 text-rose-300",
    amber: "border-amber-400/20 bg-amber-400/10 text-amber-300",
    gray: "border-white/10 bg-white/5 text-[#9ba9ae]",
  };
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

function Metric({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-[#7f9097]">{label}</p>
      <p className={`mt-3 text-2xl font-semibold tabular-nums ${accent ? "text-[#38e7ae]" : "text-white"}`}>{value}</p>
      {detail && <p className="mt-2 text-[11px] text-[#66767c]">{detail}</p>}
    </Card>
  );
}

function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-35 ${checked ? "border-[#38e7ae] bg-[#167456]" : "border-[#39474c] bg-[#20292d]"}`}
    >
      <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition ${checked ? "left-[21px]" : "left-0.5"}`} />
    </button>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
        <Activity size={18} className="text-[#5d6e75]" />
      </div>
      <p className="text-sm font-medium text-[#c4ced1]">{title}</p>
      <p className="mt-2 max-w-md text-xs leading-6 text-[#66767c]">{detail}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  suffix,
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (value: string | number) => void;
  type?: "text" | "number";
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs text-[#8a999f]">{label}</span>
      <div className="flex items-center rounded-xl border border-white/10 bg-[#090d0f] focus-within:border-[#38e7ae]">
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={event => onChange(type === "number" ? Number(event.target.value) : event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base text-white outline-none placeholder:text-[#455158]"
        />
        {suffix && <span className="pr-3 text-xs text-[#65747a]">{suffix}</span>}
      </div>
    </label>
  );
}

function ScorePanel({ score }: { score: WalletScore }) {
  return (
    <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 xl:grid-cols-6">
      <div><span className="text-[#718188]">スコア</span><p className="mt-1 text-lg font-semibold text-white">{score.score}<span className="text-xs text-[#718188]"> / 100</span></p></div>
      <div><span className="text-[#718188]">1日平均取引</span><p className="mt-1 text-lg font-semibold text-[#38e7ae]">{(score.avgTradesPerDay ?? 0).toFixed(2)}回</p><span className="text-[10px] text-[#617076]">稼働 {score.activeTradingDays ?? 0}日</span></div>
      <div><span className="text-[#718188]">30日ROI</span><p className={`mt-1 text-lg font-semibold ${score.roi30d >= 0 ? "text-[#38e7ae]" : "text-rose-300"}`}>{pct(score.roi30d)}</p></div>
      <div><span className="text-[#718188]">確定利益</span><p className="mt-1 text-lg font-semibold text-white">{money(score.realizedProfitUsd, true)}</p></div>
      <div><span className="text-[#718188]">含み益</span><p className={`mt-1 text-lg font-semibold ${(score.unrealizedProfitUsd ?? 0) >= 0 ? "text-[#38e7ae]" : "text-rose-300"}`}>{score.unrealizedProfitUsd === null ? "対象外" : money(score.unrealizedProfitUsd ?? 0, true)}</p></div>
      <div><span className="text-[#718188]">勝率</span><p className="mt-1 text-lg font-semibold text-white">{score.winRate.toFixed(1)}%</p></div>
    </div>
  );
}

function Dashboard({
  wallets,
  positions,
  activities,
  skipped,
  lastRefresh,
  liveMode,
  liveStatus,
  limitOrders,
  onClose,
  onCreateLimitOrder,
  onCancelLimitOrder,
}: {
  wallets: TrackedWallet[];
  positions: LivePaperPosition[];
  activities: ActivityByWallet;
  skipped: SkippedPaperTrade[];
  lastRefresh: string | null;
  liveMode: boolean;
  liveStatus: LiveTradingStatus | null;
  limitOrders: LimitOrder[];
  onClose: (position: LivePaperPosition, reason: string, exitPrice?: number, sellPercent?: number, force?: boolean) => void;
  onCreateLimitOrder: (body: { tokenMint: string; tokenSymbol: string; side: "BUY" | "SELL"; targetPriceUsd: number; amountUsd?: number; sellPercent?: number; positionId?: string }) => Promise<void>;
  onCancelLimitOrder: (id: string) => Promise<void>;
}) {
  const [performanceMode, setPerformanceMode] = useState<"LIVE" | "PAPER">("LIVE");
  const [valueDisplay, setValueDisplay] = useState<"PRICE" | "MC">("PRICE");
  // 指値パネル: positionId → { limitTargetPrice, limitSellPct, sellPct, submitting }
  const [expandedPos, setExpandedPos] = useState<string | null>(null);
  const [limitTargetPrice, setLimitTargetPrice] = useState("");
  const [limitSellPct, setLimitSellPct] = useState("100");
  const [immediatePercent, setImmediatePercent] = useState("100");
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelMsg, setPanelMsg] = useState<string | null>(null);
  useEffect(() => {
    const savedMode = localStorage.getItem(STORAGE.performanceMode);
    const savedDisplay = localStorage.getItem(STORAGE.valueDisplay);
    if (savedMode === "LIVE" || savedMode === "PAPER") setPerformanceMode(savedMode);
    if (savedDisplay === "PRICE" || savedDisplay === "MC") setValueDisplay(savedDisplay);
  }, []);
  const openPanel = (posId: string) => {
    setExpandedPos(current => current === posId ? null : posId);
    setLimitTargetPrice("");
    setLimitSellPct("100");
    setImmediatePercent("100");
    setPanelMsg(null);
  };
  const selectPerformanceMode = (mode: "LIVE" | "PAPER") => {
    setPerformanceMode(mode);
    localStorage.setItem(STORAGE.performanceMode, mode);
  };
  const selectValueDisplay = (mode: "PRICE" | "MC") => {
    setValueDisplay(mode);
    localStorage.setItem(STORAGE.valueDisplay, mode);
  };
  const scoped = positions.filter(position => (position.executionMode ?? "PAPER") === performanceMode);
  const open = scoped.filter(position => position.status === "OPEN");
  const closed = scoped.filter(position => position.status === "CLOSED" && position.exitPriceUsd);
  const realized = closed.reduce((sum, position) =>
    sum + (position.realizedPnlUsd ?? calculatePaperPnl(position.copyPriceUsd, position.exitPriceUsd ?? position.copyPriceUsd, position.amountUsd).pnlUsd), 0);
  const unrealized = open.reduce((sum, position) =>
    sum + calculatePaperPnl(position.copyPriceUsd, position.currentPriceUsd, position.amountUsd).pnlUsd, 0);
  const wins = closed.filter(position =>
    (position.realizedPnlUsd ?? calculatePaperPnl(position.copyPriceUsd, position.exitPriceUsd ?? position.copyPriceUsd, position.amountUsd).pnlUsd) > 0,
  ).length;
  const closedPnls = closed.map(position =>
    position.realizedPnlUsd ?? calculatePaperPnl(position.copyPriceUsd, position.exitPriceUsd ?? position.copyPriceUsd, position.amountUsd).pnlUsd);
  const winPnls = closedPnls.filter(value => value > 0);
  const lossPnls = closedPnls.filter(value => value < 0);
  const todayTokyo = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
  const todayPnl = closed
    .filter(position => position.closedAt && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(position.closedAt)) === todayTokyo)
    .reduce((sum, position) => sum + (position.realizedPnlUsd ?? calculatePaperPnl(position.copyPriceUsd, position.exitPriceUsd ?? position.copyPriceUsd, position.amountUsd).pnlUsd), 0);
  const recentEvents = Object.values(activities)
    .flatMap(activity => activity.events.map(event => ({ ...event, wallet: activity.address })))
    .sort((a, b) => b.blockTime - a.blockTime)
    .slice(0, 6);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">リアルデータ運用状況</h1>
          <p className="mt-1 text-sm text-[#7f9097]">{liveMode ? "市場・ウォレット・注文すべて実データで運用中です。" : "市場・ウォレットは実データ、運用資金だけが仮想です。"}</p>
        </div>
        <Badge tone={lastRefresh ? "green" : "gray"}>{lastRefresh ? `最終更新 ${new Date(lastRefresh).toLocaleTimeString("ja-JP")}` : "未取得"}</Badge>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-xl border border-white/10 bg-[#0a0f11] p-1">
          {(["LIVE", "PAPER"] as const).map(mode => (
            <button key={mode} type="button" onClick={() => selectPerformanceMode(mode)} className={`rounded-lg px-4 py-2 text-xs font-semibold ${performanceMode === mode ? mode === "LIVE" ? "bg-rose-500/20 text-rose-200" : "bg-[#38e7ae]/15 text-[#38e7ae]" : "text-[#718188]"}`}>{mode}</button>
          ))}
        </div>
        <div className="flex rounded-xl border border-white/10 bg-[#0a0f11] p-1">
          <button type="button" onClick={() => selectValueDisplay("PRICE")} className={`rounded-lg px-3 py-2 text-xs ${valueDisplay === "PRICE" ? "bg-white/10 text-white" : "text-[#718188]"}`}>価格</button>
          <button type="button" onClick={() => selectValueDisplay("MC")} className={`rounded-lg px-3 py-2 text-xs ${valueDisplay === "MC" ? "bg-white/10 text-white" : "text-[#718188]"}`}>MC</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="コピー元ウォレット" value={`${wallets.length} / ${COPY_SOURCE_WALLET_LIMIT}`} detail={`コピーON ${wallets.filter(wallet => wallet.enabled).length}件`} />
        <Metric label={performanceMode === "LIVE" ? "取引ウォレット残高" : "ペーパートレード残高"} value={performanceMode === "LIVE" ? (liveStatus?.usdcBalance == null ? "—" : `${liveStatus.usdcBalance.toFixed(2)} USDC`) : money(INITIAL_PAPER_BALANCE + realized + unrealized)} detail={performanceMode === "LIVE" ? "専用ウォレットの実残高" : "開始残高 $10,000（仮想資金）"} accent />
        <Metric label={`${performanceMode} 確定損益`} value={money(realized, true)} detail={`${closed.length}件決済`} accent={realized >= 0} />
        <Metric label={`${performanceMode} 勝率`} value={closed.length ? `${(wins / closed.length * 100).toFixed(1)}%` : "—"} detail={`勝ち${wins}・負け${closed.length - wins}`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label={`${performanceMode} 本日の損益`} value={money(todayPnl, true)} detail="日本時間0:00から" accent={todayPnl >= 0} />
        <Metric label="平均利益 / 平均損失" value={`${money(winPnls.length ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length : 0, true)} / ${money(lossPnls.length ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length : 0, true)}`} detail="決済済みのみ" />
        <Metric label="最大利益" value={money(winPnls.length ? Math.max(...winPnls) : 0, true)} detail={performanceMode} accent />
        <Metric label="最大損失" value={money(lossPnls.length ? Math.min(...lossPnls) : 0, true)} detail={performanceMode} />
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.25fr]">
        <Card>
          <SectionHeader title="現在保有中" note={`${open.length}ポジション・含み損益 ${money(unrealized, true)}`} />
          {open.length ? (
            <div className="divide-y divide-white/[0.07]">
              {open.map(position => {
                const pnl = calculatePaperPnl(position.copyPriceUsd, position.currentPriceUsd, position.amountUsd);
                const isExpanded = expandedPos === position.id;
                const posLimitOrders = limitOrders.filter(o => o.side === "SELL" && o.status === "PENDING" && (o.positionId === position.id || o.tokenMint === position.mint));
                return (
                  <div key={position.id} className="border-b border-white/[0.07] last:border-b-0">
                    <div className="flex items-center gap-3 px-5 py-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#172227] text-xs font-bold text-[#38e7ae]">{position.symbol[0]}</div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{position.symbol}</p>
                        <p className="truncate font-mono text-[10px] text-[#66767c]">{shortAddress(position.wallet)}・{position.executionMode === "LIVE" ? "LIVE" : "PAPER"}</p>
                        <p className="mt-1 text-[10px] text-[#718188]">{valueDisplay === "PRICE" ? `購入 ${tokenPrice(position.copyPriceUsd)} / 現在 ${tokenPrice(position.currentPriceUsd)}` : `購入時MC ${compactMoney(position.entryMarketCapUsd)} / 現在MC ${compactMoney(position.currentMarketCapUsd)}`}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end">
                        <div className={`text-right tabular-nums ${pnl.pnlUsd >= 0 ? "text-[#38e7ae]" : "text-rose-300"}`}>
                          <p className="text-sm font-semibold">{money(pnl.pnlUsd, true)}</p>
                          <p className="text-xs">{pct(pnl.pnlPct)}</p>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => openPanel(position.id)}
                            className={`min-h-9 rounded-lg border px-3 text-xs font-semibold transition ${isExpanded ? "border-[#38e7ae]/30 bg-[#38e7ae]/10 text-[#38e7ae]" : "border-white/10 bg-white/[0.04] text-[#a0b0b6] hover:border-[#38e7ae]/30 hover:text-[#38e7ae]"}`}
                          >
                            売却
                          </button>
                        </div>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-white/[0.07] bg-[#0a0f11] px-5 py-4">
                        {panelMsg && <p className="mb-3 text-xs text-amber-300">{panelMsg}</p>}
                        {/* 強制CLOSED（ゴーストポジション用） */}
                        <div className="mb-5 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3">
                          <p className="text-[11px] font-semibold text-amber-300">ゴーストポジション強制削除</p>
                          <p className="mt-1 text-[10px] text-amber-200/70">Jupiter スワップ不要で DB を強制 CLOSED にします。実際には売れていないポジション専用。</p>
                          <button
                            type="button"
                            disabled={panelBusy}
                            onClick={() => {
                              if (!window.confirm(`${position.symbol}を強制CLOSEDにします（実際の売却は行われません）。よろしいですか？`)) return;
                              setPanelBusy(true); setPanelMsg(null);
                              onClose(position, "強制CLOSED", undefined, undefined, true);
                              window.setTimeout(() => { setPanelBusy(false); setExpandedPos(null); }, 1500);
                            }}
                            className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.08] px-3 py-1.5 text-[10px] font-semibold text-amber-300 hover:bg-amber-400/[0.15] disabled:opacity-50"
                          >
                            {panelBusy ? "処理中…" : "強制CLOSED"}
                          </button>
                        </div>
                        {/* 今すぐ部分売り */}
                        <p className="mb-2 text-[11px] font-semibold text-[#a0b0b6]">今すぐ売る（現在価格）</p>
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="w-28">
                            <p className="mb-1 text-[10px] text-[#7f9097]">売却割合 %</p>
                            <input
                              type="number" min={1} max={100} step={1}
                              value={immediatePercent}
                              onChange={e => setImmediatePercent(e.target.value)}
                              className="w-full rounded-lg border border-white/10 bg-[#141b1e] px-3 py-2 text-xs text-white focus:border-[#38e7ae]/50 focus:outline-none"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={panelBusy}
                            onClick={() => {
                              const pct2 = Number(immediatePercent);
                              if (!pct2 || pct2 < 1 || pct2 > 100) { setPanelMsg("1〜100の整数で入力してください"); return; }
                              if (!window.confirm(`${position.symbol}を現在価格で${pct2 < 100 ? `${pct2}%` : "全額"}売却しますか？`)) return;
                              setPanelBusy(true); setPanelMsg(null);
                              onClose(position, "手動決済", position.currentPriceUsd, pct2);
                              window.setTimeout(() => { setPanelBusy(false); if (pct2 >= 100) setExpandedPos(null); }, 1000);
                            }}
                            className="min-h-9 rounded-lg border border-rose-400/25 bg-rose-400/[0.08] px-4 text-xs font-semibold text-rose-300 hover:bg-rose-400/[0.14] disabled:opacity-50"
                          >
                            {panelBusy ? "処理中…" : `今すぐ${Number(immediatePercent) < 100 ? `${immediatePercent}%` : "全額"}売る`}
                          </button>
                        </div>
                        {/* 指値売り注文 */}
                        <p className="mb-2 mt-5 text-[11px] font-semibold text-[#a0b0b6]">指値売り注文（価格到達で自動実行）</p>
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="w-36">
                            <p className="mb-1 text-[10px] text-[#7f9097]">目標価格 USDC</p>
                            <input
                              type="number" min={0} step="any"
                              value={limitTargetPrice}
                              onChange={e => setLimitTargetPrice(e.target.value)}
                              placeholder={tokenPrice(position.currentPriceUsd).replace("$", "")}
                              className="w-full rounded-lg border border-white/10 bg-[#141b1e] px-3 py-2 text-xs text-white focus:border-[#38e7ae]/50 focus:outline-none"
                            />
                          </div>
                          <div className="w-28">
                            <p className="mb-1 text-[10px] text-[#7f9097]">売却割合 %</p>
                            <input
                              type="number" min={1} max={100} step={1}
                              value={limitSellPct}
                              onChange={e => setLimitSellPct(e.target.value)}
                              className="w-full rounded-lg border border-white/10 bg-[#141b1e] px-3 py-2 text-xs text-white focus:border-[#38e7ae]/50 focus:outline-none"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={panelBusy}
                            onClick={async () => {
                              const price = Number(limitTargetPrice);
                              const pct2 = Number(limitSellPct);
                              if (!price || price <= 0) { setPanelMsg("目標価格を入力してください"); return; }
                              if (!pct2 || pct2 < 1 || pct2 > 100) { setPanelMsg("売却割合は1〜100で入力してください"); return; }
                              setPanelBusy(true); setPanelMsg(null);
                              try {
                                await onCreateLimitOrder({ tokenMint: position.mint, tokenSymbol: position.symbol, side: "SELL", targetPriceUsd: price, sellPercent: pct2, positionId: position.id });
                                setPanelMsg(`指値売り設定: ${tokenPrice(price)} で ${pct2}% 売却`);
                                setLimitTargetPrice(""); setLimitSellPct("100");
                              } catch (e) { setPanelMsg(e instanceof Error ? e.message : "指値注文の設定に失敗しました"); }
                              finally { setPanelBusy(false); }
                            }}
                            className="min-h-9 rounded-lg border border-[#38e7ae]/25 bg-[#38e7ae]/[0.08] px-4 text-xs font-semibold text-[#38e7ae] hover:bg-[#38e7ae]/[0.14] disabled:opacity-50"
                          >
                            指値設定
                          </button>
                        </div>
                        {posLimitOrders.length > 0 && (
                          <div className="mt-4">
                            <p className="mb-2 text-[10px] text-[#7f9097]">未執行の指値売り注文</p>
                            <div className="flex flex-col gap-2">
                              {posLimitOrders.map(order => (
                                <div key={order.id} className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-[#141b1e] px-3 py-2 text-[10px]">
                                  <span className="text-[#a0b0b6]">{tokenPrice(order.targetPriceUsd)} で {order.sellPercent ?? 100}% 売却</span>
                                  <button type="button" onClick={() => void onCancelLimitOrder(order.id)} className="ml-3 text-rose-400 hover:text-rose-300">取消</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="保有中の仮想ポジションはありません" detail="監視開始後にコピー元の新規購入を検知し、条件を通過するとここへ表示されます。" />}
        </Card>
        <Card>
          <SectionHeader title="直近の実ウォレット取引" note="登録したコピー元のオンチェーン売買" />
          {recentEvents.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className="text-[#66767c]"><tr>{["時刻", "売買", "コイン", "コピー元", valueDisplay === "PRICE" ? "取引価格" : "取引時MC", valueDisplay === "PRICE" ? "現在価格" : "現在MC"].map(item => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr></thead>
                <tbody>{recentEvents.map(event => (
                  <tr key={`${event.signature}-${event.mint}`} className="border-t border-white/[0.07]">
                    <td className="px-4 py-3">{event.blockTime ? new Date(event.blockTime * 1000).toLocaleString("ja-JP") : "—"}</td>
                    <td className="px-4 py-3"><Badge tone={event.side === "BUY" ? "green" : "red"}>{event.side === "BUY" ? "購入" : "売却"}</Badge></td>
                    <td className="px-4 py-3 font-semibold">{event.current?.symbol ?? shortAddress(event.mint)}</td>
                    <td className="px-4 py-3 font-mono">{shortAddress(event.wallet)}</td>
                    <td className="px-4 py-3 tabular-nums">{valueDisplay === "PRICE" ? (event.sourcePriceUsd ? tokenPrice(event.sourcePriceUsd) : "算定不可") : "取得不可"}</td>
                    <td className="px-4 py-3 tabular-nums">{valueDisplay === "PRICE" ? tokenPrice(event.current?.priceUsd) : compactMoney(event.current?.marketCapUsd)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <EmptyState title="実取引データはまだありません" detail="コピー元を登録し、「全件を今すぐ更新」を実行すると実データが表示されます。" />}
        </Card>
      </div>
      {skipped.length > 0 && <p className="mt-3 text-right text-xs text-[#718188]">見送り記録 {skipped.length}件</p>}
    </>
  );
}

function Sources({
  wallets,
  activities,
  busy,
  onAdd,
  onDelete,
  onToggle,
  onStopAll,
  onRefresh,
  onRefreshAll,
}: {
  wallets: TrackedWallet[];
  activities: ActivityByWallet;
  busy: string | null;
  onAdd: (address: string, label: string) => string | null;
  onDelete: (wallet: TrackedWallet) => void;
  onToggle: (wallet: TrackedWallet, enabled: boolean) => void;
  onStopAll: () => void;
  onRefresh: (wallet: TrackedWallet, analyze?: boolean) => Promise<void>;
  onRefreshAll: () => Promise<void>;
}) {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const enabledCount = wallets.filter(wallet => wallet.enabled).length;
  const submit = () => {
    const error = onAdd(address.trim(), label.trim());
    setMessage(error ?? "コピー元を登録しました");
    if (!error) {
      setAddress("");
      setLabel("");
    }
  };
  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">コピー元ウォレット</h1>
          <p className="mt-1 text-sm text-[#7f9097]">自分の接続ウォレットとは別に、コピーする実在アドレスを管理します。</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`監視中のコピー元${enabledCount}件をすべて停止しますか？`)) onStopAll();
            }}
            disabled={enabledCount === 0}
            className="min-h-11 flex-1 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-4 text-sm font-semibold text-rose-300 transition hover:bg-rose-400/[0.13] disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
          >
            全コピー停止
          </button>
          <button onClick={() => void onRefreshAll()} disabled={Boolean(busy) || wallets.length === 0} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 text-sm text-[#d4dcde] transition hover:border-[#38e7ae] disabled:opacity-40 sm:flex-none">
            <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> 全件を今すぐ更新
          </button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
        <Card className="h-fit p-5">
          <div className="mb-5 flex items-center justify-between">
            <div><p className="text-sm font-semibold">コピー元を登録</p><p className="mt-1 text-xs text-[#718188]">登録経路共通の上限</p></div>
            <Badge tone={wallets.length >= COPY_SOURCE_WALLET_LIMIT ? "amber" : "green"}>{wallets.length} / {COPY_SOURCE_WALLET_LIMIT}</Badge>
          </div>
          <div className="space-y-4">
            <Field label="表示名（任意）" value={label} onChange={value => setLabel(String(value))} placeholder="例：確認済みウォレット" />
            <Field label="Solanaウォレットアドレス" value={address} onChange={value => setAddress(String(value))} placeholder="32〜44文字の公開アドレス" />
            <button onClick={submit} disabled={wallets.length >= COPY_SOURCE_WALLET_LIMIT} className="w-full rounded-xl bg-[#38e7ae] px-4 py-3 text-sm font-semibold text-[#06110d] disabled:cursor-not-allowed disabled:opacity-40">コピー元に登録</button>
            {message && <p className={`text-xs leading-5 ${message.includes("登録しました") ? "text-emerald-300" : "text-amber-300"}`}>{message}</p>}
          </div>
          <div className="mt-5 rounded-xl border border-amber-400/15 bg-amber-400/[0.06] p-3 text-xs leading-5 text-amber-200/80">
            公開アドレスだけを登録します。秘密鍵やシードフレーズは入力・保存しません。
          </div>
        </Card>
        <Card>
          <SectionHeader title="監視対象" note={`コピー元ウォレット ${wallets.length}/${COPY_SOURCE_WALLET_LIMIT}・登録経路に関係なくコピーONを監視`} />
          {wallets.length ? (
            <div className="divide-y divide-white/[0.07]">
              {wallets.map(wallet => {
                const activity = activities[wallet.address];
                return (
                  <div key={`${wallet.network ?? "SOLANA"}:${wallet.address}`} className="p-5">
                    <div className="flex flex-wrap items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{wallet.label || shortAddress(wallet.address)}</h3>
                          <Badge tone={wallet.origin === "AUTO" ? "green" : "gray"}>{wallet.origin === "AUTO" ? "採用候補" : wallet.origin === "FAVORITE" ? "お気に入り経由" : "手動"}</Badge>
                          <Badge tone="gray">{wallet.network ?? "SOLANA"}</Badge>
                          {wallet.score && <Badge tone={wallet.score.qualified ? "green" : "amber"}>{wallet.score.score}点</Badge>}
                        </div>
                        <p className="mt-2 break-all font-mono text-[11px] text-[#718188]">{wallet.address}</p>
                        <p className="mt-2 text-[11px] text-[#59686e]">{activity ? `実取引 ${activity.events.length}件・${new Date(activity.fetchedAt).toLocaleString("ja-JP")}` : "実データ未取得"}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Toggle checked={wallet.enabled} onChange={value => onToggle(wallet, value)} disabled={(wallet.network ?? "SOLANA") !== "SOLANA"} label={`${wallet.label}の監視`} />
                        <button title={(wallet.network ?? "SOLANA") === "SOLANA" ? "更新と30日評価" : "EVMペーパー監視は準備中"} onClick={() => void onRefresh(wallet, true)} disabled={busy === wallet.address || (wallet.network ?? "SOLANA") !== "SOLANA"} className="rounded-lg border border-white/10 p-2 text-[#89989e] hover:border-[#38e7ae] hover:text-[#38e7ae] disabled:opacity-40"><RefreshCw size={15} className={busy === wallet.address ? "animate-spin" : ""} /></button>
                        <button title="削除" onClick={() => onDelete(wallet)} className="rounded-lg border border-white/10 p-2 text-[#89989e] hover:border-rose-400/50 hover:text-rose-300"><Trash2 size={15} /></button>
                      </div>
                    </div>
                    {wallet.score && <div className="mt-5 border-t border-white/[0.06] pt-4"><ScorePanel score={wallet.score} /></div>}
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="コピー元が登録されていません" detail="左のフォームから実在アドレスを登録するか、優秀ウォレットスキャンを実行してください。" />}
        </Card>
      </div>
    </>
  );
}

type WalletSort = "score" | "realized" | "unrealized";

function Scanner({
  network,
  onNetworkChange,
  result,
  scanState,
  scanning,
  wallets,
  autoCount,
  onScan,
  onAddCandidate,
}: {
  network: ChainNetwork;
  onNetworkChange: (network: ChainNetwork) => void;
  result: WalletScanResponse | null;
  scanState: WalletScanState | null;
  scanning: boolean;
  wallets: TrackedWallet[];
  autoCount: number;
  onScan: () => Promise<void>;
  onAddCandidate: (wallet: WalletScore, rank: number) => void;
}) {
  const [sortBy, setSortBy] = useState<WalletSort>("score");
  const [ethereumPrice, setEthereumPrice] = useState<EvmNativePrice | null>(null);
  const [ethereumPriceError, setEthereumPriceError] = useState<string | null>(null);
  useEffect(() => {
    if (network !== "ETHEREUM") {
      setEthereumPrice(null);
      setEthereumPriceError(null);
      return;
    }
    let cancelled = false;
    const refreshPrice = async () => {
      try {
        const price = await requestJson<EvmNativePrice>("/api/live/evm-price", 30_000);
        if (!cancelled) {
          setEthereumPrice(price);
          setEthereumPriceError(null);
        }
      } catch (error) {
        if (!cancelled) setEthereumPriceError(error instanceof Error ? error.message : "ETH価格を取得できません");
      }
    };
    void refreshPrice();
    const timer = window.setInterval(() => void refreshPrice(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [network]);
  const sortedWallets = useMemo(() => {
    const pool = result?.rankingPool ?? result?.evaluated ?? [];
    return [...pool].sort((a, b) => {
      if (sortBy === "realized") {
        return b.realizedProfitUsd - a.realizedProfitUsd || b.score - a.score;
      }
      if (sortBy === "unrealized") {
        return (b.unrealizedProfitUsd ?? 0) - (a.unrealizedProfitUsd ?? 0) || b.score - a.score;
      }
      return b.avgTradesPerDay - a.avgTradesPerDay
        || b.score - a.score
        || b.winRate - a.winRate
        || b.realizedProfitUsd - a.realizedProfitUsd;
    }).slice(0, 10);
  }, [result, sortBy]);
  const addableTopFive = sortedWallets.slice(0, 5).filter(wallet => wallet.addable !== false && (wallet.blockers ?? []).length === 0).length;

  return (
    <>
      <div className="mb-5 grid grid-cols-3 gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-1.5">
        {([
          ["SOLANA", "Solana"],
          ["ETHEREUM", "Ethereum"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onNetworkChange(value)}
            className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition ${
              network === value ? "bg-[#38e7ae] text-[#06110d]" : "text-[#819097] hover:bg-white/[0.05] hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">優秀ウォレットスキャン</h1>
          <p className="mt-1 text-sm text-[#7f9097]">
            {network === "SOLANA"
              ? "複数DEXの実取引から候補を広く抽出し、30日確定損益で査定します。"
              : "Moralisの実取引・30日確定損益とRPCのEOA判定から査定します。"}
          </p>
        </div>
        <button onClick={() => void onScan()} disabled={scanning} className="flex items-center gap-2 rounded-xl bg-[#38e7ae] px-5 py-3 text-sm font-semibold text-[#06110d] disabled:opacity-50">
          <Radar size={16} className={scanning ? "animate-spin" : ""} /> {scanning ? "実データを分析中…" : "今すぐスキャン"}
        </button>
      </div>
      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {network === "ETHEREUM" && (
          <Metric
            label="ETH現在価格"
            value={ethereumPrice ? money(ethereumPrice.priceUsd) : "—"}
            detail={ethereumPrice
              ? `24時間 ${ethereumPrice.priceChange24h === null ? "変動率未取得" : pct(ethereumPrice.priceChange24h)}・1分更新`
              : ethereumPriceError ?? "Moralisから取得中"}
            accent={Boolean(ethereumPrice)}
          />
        )}
        <Metric label="コピー元ウォレット" value={`${wallets.length} / ${COPY_SOURCE_WALLET_LIMIT}`} detail="候補追加時はコピーOFF" />
        <Metric label="重複除外後の発見数" value={String(scanState?.discoveredCandidates || result?.discoveredCandidates || "—")} detail="複数DEX横断" />
        <Metric label="今回の解析数" value={scanState?.targetCandidates ? `${scanState.analyzedCandidates} / ${scanState.targetCandidates}` : result ? String(result.scannedCandidates) : "—"} detail={scanState ? `解析成功 ${scanState.successfulAnalyses}件` : result ? `解析成功 ${result.successfulAnalyses}件` : "架空データでの補充なし"} />
        <Metric label="追加可能な上位候補" value={result ? String(addableTopFive) : "—"} detail="選択中ソートの上位5件" accent={addableTopFive > 0} />
      </div>
      {scanState && (
        <div className={`mb-3 rounded-xl border p-4 ${scanState.status === "FAILED" ? "border-rose-400/20 bg-rose-400/[0.06]" : "border-[#38e7ae]/20 bg-[#38e7ae]/[0.05]"}`}>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-[#cbd4d7]">{scanState.message}</span>
            <div className="flex flex-wrap justify-end gap-2">
              <Badge tone="green">定期自動更新</Badge>
              <Badge tone={scanState.databaseEnabled ? "green" : "amber"}>{scanState.databaseEnabled ? "DB保存有効" : "メモリ保存"}</Badge>
            </div>
          </div>
          {scanning && (
            <>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="h-full rounded-full bg-[#38e7ae] transition-[width] duration-500"
                  style={{ width: `${scanState.targetCandidates ? Math.max(2, scanState.analyzedCandidates / scanState.targetCandidates * 100) : 2}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-[#718188]">画面を閉じてもサーバー側で解析を続行します。</p>
            </>
          )}
          {scanState.error && <p className="mt-2 break-all text-xs text-rose-300">{scanState.error}</p>}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-[#718188]">並び替え</span>
        {([
          ["score", "総合（取引頻度優先）"],
          ["realized", "確定利益"],
          ["unrealized", "含み益"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSortBy(value)}
            className={`min-h-10 rounded-lg border px-4 text-xs font-semibold transition ${
              sortBy === value
                ? "border-[#38e7ae]/40 bg-[#38e7ae]/10 text-[#38e7ae]"
                : "border-white/10 bg-white/[0.03] text-[#8d9ba0] hover:border-white/20"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="w-full text-[10px] text-[#59696f] sm:ml-auto sm:w-auto">含み益は現在価格を取得できた未売却残高のみ・総合スコアには不使用</span>
      </div>
      <Card>
        <SectionHeader
          title="実データ査定結果・上位10件"
          note={result?.scope ?? "スキャンを実行すると、上位10件と注意事項・追加不可理由を表示します。"}
          action={result && <Badge tone="gray">{new Date(result.fetchedAt).toLocaleString("ja-JP")}</Badge>}
        />
        {scanning && (
          <div className="flex min-h-64 flex-col items-center justify-center">
            <RefreshCw className="animate-spin text-[#38e7ae]" />
            <p className="mt-4 text-sm text-[#a2afb4]">{scanState?.message ?? "複数DEXから候補を収集中"}</p>
            <p className="mt-2 text-xs text-[#617076]">保存済みランキングがある場合は下に表示したまま更新します。</p>
          </div>
        )}
        {sortedWallets.length ? (
          <div className="divide-y divide-white/[0.07]">
            {sortedWallets.map((wallet, index) => {
              const blockers = wallet.blockers ?? [];
              const warnings = wallet.warnings ?? (blockers.length ? [] : wallet.reasons ?? []);
              const alreadyAdded = wallets.some(item => (item.network ?? "SOLANA") === network && item.address.toLowerCase() === wallet.address.toLowerCase());
              const topFive = index < 5;
              const canAdd = topFive && wallet.addable !== false && blockers.length === 0 && !alreadyAdded && wallets.length < COPY_SOURCE_WALLET_LIMIT;
              return (
              <div key={wallet.address} className="p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#59696f]">#{index + 1}</span>
                      <p className="font-mono text-xs text-[#cbd4d7]">{wallet.address}</p>
                    </div>
                    <p className="mt-2 text-[11px] text-[#617076]">30日売買 {wallet.swaps30d}件・売却 {wallet.sellEvents ?? 0}件・決済 {wallet.closedTrades}件・経過 {wallet.ageDays === null ? "未取得" : `${wallet.ageDays}日`}・価格算定 {wallet.valuedEvents}件</p>
                    <p className="mt-1 text-[11px] text-[#526269]">検出元: {(wallet.sources ?? []).join("・") || "オンチェーン履歴"}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Badge tone={blockers.length ? "red" : warnings.length ? "amber" : "green"}>
                      {blockers.length ? "重大問題・追加不可" : warnings.length ? "注意事項あり" : "良好"}
                    </Badge>
                    {!topFive && <Badge tone="gray">査定のみ</Badge>}
                    {topFive && alreadyAdded && <Badge tone="green">候補追加済み</Badge>}
                    {topFive && (
                      <button
                        type="button"
                        disabled={!canAdd}
                        onClick={() => onAddCandidate(wallet, index + 1)}
                        className="rounded-lg border border-[#38e7ae]/30 bg-[#38e7ae]/10 px-3 py-2 text-xs font-semibold text-[#38e7ae] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-[#68777c]"
                      >
                        {alreadyAdded ? "追加済み" : wallets.length >= COPY_SOURCE_WALLET_LIMIT ? "コピー元上限" : blockers.length ? "追加不可" : "採用候補に追加"}
                      </button>
                    )}
                  </div>
                </div>
                <ScorePanel score={wallet} />
                {warnings.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-[11px] text-amber-300">注意事項（ユーザー判断で追加可能）</p>
                    <div className="flex flex-wrap gap-2">{warnings.map(reason => <Badge key={reason} tone="amber">{reason}</Badge>)}</div>
                  </div>
                )}
                {blockers.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-[11px] text-rose-300">重大な問題</p>
                    <div className="flex flex-wrap gap-2">{blockers.map(reason => <Badge key={reason} tone="red">{reason}</Badge>)}</div>
                  </div>
                )}
              </div>
            )})}
          </div>
        ) : !scanning && <EmptyState title="まだスキャン結果がありません" detail="実行すると実データの上位10件を査定します。候補追加後もコピーはOFFのままです。" />}
      </Card>
      <div className="mt-3 rounded-xl border border-amber-400/15 bg-amber-400/[0.05] p-4 text-xs leading-6 text-amber-100/70">
        <p className="mb-2 text-amber-200">30日ROI 60%以上は必須条件ではなく高評価基準です。ROIがプラスかつ確定利益がプラスなら、60%未満でも注意付きで採用候補に追加できます。</p>
        {network === "SOLANA"
          ? "Solana全履歴の完全走査ではありません。Jupiter・Raydium・Orca・Meteora・Pump.fun・PumpSwapの直近取引から重複を除外して候補を抽出し、設定された解析上限まで30日履歴を評価します。"
          : "Ethereum全履歴の完全走査ではありません。設定された実トークンの上位トレーダーを重複除外し、確定損益を評価します。Ethereumのコピー監視はまだ開始せず、採用候補はコピーOFFで保存します。"}
      </div>
    </>
  );
}

function FavoritesView({
  favorites,
  activities,
  limitOrders,
  onAdd,
  onDelete,
  onAddManual,
  onCreateLimitOrder,
  onCancelLimitOrder,
}: {
  favorites: FavoriteToken[];
  activities: ActivityByWallet;
  limitOrders: LimitOrder[];
  onAdd: (mint: string) => Promise<string | null>;
  onDelete: (mint: string) => void;
  onAddManual: (address: string, label: string, origin?: TrackedWallet["origin"]) => string | null;
  onCreateLimitOrder: (body: { tokenMint: string; tokenSymbol: string; side: "BUY" | "SELL"; targetPriceUsd: number; amountUsd?: number; sellPercent?: number; positionId?: string }) => Promise<void>;
  onCancelLimitOrder: (id: string) => Promise<void>;
}) {
  const [mint, setMint] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openedMint, setOpenedMint] = useState<string | null>(null);
  const [walletResults, setWalletResults] = useState<Record<string, FavoriteWalletScanResponse>>({});
  const [loadingMint, setLoadingMint] = useState<string | null>(null);
  const [copiedMint, setCopiedMint] = useState<string | null>(null);
  // 指値買いパネル
  const [buyPanelMint, setBuyPanelMint] = useState<string | null>(null);
  const [buyTargetPrice, setBuyTargetPrice] = useState("");
  const [buyAmount, setBuyAmount] = useState("");
  const [buyPanelBusy, setBuyPanelBusy] = useState(false);
  const [buyPanelMsg, setBuyPanelMsg] = useState<string | null>(null);
  const openBuyPanel = (tokenMint: string) => {
    setBuyPanelMint(current => current === tokenMint ? null : tokenMint);
    setBuyTargetPrice(""); setBuyAmount(""); setBuyPanelMsg(null);
  };
  const submit = async () => {
    setAdding(true);
    setMessage(null);
    const result = await onAdd(mint.trim());
    setMessage(result ?? "実データから登録しました");
    if (!result) setMint("");
    setAdding(false);
  };
  const openToken = async (tokenMint: string) => {
    if (openedMint === tokenMint) {
      setOpenedMint(null);
      return;
    }
    setOpenedMint(tokenMint);
    if (walletResults[tokenMint]) return;
    setLoadingMint(tokenMint);
    setMessage(null);
    try {
      const payload = await requestJson<FavoriteWalletScanResponse>(`/api/live/token-wallets?mint=${encodeURIComponent(tokenMint)}`, 120_000);
      setWalletResults(current => ({ ...current, [tokenMint]: payload }));
    } catch (scanError) {
      setMessage(scanError instanceof Error ? scanError.message : "ウォレット分析に失敗しました");
    } finally {
      setLoadingMint(null);
    }
  };
  const copyCa = async (tokenMint: string) => {
    try {
      await navigator.clipboard.writeText(tokenMint);
      setCopiedMint(tokenMint);
      window.setTimeout(() => setCopiedMint(current => current === tokenMint ? null : current), 1800);
    } catch {
      setMessage("CAをコピーできませんでした");
    }
  };
  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">お気に入りコイン</h1>
        <p className="mt-1 text-sm text-[#7f9097]">CAだけを入力すると、コイン情報を実データから自動取得します。</p>
      </div>
      <Card className="mb-3">
        <SectionHeader title="CAで登録" note="名称・シンボル・価格情報の手入力は不要です" />
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="コントラクトアドレス（CA）" value={mint} onChange={value => setMint(String(value))} placeholder="SolanaトークンのMint Address" />
          </div>
          <button onClick={() => void submit()} disabled={adding || !mint.trim()} className="h-[42px] rounded-xl bg-[#38e7ae] px-5 text-sm font-semibold text-[#06110d] disabled:opacity-40">
            {adding ? "実データ取得中…" : "お気に入りに登録"}
          </button>
        </div>
        {message && <p className={`whitespace-pre-wrap break-all px-5 pb-5 text-xs leading-relaxed ${message.includes("登録しました") ? "text-emerald-300" : "text-amber-300"}`}>{message}</p>}
      </Card>
      {favorites.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {favorites.map(token => {
            const related = Object.values(activities).filter(activity => activity.events.some(event => event.mint === token.mint));
            return (
              <Card key={token.mint}>
                <button type="button" onClick={() => void openToken(token.mint)} className="flex w-full items-start gap-4 p-5 text-left">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#172520] text-lg font-bold text-[#38e7ae]">{token.symbol.slice(0, 1)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{token.name}</h2><Badge>{token.symbol}</Badge></div>
                    <p className="mt-2 break-all font-mono text-[10px] text-[#65757b]">{token.mint}</p>
                    <p className="mt-2 text-[11px] text-[#65757b]">登録 {new Date(token.addedAt).toLocaleString("ja-JP")}・{token.dex}</p>
                  </div>
                  <Badge tone={openedMint === token.mint ? "green" : "gray"}>{openedMint === token.mint ? "閉じる" : "優秀ウォレットを見る"}</Badge>
                </button>
                <div className="flex flex-wrap gap-2 border-t border-white/[0.07] px-5 py-3">
                  <button onClick={() => void copyCa(token.mint)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-[#b5c0c4] hover:border-[#38e7ae] hover:text-[#38e7ae]">{copiedMint === token.mint ? "コピーしました" : "CAをコピー"}</button>
                  <button
                    onClick={() => openBuyPanel(token.mint)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${buyPanelMint === token.mint ? "border-[#38e7ae]/30 bg-[#38e7ae]/10 text-[#38e7ae]" : "border-white/10 text-[#a0b0b6] hover:border-[#38e7ae]/30 hover:text-[#38e7ae]"}`}
                  >
                    指値買い
                    {limitOrders.filter(o => o.side === "BUY" && o.status === "PENDING" && o.tokenMint === token.mint).length > 0 && (
                      <span className="ml-1.5 rounded bg-[#38e7ae]/20 px-1 text-[9px] text-[#38e7ae]">
                        {limitOrders.filter(o => o.side === "BUY" && o.status === "PENDING" && o.tokenMint === token.mint).length}
                      </span>
                    )}
                  </button>
                  <button onClick={() => onDelete(token.mint)} className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-[#89989e] hover:border-rose-400/50 hover:text-rose-300"><Trash2 size={13} />削除</button>
                </div>
                {buyPanelMint === token.mint && (
                  <div className="border-t border-white/[0.07] bg-[#0a0f11] px-5 py-4">
                    <p className="mb-3 text-[11px] font-semibold text-[#a0b0b6]">指値買い注文（価格以下になったら自動購入）</p>
                    {buyPanelMsg && <p className="mb-3 text-xs text-amber-300">{buyPanelMsg}</p>}
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-36">
                        <p className="mb-1 text-[10px] text-[#7f9097]">目標価格 USDC（以下で購入）</p>
                        <input
                          type="number" min={0} step="any"
                          value={buyTargetPrice}
                          onChange={e => setBuyTargetPrice(e.target.value)}
                          placeholder={`$${token.priceUsd.toPrecision(4)}`}
                          className="w-full rounded-lg border border-white/10 bg-[#141b1e] px-3 py-2 text-xs text-white focus:border-[#38e7ae]/50 focus:outline-none"
                        />
                      </div>
                      <div className="w-28">
                        <p className="mb-1 text-[10px] text-[#7f9097]">購入金額 USDC</p>
                        <input
                          type="number" min={1} step="any"
                          value={buyAmount}
                          onChange={e => setBuyAmount(e.target.value)}
                          placeholder="10"
                          className="w-full rounded-lg border border-white/10 bg-[#141b1e] px-3 py-2 text-xs text-white focus:border-[#38e7ae]/50 focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={buyPanelBusy}
                        onClick={async () => {
                          const price = Number(buyTargetPrice);
                          const amt = Number(buyAmount);
                          if (!price || price <= 0) { setBuyPanelMsg("目標価格を入力してください"); return; }
                          if (!amt || amt <= 0) { setBuyPanelMsg("購入金額を入力してください"); return; }
                          setBuyPanelBusy(true); setBuyPanelMsg(null);
                          try {
                            await onCreateLimitOrder({ tokenMint: token.mint, tokenSymbol: token.symbol, side: "BUY", targetPriceUsd: price, amountUsd: amt });
                            setBuyPanelMsg(`指値買い設定: ${token.symbol} $${price} 以下で ${amt} USDC 購入`);
                            setBuyTargetPrice(""); setBuyAmount("");
                          } catch (e) { setBuyPanelMsg(e instanceof Error ? e.message : "指値注文の設定に失敗しました"); }
                          finally { setBuyPanelBusy(false); }
                        }}
                        className="min-h-9 rounded-lg border border-[#38e7ae]/25 bg-[#38e7ae]/[0.08] px-4 text-xs font-semibold text-[#38e7ae] hover:bg-[#38e7ae]/[0.14] disabled:opacity-50"
                      >
                        {buyPanelBusy ? "処理中…" : "指値買い設定"}
                      </button>
                    </div>
                    {limitOrders.filter(o => o.side === "BUY" && o.status === "PENDING" && o.tokenMint === token.mint).length > 0 && (
                      <div className="mt-4">
                        <p className="mb-2 text-[10px] text-[#7f9097]">未執行の指値買い注文</p>
                        <div className="flex flex-col gap-2">
                          {limitOrders.filter(o => o.side === "BUY" && o.status === "PENDING" && o.tokenMint === token.mint).map(order => (
                            <div key={order.id} className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-[#141b1e] px-3 py-2 text-[10px]">
                              <span className="text-[#a0b0b6]">${order.targetPriceUsd} 以下で {order.amountUsd} USDC 購入</span>
                              <button type="button" onClick={() => void onCancelLimitOrder(order.id)} className="ml-3 text-rose-400 hover:text-rose-300">取消</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-px border-t border-white/[0.07] bg-white/[0.07]">
                  <div className="bg-[#101619] p-4"><p className="text-[10px] text-[#68787e]">現在価格</p><p className="mt-1 text-sm font-semibold tabular-nums">${token.priceUsd.toPrecision(5)}</p></div>
                  <div className="bg-[#101619] p-4"><p className="text-[10px] text-[#68787e]">流動性</p><p className="mt-1 text-sm font-semibold tabular-nums">{money(token.liquidityUsd)}</p></div>
                  <div className="bg-[#101619] p-4"><p className="text-[10px] text-[#68787e]">時価総額</p><p className="mt-1 text-sm font-semibold tabular-nums">{money(token.marketCapUsd)}</p></div>
                </div>
                <div className="border-t border-white/[0.07] px-5 py-4">
                  <p className="text-xs text-[#7d8d93]">このコインの実取引が見つかった登録ウォレット</p>
                  {related.length ? <div className="mt-3 flex flex-wrap gap-2">{related.map(activity => <Badge key={activity.address} tone="gray">{shortAddress(activity.address)}</Badge>)}</div> : <p className="mt-2 text-xs text-[#59686e]">現在取得済みの履歴にはありません</p>}
                </div>
                {openedMint === token.mint && (
                  <div className="border-t border-white/[0.07] bg-[#0b1113]">
                    <div className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">このコインで利益を確定した上位ウォレット</p>
                        {walletResults[token.mint] && <Badge tone={walletResults[token.mint].tokenRisk.safe ? "green" : "red"}>{walletResults[token.mint].tokenRisk.safe ? "危険判定を通過" : "危険判定で除外"}</Badge>}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[#65757b]">開いた時点で実取引を分析します。対象コインの確定利益がプラスの上位5件です。</p>
                      {walletResults[token.mint] && !walletResults[token.mint].tokenRisk.safe && <p className="mt-2 text-xs leading-5 text-rose-300">{walletResults[token.mint].scope}</p>}
                    </div>
                    {loadingMint === token.mint ? (
                      <div className="flex items-center justify-center gap-3 px-5 py-10 text-xs text-[#819097]"><RefreshCw size={15} className="animate-spin text-[#38e7ae]" />実データを分析中…</div>
                    ) : walletResults[token.mint]?.matches.length ? (
                      <div className="divide-y divide-white/[0.07] border-t border-white/[0.07]">
                        {walletResults[token.mint].matches.map((wallet, index) => (
                          <div key={wallet.address} className="p-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="font-mono text-xs text-[#cbd4d7]">#{index + 1} {wallet.address}</p>
                                <p className="mt-2 text-[11px] text-[#65757b]">対象コイン確定利益 <span className="font-semibold text-[#38e7ae]">{money(wallet.tokenRealizedProfitUsd, true)}</span>・決済 {wallet.tokenClosedTrades}件・全体スコア {wallet.score}点</p>
                              </div>
                              <button
                                onClick={() => {
                                  const result = onAddManual(wallet.address, `${token.symbol} 上位 #${index + 1}`, "FAVORITE");
                                  setMessage(result ?? "手動コピー元へ登録しました");
                                }}
                                className="rounded-lg border border-[#38e7ae]/30 bg-[#38e7ae]/10 px-3 py-2 text-xs font-medium text-[#38e7ae] hover:bg-[#38e7ae]/20"
                              >
                                手動コピー元へ登録
                              </button>
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                              <div><span className="text-[#65757b]">30日ROI</span><p className="mt-1 font-semibold text-white">{pct(wallet.roi30d)}</p></div>
                              <div><span className="text-[#65757b]">全体確定利益</span><p className="mt-1 font-semibold text-white">{money(wallet.realizedProfitUsd, true)}</p></div>
                              <div><span className="text-[#65757b]">勝率</span><p className="mt-1 font-semibold text-white">{wallet.winRate.toFixed(1)}%</p></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : walletResults[token.mint] ? (
                      <EmptyState title="条件に合うウォレットは見つかりませんでした" detail="今回の実データ範囲では、対象コインで決済済みの確定利益がプラスのウォレットがありません。" />
                    ) : null}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : <Card><EmptyState title="お気に入りコインは未登録です" detail="CAを1つ入力してください。DEX Screenerで実在する取引ペアを確認できたコインだけ登録します。" /></Card>}
    </>
  );
}

function ActivityView({
  activities,
  positions,
  skipped,
  onClose,
}: {
  activities: ActivityByWallet;
  positions: LivePaperPosition[];
  skipped: SkippedPaperTrade[];
  onClose: (position: LivePaperPosition, reason: string) => void;
}) {
  const events = Object.values(activities)
    .flatMap(activity => activity.events.map(event => ({ ...event, wallet: activity.address })))
    .sort((a, b) => b.blockTime - a.blockTime);
  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">実取引・ペーパー履歴</h1>
        <p className="mt-1 text-sm text-[#7f9097]">コピー元の実取引と、仮想資金によるコピー結果を分けて表示します。</p>
      </div>
      <Card>
        <SectionHeader title="ペーパートレード" note="注文送信・実資金移動は一切ありません" />
        {positions.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="text-[#66767c]"><tr>{["状態", "コイン", "コピー元", "検知遅延", "コピー価格", "現在/決済価格", "仮想額", "損益", "理由"].map(item => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr></thead>
              <tbody>{[...positions].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)).map(position => {
                const price = position.status === "CLOSED" ? position.exitPriceUsd ?? position.currentPriceUsd : position.currentPriceUsd;
                const result = calculatePaperPnl(position.copyPriceUsd, price, position.amountUsd);
                return (
                  <tr key={position.id} className="border-t border-white/[0.07]">
                    <td className="px-4 py-3"><Badge tone={position.status === "OPEN" ? "green" : "gray"}>{position.status === "OPEN" ? "保有中" : "決済済み"}</Badge></td>
                    <td className="px-4 py-3 font-semibold">{position.symbol}</td>
                    <td className="px-4 py-3 font-mono">{shortAddress(position.wallet)}</td>
                    <td className="px-4 py-3 tabular-nums">{position.detectionDelaySeconds}秒</td>
                    <td className="px-4 py-3 tabular-nums">${position.copyPriceUsd.toPrecision(5)}</td>
                    <td className="px-4 py-3 tabular-nums">${price.toPrecision(5)}</td>
                    <td className="px-4 py-3 tabular-nums">{money(position.amountUsd)}</td>
                    <td className={`px-4 py-3 tabular-nums ${result.pnlUsd >= 0 ? "text-[#38e7ae]" : "text-rose-300"}`}>{money(result.pnlUsd, true)}<br />{pct(result.pnlPct)}</td>
                    <td className="px-4 py-3">{position.status === "OPEN" ? <button onClick={() => onClose(position, "手動決済")} className="text-rose-300 hover:underline">手動決済</button> : position.exitReason}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <EmptyState title="ペーパートレード履歴はありません" detail="監視開始後に新規購入を検知した場合だけ作成します。過去取引を遡ってコピーすることはありません。" />}
      </Card>
      <Card className="mt-3">
        <SectionHeader title="コピー元の実取引" note={`${events.length}件取得`} />
        {events.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="text-[#66767c]"><tr>{["日時", "売買", "コイン", "コピー元", "数量", "取引価格", "流動性"].map(item => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr></thead>
              <tbody>{events.map(event => (
                <tr key={`${event.signature}-${event.mint}`} className="border-t border-white/[0.07]">
                  <td className="px-4 py-3">{new Date(event.blockTime * 1000).toLocaleString("ja-JP")}</td>
                  <td className="px-4 py-3"><Badge tone={event.side === "BUY" ? "green" : "red"}>{event.side === "BUY" ? "購入" : "売却"}</Badge></td>
                  <td className="px-4 py-3 font-semibold">{event.current?.symbol ?? shortAddress(event.mint)}</td>
                  <td className="px-4 py-3 font-mono">{shortAddress(event.wallet)}</td>
                  <td className="px-4 py-3 tabular-nums">{event.tokenAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                  <td className="px-4 py-3 tabular-nums">{event.sourcePriceUsd ? `$${event.sourcePriceUsd.toPrecision(5)}` : "算定不可"}</td>
                  <td className="px-4 py-3 tabular-nums">{event.current ? money(event.current.liquidityUsd) : "取得不可"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="コピー元の実取引は未取得です" detail="コピー元画面からデータ更新を実行してください。" />}
      </Card>
      <Card className="mt-3">
        <SectionHeader title="見送り履歴" note="条件に合わずコピーしなかった実シグナルも保存" />
        {skipped.length ? (
          <div className="divide-y divide-white/[0.07]">{[...skipped].sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt)).map(item => (
            <div key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-4 text-xs">
              <Badge tone="amber">見送り</Badge><span className="font-semibold">{item.symbol}</span><span className="font-mono text-[#718188]">{shortAddress(item.wallet)}</span><span className="ml-auto text-[#a4b0b4]">{item.reason}</span>
            </div>
          ))}</div>
        ) : <EmptyState title="見送り履歴はありません" detail="監視開始後の新規購入が条件外だった場合に記録されます。" />}
      </Card>
    </>
  );
}

type HistoryPanel = "paper" | "source" | "skipped" | "recent";

function HistoryAccordion({
  title,
  count,
  note,
  open,
  onToggle,
  renderContent,
}: {
  title: string;
  count: number;
  note: string;
  open: boolean;
  onToggle: () => void;
  renderContent: () => React.ReactNode;
}) {
  return (
    <Card className="mt-3 overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-4 text-left sm:px-5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            <Badge tone="gray">{count}件</Badge>
          </div>
          <p className="mt-1 truncate text-[11px] text-[#718188]">{note}</p>
        </div>
        <ChevronDown size={18} className={`shrink-0 text-[#718188] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-white/[0.07]">{renderContent()}</div>}
    </Card>
  );
}

async function saveTrackedWallet(wallet: TrackedWallet, method: "POST" | "PATCH" = "POST") {
  return requestJson<TrackedWallet>("/api/live/tracked-wallets", 30_000, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(wallet),
  });
}

async function deleteTrackedWallet(wallet: TrackedWallet) {
  return requestJson<{ deleted: boolean }>("/api/live/tracked-wallets", 30_000, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(wallet),
  });
}

function MobileActivityView({
  activities,
  positions,
  skipped,
  onClose,
}: {
  activities: ActivityByWallet;
  positions: LivePaperPosition[];
  skipped: SkippedPaperTrade[];
  onClose: (position: LivePaperPosition, reason: string) => void;
}) {
  const [openPanels, setOpenPanels] = useState<Record<HistoryPanel, boolean>>({
    paper: false,
    source: false,
    skipped: false,
    recent: false,
  });
  const [historyMode, setHistoryMode] = useState<TradeModeFilter>("LIVE");
  const [valueDisplay, setValueDisplay] = useState<"PRICE" | "MC">("PRICE");
  useEffect(() => {
    const savedMode = localStorage.getItem(STORAGE.historyMode);
    const savedDisplay = localStorage.getItem(STORAGE.valueDisplay);
    if (savedMode === "ALL" || savedMode === "LIVE" || savedMode === "PAPER") setHistoryMode(savedMode);
    if (savedDisplay === "PRICE" || savedDisplay === "MC") setValueDisplay(savedDisplay);
  }, []);
  const selectHistoryMode = (mode: TradeModeFilter) => {
    setHistoryMode(mode);
    localStorage.setItem(STORAGE.historyMode, mode);
  };
  const selectValueDisplay = (mode: "PRICE" | "MC") => {
    setValueDisplay(mode);
    localStorage.setItem(STORAGE.valueDisplay, mode);
  };
  const filteredPositions = positions.filter(position =>
    historyMode === "ALL" || (position.executionMode ?? "PAPER") === historyMode);
  const filteredSkipped = skipped.filter(item =>
    historyMode === "ALL" || item.executionMode === historyMode);
  const sourceCount = Object.values(activities).reduce((sum, activity) => sum + activity.events.length, 0);
  const needsEvents = openPanels.source || openPanels.recent;
  const events = useMemo(() => needsEvents
    ? Object.values(activities)
      .flatMap(activity => activity.events.map(event => ({ ...event, wallet: activity.address })))
      .sort((a, b) => b.blockTime - a.blockTime)
    : [], [activities, needsEvents]);
  const toggle = (panel: HistoryPanel) =>
    setOpenPanels(current => ({ ...current, [panel]: !current[panel] }));

  const renderEvent = (event: LiveWalletEvent & { wallet: string }) => (
    <div key={`${event.signature}-${event.mint}`} className="flex items-center gap-3 px-4 py-3 text-xs sm:px-5">
      <Badge tone={event.side === "BUY" ? "green" : "red"}>{event.side === "BUY" ? "購入" : "売却"}</Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{event.current?.symbol ?? shortAddress(event.mint)}</p>
        <p className="mt-1 truncate font-mono text-[10px] text-[#718188]">{shortAddress(event.wallet)}・{new Date(event.blockTime * 1000).toLocaleString("ja-JP")}</p>
      </div>
      <p className="shrink-0 text-right tabular-nums text-[#b8c3c7]">{valueDisplay === "PRICE" ? (event.sourcePriceUsd ? tokenPrice(event.sourcePriceUsd) : "算定不可") : "取得不可"}</p>
    </div>
  );

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">実取引・ペーパー履歴</h1>
        <p className="mt-1 text-sm text-[#7f9097]">項目をタップした時だけ一覧を描画します。初期状態はすべて閉じています。</p>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-xl border border-white/10 bg-[#0a0f11] p-1">
          {(["ALL", "LIVE", "PAPER"] as const).map(mode => <button key={mode} type="button" onClick={() => selectHistoryMode(mode)} className={`rounded-lg px-3 py-2 text-xs ${historyMode === mode ? "bg-white/10 text-white" : "text-[#718188]"}`}>{mode === "ALL" ? "すべて" : mode}</button>)}
        </div>
        <div className="flex rounded-xl border border-white/10 bg-[#0a0f11] p-1">
          <button type="button" onClick={() => selectValueDisplay("PRICE")} className={`rounded-lg px-3 py-2 text-xs ${valueDisplay === "PRICE" ? "bg-white/10 text-white" : "text-[#718188]"}`}>価格</button>
          <button type="button" onClick={() => selectValueDisplay("MC")} className={`rounded-lg px-3 py-2 text-xs ${valueDisplay === "MC" ? "bg-white/10 text-white" : "text-[#718188]"}`}>MC</button>
        </div>
      </div>
      <HistoryAccordion
        title="コピー取引・決済履歴"
        count={filteredPositions.length}
        note={`${historyMode}モード・新しい順`}
        open={openPanels.paper}
        onToggle={() => toggle("paper")}
        renderContent={() => filteredPositions.length ? (
          <div className="divide-y divide-white/[0.07]">{[...filteredPositions].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)).map(position => {
            const price = position.status === "CLOSED" ? position.exitPriceUsd ?? position.currentPriceUsd : position.currentPriceUsd;
            const result = calculatePaperPnl(position.copyPriceUsd, price, position.amountUsd);
            return (
              <div key={position.id} className="px-4 py-4 text-xs sm:px-5">
                <div className="flex items-center gap-2"><Badge tone={position.status === "OPEN" ? "green" : "gray"}>{position.status === "OPEN" ? "保有中" : "決済済み"}</Badge><Badge tone={position.executionMode === "LIVE" ? "red" : "gray"}>{position.executionMode === "LIVE" ? "LIVE" : "PAPER"}</Badge><span className="font-semibold">{position.symbol}</span><span className="ml-auto font-mono text-[#718188]">{shortAddress(position.wallet)}</span></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[#87969b]"><span>仮想額 {money(position.amountUsd)}</span><span className={result.pnlUsd >= 0 ? "text-[#38e7ae]" : "text-rose-300"}>損益 {money(result.pnlUsd, true)} / {pct(result.pnlPct)}</span></div>
                <p className="mt-2 text-[#718188]">{valueDisplay === "PRICE" ? `購入 ${tokenPrice(position.copyPriceUsd)} / ${position.status === "CLOSED" ? "売却" : "現在"} ${tokenPrice(price)}` : `購入時MC ${compactMoney(position.entryMarketCapUsd)} / ${position.status === "CLOSED" ? "売却時MC" : "現在MC"} ${compactMoney(position.status === "CLOSED" ? position.exitMarketCapUsd : position.currentMarketCapUsd)}`}</p>
                <div className="mt-3 flex justify-end">{position.status === "OPEN" ? <button onClick={() => onClose(position, "手動決済")} className="text-rose-300">手動決済</button> : <span className="text-[#718188]">{position.exitReason}</span>}</div>
              </div>
            );
          })}</div>
        ) : <EmptyState title="ペーパートレード履歴はありません" detail="新規購入を検知して条件を通過した場合だけ作成します。" />}
      />
      <HistoryAccordion
        title="コピー元の実取引"
        count={sourceCount}
        note="登録したコピー元の全取得取引"
        open={openPanels.source}
        onToggle={() => toggle("source")}
        renderContent={() => events.length ? <div className="divide-y divide-white/[0.07]">{events.map(renderEvent)}</div> : <EmptyState title="コピー元の実取引は未取得です" detail="コピー元画面からデータ更新を実行してください。" />}
      />
      <HistoryAccordion
        title="見送り履歴"
        count={filteredSkipped.length}
        note="条件に合わずコピーしなかった実シグナル"
        open={openPanels.skipped}
        onToggle={() => toggle("skipped")}
        renderContent={() => filteredSkipped.length ? (
          <div className="divide-y divide-white/[0.07]">{[...filteredSkipped].sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt)).map(item => (
            <div key={item.id} className="px-4 py-4 text-xs sm:px-5">
              <div className="flex items-center gap-2"><Badge tone="amber">見送り</Badge><Badge tone={item.executionMode === "LIVE" ? "red" : "gray"}>{item.executionMode ?? "UNKNOWN"}</Badge><span className="font-semibold">{item.symbol}</span><span className="ml-auto font-mono text-[#718188]">{shortAddress(item.wallet)}</span></div>
              <p className="mt-2 text-[#a4b0b4]">{item.reason}</p>
            </div>
          ))}</div>
        ) : <EmptyState title="見送り履歴はありません" detail="新規購入が条件外だった場合に記録されます。" />}
      />
      <HistoryAccordion
        title="直近の実ウォレット取引"
        count={Math.min(sourceCount, 10)}
        note="新しい順に最大10件"
        open={openPanels.recent}
        onToggle={() => toggle("recent")}
        renderContent={() => events.length ? <div className="divide-y divide-white/[0.07]">{events.slice(0, 10).map(renderEvent)}</div> : <EmptyState title="直近取引は未取得です" detail="コピー元の実取引を更新してください。" />}
      />
    </>
  );
}

function SettingsView({
  settings,
  liveStatus,
  dailyLoss,
  ntfyConfig,
  onChange,
}: {
  settings: CopySettings;
  liveStatus: LiveTradingStatus | null;
  dailyLoss: { lossUsd: number; nextResetAt: string | null };
  ntfyConfig: { configured: boolean; subscribeUrl: string | null } | null;
  onChange: (settings: CopySettings) => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const update = <K extends keyof CopySettings>(key: K, value: CopySettings[K]) => onChange({ ...settings, [key]: value });
  const numberFields: Array<[keyof CopySettings, string, string]> = [
    ["amountPerTrade", "1取引の購入額", "USDC"],
    ["maxPositions", "最大同時保有数", "件"],
    ["maxDailyAmount", "1日の最大購入額", "USDC"],
    ["maxSlippage", "最大スリッページ", "%"],
    ["maxDetectionSeconds", "コピー可能な検知遅延", "秒"],
  ];
  const conditionalFields: Array<{
    enabledKey: "stopLossEnabled" | "takeProfitEnabled" | "maxPriceRiseEnabled";
    valueKey: "stopLoss" | "takeProfit" | "maxPriceRise";
    label: string;
    detail: string;
  }> = [
    { enabledKey: "stopLossEnabled", valueKey: "stopLoss", label: "損切り率", detail: "OFFの場合は自動損切りしません" },
    { enabledKey: "takeProfitEnabled", valueKey: "takeProfit", label: "利確率", detail: "OFFの場合は自動利確しません" },
    { enabledKey: "maxPriceRiseEnabled", valueKey: "maxPriceRise", label: "見送る価格上昇率", detail: "OFFの場合は購入後の上昇率で見送りません" },
  ];
  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">コピー設定</h1>
        <p className="mt-1 text-sm text-[#7f9097]">設定はDBへ保存されます。実売買は専用ウォレットとJupiterを使用します。</p>
      </div>
      <Card className="mb-5 max-w-4xl border-amber-400/20">
        <SectionHeader
          title="実売買モード"
          note="専用ウォレットのUSDCで購入し、売却時はUSDCへ戻します。メインウォレットは使用しないでください。"
          action={<Badge tone={settings.liveTradingEnabled ? "red" : "gray"}>{settings.liveTradingEnabled ? "LIVE" : "PAPER"}</Badge>}
        />
        <div className="space-y-4 p-5">
          <div className="grid gap-3 text-xs sm:grid-cols-3">
            <div className="rounded-xl bg-[#0a0f11] p-3"><p className="text-[#718188]">取引ウォレット</p><p className="mt-1 break-all font-mono">{liveStatus?.address ?? "未設定"}</p></div>
            <div className="rounded-xl bg-[#0a0f11] p-3"><p className="text-[#718188]">USDC残高</p><p className="mt-1 text-base font-semibold">{liveStatus?.usdcBalance == null ? "—" : `${liveStatus.usdcBalance.toFixed(2)} USDC`}</p></div>
            <div className="rounded-xl bg-[#0a0f11] p-3"><p className="text-[#718188]">手数料用SOL</p><p className="mt-1 text-base font-semibold">{liveStatus?.solBalance == null ? "—" : `${liveStatus.solBalance.toFixed(4)} SOL`}</p></div>
          </div>
          {liveStatus?.error && <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200">{liveStatus.error}</p>}
          {!settings.liveTradingEnabled ? (
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-4">
              <p className="text-sm font-semibold text-rose-200">実資金を使う設定です</p>
              <p className="mt-1 text-xs leading-5 text-[#9ba9ae]">開始するには「LIVE」と入力してください。Replit側の環境設定が未完了の場合は開始できません。</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                  placeholder="LIVE"
                  className="min-h-11 flex-1 rounded-lg border border-white/10 bg-[#080c0e] px-3 text-base outline-none focus:border-rose-300/50"
                />
                <button
                  type="button"
                  disabled={!liveStatus?.ready || confirmation !== "LIVE"}
                  onClick={() => { update("liveTradingEnabled", true); setConfirmation(""); }}
                  className="min-h-11 rounded-lg bg-rose-500 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  実売買を開始
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => update("liveTradingEnabled", false)}
              className="w-full rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm font-semibold text-rose-200"
            >
              新規の実売買を緊急停止
            </button>
          )}
        </div>
      </Card>
      <Card className="max-w-4xl">
        <SectionHeader title="実行設定" note={settings.liveTradingEnabled ? "以下の上限を実注文に適用します。" : "ペーパートレードに適用します。"} />
        <div className="p-5">
          <div className="mb-6 flex items-center justify-between rounded-xl border border-white/10 bg-[#0a0f11] p-4">
            <div><p className="text-sm font-semibold">コピー監視</p><p className="mt-1 text-xs text-[#718188]">15秒ごとに有効なコピー元を確認</p></div>
            <Toggle checked={settings.enabled} onChange={value => update("enabled", value)} label="コピー監視" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {numberFields.map(([key, label, suffix]) => (
              <Field key={key} type="number" label={label} value={settings[key] as number} suffix={suffix} onChange={value => update(key, Number(value) as never)} />
            ))}
          </div>
          <div className="mt-6 space-y-3">
            {conditionalFields.map(field => (
              <div key={field.enabledKey} className="rounded-xl border border-white/10 bg-[#0a0f11] p-4">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div><p className="text-sm font-semibold">{field.label}</p><p className="mt-1 text-xs text-[#718188]">{field.detail}</p></div>
                  <Toggle checked={settings[field.enabledKey]} onChange={value => update(field.enabledKey, value)} label={field.label} />
                </div>
                <Field type="number" label={`${field.label}の値`} value={settings[field.valueKey]} suffix="%" onChange={value => update(field.valueKey, Number(value))} />
              </div>
            ))}
            <div className="rounded-xl border border-rose-400/20 bg-[#0a0f11] p-4">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">1日の最大損失額</p>
                  <p className="mt-1 text-xs text-[#718188]">LIVEの確定損失だけを日本時間0:00から合計し、上限後は新規BUYのみ停止します。</p>
                </div>
                <Toggle checked={settings.dailyLossLimitEnabled} onChange={value => update("dailyLossLimitEnabled", value)} label="1日の最大損失額" />
              </div>
              <Field type="number" label="損失上限" value={settings.dailyLossLimit} suffix="USDC" onChange={value => update("dailyLossLimit", Number(value))} />
              <div className="mt-3 rounded-lg bg-rose-400/[0.06] p-3 text-xs">
                <p className="text-[#9ba9ae]">本日のLIVE確定損失</p>
                <p className="mt-1 font-semibold text-rose-200">{(dailyLoss?.lossUsd ?? 0).toFixed(2)} / {(settings.dailyLossLimit ?? 0).toFixed(2)} USDC</p>
                {settings.dailyLossLimitEnabled && (dailyLoss?.lossUsd ?? 0) >= (settings.dailyLossLimit ?? 0) && (
                  <p className="mt-2 leading-5 text-rose-200">本日の損失上限に到達しました。新規コピー購入を停止しています。次回リセット：翌日 0:00（日本時間）</p>
                )}
              </div>
            </div>
          </div>
          <div className="mt-6 flex items-center justify-between rounded-xl border border-white/10 bg-[#0a0f11] p-4">
            <div><p className="text-sm font-semibold">同じコインへの重複購入</p><p className="mt-1 text-xs text-[#718188]">OFFなら既存ポジション保有中は見送ります</p></div>
            <Toggle checked={settings.allowDuplicate} onChange={value => update("allowDuplicate", value)} label="重複購入" />
          </div>
        </div>
      </Card>
      <Card className="mt-5 max-w-4xl">
        <SectionHeader title="📱 スマホ通知（ntfy）" note="購入・決済・指値発動をプッシュ通知します" />
        <div className="p-5">
          {ntfyConfig === null ? (
            <p className="text-xs text-[#718188]">設定を読み込み中…</p>
          ) : ntfyConfig.configured ? (
            <>
              <div className="mb-4 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#38e7ae]" />
                <span className="text-sm font-semibold text-[#38e7ae]">通知設定済み</span>
              </div>
              <p className="mb-2 text-xs text-[#a0b0b6]">ntfy アプリで以下の URL を購読してください：</p>
              <div className="flex items-center gap-2 rounded-xl border border-[#38e7ae]/20 bg-[#0a0f11] px-4 py-3">
                <span className="flex-1 break-all font-mono text-xs text-[#38e7ae]">{ntfyConfig.subscribeUrl}</span>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(ntfyConfig.subscribeUrl ?? "")}
                  className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-[10px] text-[#a0b0b6] hover:text-white"
                >
                  コピー
                </button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 text-xs">
                <div className="rounded-xl bg-[#0a0f11] p-3">
                  <p className="font-semibold text-[#a0b0b6]">📱 iOS</p>
                  <p className="mt-1 text-[#718188]">App Store で「ntfy」を検索→インストール→上記URLを購読</p>
                </div>
                <div className="rounded-xl bg-[#0a0f11] p-3">
                  <p className="font-semibold text-[#a0b0b6]">🤖 Android</p>
                  <p className="mt-1 text-[#718188]">Google Play で「ntfy」を検索→インストール→上記URLを購読</p>
                </div>
              </div>
              <div className="mt-3 text-xs text-[#718188]">
                通知が届かない場合：<code className="rounded bg-white/[0.05] px-1">NTFY_TOPIC</code> シークレットが正しく設定されているか確認してください。
              </div>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-[#a0b0b6]">通知を有効にするには <code className="rounded bg-white/[0.05] px-1">NTFY_TOPIC</code> シークレットを設定してください。</p>
              <div className="space-y-2 text-xs text-[#718188]">
                <p>1. App Store / Google Play で「<strong className="text-[#a0b0b6]">ntfy</strong>」アプリをインストール</p>
                <p>2. Replit の Secrets に <code className="rounded bg-white/[0.05] px-1">NTFY_TOPIC</code> を追加（例: <code className="rounded bg-white/[0.05] px-1">next-trade-abc123</code>）</p>
                <p>3. ntfy アプリで <code className="rounded bg-white/[0.05] px-1">https://ntfy.sh/next-trade-abc123</code> を購読</p>
                <p>4. 再デプロイすると通知が届くようになります</p>
              </div>
            </>
          )}
        </div>
      </Card>
    </>
  );
}

export function TradingApp() {
  const [view, setView] = useState<View>("dashboard");
  const [scanNetwork, setScanNetwork] = useState<ChainNetwork>("SOLANA");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [activities, setActivities] = useState<ActivityByWallet>({});
  const [favorites, setFavorites] = useState<FavoriteToken[]>([]);
  const [positions, setPositions] = useState<LivePaperPosition[]>([]);
  const [skipped, setSkipped] = useState<SkippedPaperTrade[]>([]);
  const [settings, setSettings] = useState<CopySettings>(defaultSettings);
  const [liveStatus, setLiveStatus] = useState<LiveTradingStatus | null>(null);
  const [dailyLoss, setDailyLoss] = useState<{ lossUsd: number; nextResetAt: string | null }>({ lossUsd: 0, nextResetAt: null });
  const [scanResults, setScanResults] = useState<Partial<Record<ChainNetwork, WalletScanResponse>>>({});
  const [scanStates, setScanStates] = useState<Partial<Record<ChainNetwork, WalletScanState>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const processedRef = useRef(new Set<string>());
  const walletsRef = useRef(wallets);
  const settingsRef = useRef(settings);
  const positionsRef = useRef(positions);

  useEffect(() => { walletsRef.current = wallets; }, [wallets]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { positionsRef.current = positions; }, [positions]);

  const scanState = scanStates[scanNetwork] ?? null;
  const scanResult = scanResults[scanNetwork] ?? null;
  const scanUrl = scanNetwork === "SOLANA" ? "/api/live/scan" : `/api/live/evm-scan?network=${scanNetwork}`;

  const syncScanState = useCallback(async () => {
    const network = scanNetwork;
    const url = network === "SOLANA" ? "/api/live/scan" : `/api/live/evm-scan?network=${network}`;
    const state = await requestJson<WalletScanState>(url, 30_000);
    setScanStates(current => ({ ...current, [network]: state }));
    if (state.result) setScanResults(current => ({ ...current, [network]: state.result! }));
  }, [scanNetwork]);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        if (!cancelled) await syncScanState();
      } catch (scanError) {
        if (!cancelled) setError(scanError instanceof Error ? scanError.message : "スキャン状態の取得に失敗しました");
      }
    };
    void sync();
    return () => { cancelled = true; };
  }, [syncScanState]);

  useEffect(() => {
    if (!scanState) return;
    const intervalMs = scanState.status === "RUNNING" ? 2_500 : 60_000;
    const timer = window.setInterval(() => {
      void syncScanState().catch(scanError => {
        setError(scanError instanceof Error ? scanError.message : "スキャン状態の更新に失敗しました");
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [scanNetwork, scanState?.status, syncScanState]);

  useEffect(() => {
    const load = <T,>(key: string, fallback: T): T => {
      try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) as T : fallback;
      } catch {
        return fallback;
      }
    };
    const cachedWallets = load<TrackedWallet[]>(STORAGE.wallets, []);
    const cachedPositions = load<LivePaperPosition[]>(STORAGE.positions, []);
    const cachedSkipped = load<SkippedPaperTrade[]>(STORAGE.skipped, []);
    const cachedSettings = { ...defaultSettings, ...load<Partial<CopySettings>>(STORAGE.settings, {}) };
    setWallets(cachedWallets);
    setPositions(cachedPositions);
    setSkipped(cachedSkipped);
    setFavorites(load(STORAGE.favorites, []));
    setSettings(cachedSettings);
    processedRef.current = new Set(load<string[]>(STORAGE.processed, []));
    setHydrated(true);
    void (async () => {
      try {
        let storedWallets = await requestJson<TrackedWallet[]>("/api/live/tracked-wallets", 30_000);
        if (storedWallets.length === 0 && cachedWallets.length > 0) {
          storedWallets = [];
          for (const wallet of cachedWallets) storedWallets.push(await saveTrackedWallet(wallet));
        }
        setWallets(storedWallets);
        const [savedSettings, tradingStatus] = await Promise.all([
          requestJson<CopySettings>("/api/live/copy-settings", 30_000),
          requestJson<LiveTradingStatus>("/api/live/live-trading", 30_000),
        ]);
        setSettings(savedSettings);
        setLiveStatus(tradingStatus);
        setSettingsLoaded(true);
        const serverTrades = await requestJson<{ positions: LivePaperPosition[]; skipped: SkippedPaperTrade[]; dailyLoss: { lossUsd: number; nextResetAt: string | null } }>("/api/live/copy-monitor", 30_000, { method: "PUT" });
        // The database is authoritative after login. Keeping local data when the
        // server returns an empty array resurrects positions that were already sold.
        setPositions(serverTrades.positions);
        setSkipped(serverTrades.skipped);
        setDailyLoss(serverTrades.dailyLoss ?? { lossUsd: 0, nextResetAt: null });
      } catch (syncError) {
        setError(syncError instanceof Error ? syncError.message : "DB保存データの同期に失敗しました");
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated || !settingsLoaded) return;
    const refresh = () => void requestJson<LiveTradingStatus>("/api/live/live-trading", 30_000)
      .then(setLiveStatus)
      .catch(() => undefined);
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [hydrated, settingsLoaded]);

  useEffect(() => { if (hydrated) localStorage.setItem(STORAGE.wallets, JSON.stringify(wallets)); }, [wallets, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(STORAGE.positions, JSON.stringify(positions)); }, [positions, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(STORAGE.skipped, JSON.stringify(skipped)); }, [skipped, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(STORAGE.settings, JSON.stringify(settings)); }, [settings, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(STORAGE.favorites, JSON.stringify(favorites)); }, [favorites, hydrated]);

  useEffect(() => {
    if (!hydrated || !settingsLoaded) return;
    const timer = window.setTimeout(() => {
      void requestJson<CopySettings>("/api/live/copy-settings", 30_000, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      }).catch(syncError => {
        setError(syncError instanceof Error ? syncError.message : "コピー設定のDB保存に失敗しました");
        void requestJson<CopySettings>("/api/live/copy-settings", 30_000).then(setSettings).catch(() => undefined);
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [hydrated, settings, settingsLoaded]);

  const syncServerMonitor = useCallback(async () => {
    await requestJson("/api/live/copy-monitor", 30_000);
    const payload = await requestJson<{ positions: LivePaperPosition[]; skipped: SkippedPaperTrade[]; dailyLoss: { lossUsd: number; nextResetAt: string | null } }>("/api/live/copy-monitor", 30_000, { method: "PUT" });
    setPositions(payload.positions);
    setSkipped(payload.skipped);
    setDailyLoss(payload.dailyLoss ?? { lossUsd: 0, nextResetAt: null });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void syncServerMonitor().catch(syncError => setError(syncError instanceof Error ? syncError.message : "コピー監視状態の取得に失敗しました"));
    const timer = window.setInterval(() => {
      void syncServerMonitor().catch(syncError => setError(syncError instanceof Error ? syncError.message : "コピー監視状態の更新に失敗しました"));
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [hydrated, syncServerMonitor]);

  const [ntfyConfig, setNtfyConfig] = useState<{ configured: boolean; subscribeUrl: string | null } | null>(null);
  useEffect(() => {
    if (hydrated && settingsLoaded) {
      void requestJson<{ configured: boolean; subscribeUrl: string | null }>("/api/live/notifications")
        .then(setNtfyConfig).catch(() => undefined);
    }
  }, [hydrated, settingsLoaded]);

  const [limitOrders, setLimitOrders] = useState<LimitOrder[]>([]);
  const refreshLimitOrders = useCallback(() => {
    void requestJson<LimitOrder[]>("/api/live/limit-orders").then(setLimitOrders).catch(() => undefined);
  }, []);
  useEffect(() => { if (hydrated && settingsLoaded) refreshLimitOrders(); }, [hydrated, settingsLoaded, refreshLimitOrders]);
  const createLimitOrder = useCallback(async (body: {
    tokenMint: string; tokenSymbol: string; side: "BUY" | "SELL";
    targetPriceUsd: number; amountUsd?: number; sellPercent?: number; positionId?: string;
  }) => {
    await requestJson("/api/live/limit-orders", 30_000, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    refreshLimitOrders();
  }, [refreshLimitOrders]);
  const cancelLimitOrder = useCallback(async (id: string) => {
    await requestJson(`/api/live/limit-orders?id=${encodeURIComponent(id)}`, 30_000, { method: "DELETE" });
    refreshLimitOrders();
  }, [refreshLimitOrders]);

  const closePosition = useCallback((position: LivePaperPosition, reason: string, exitPrice = position.currentPriceUsd, sellPercent?: number, force?: boolean) => {
    void requestJson("/api/live/copy-monitor", 90_000, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: position.id,
        exitPriceUsd: exitPrice,
        reason,
        ...(sellPercent != null && sellPercent < 100 ? { sellPercent } : {}),
        ...(force ? { force: true } : {}),
      }),
    }).then(() => syncServerMonitor())
      .catch(closeError => setError(closeError instanceof Error ? closeError.message : "手動決済に失敗しました"));
  }, [syncServerMonitor]);

  const processNewEvent = useCallback(async (wallet: TrackedWallet, event: LiveWalletEvent) => {
    if (settingsRef.current.liveTradingEnabled) return;
    const key = `${event.signature}:${event.mint}:${event.side}`;
    if (processedRef.current.has(key)) return;
    processedRef.current.add(key);
    localStorage.setItem(STORAGE.processed, JSON.stringify([...processedRef.current].slice(-2000)));

    if (event.side === "SELL") {
      positionsRef.current
        .filter(position => position.status === "OPEN" && position.wallet === wallet.address && position.mint === event.mint)
        .forEach(position => closePosition(position, "コピー元が売却", event.current?.priceUsd ?? event.sourcePriceUsd ?? position.currentPriceUsd));
      return;
    }
    if (!event.current) {
      setSkipped(current => [{
        id: crypto.randomUUID(), signature: event.signature, wallet: wallet.address, mint: event.mint,
        symbol: shortAddress(event.mint), detectedAt: new Date().toISOString(), reason: "現在価格を取得できない",
      }, ...current.filter(item => item.signature !== event.signature)]);
      return;
    }
    const delay = Math.max(0, Math.floor(Date.now() / 1000 - event.blockTime));
    const today = new Date().toISOString().slice(0, 10);
    const spentToday = positionsRef.current
      .filter(position => position.openedAt.startsWith(today))
      .reduce((sum, position) => sum + position.amountUsd, 0);
    const decision = evaluateCopySignal({
      sourcePrice: event.sourcePriceUsd,
      currentPrice: event.current.priceUsd,
      detectedAfterSeconds: delay,
    }, settingsRef.current, {
      openPositions: positionsRef.current.filter(position => position.status === "OPEN").length,
      spentTodayUsd: spentToday,
      alreadyHolding: positionsRef.current.some(position => position.status === "OPEN" && position.mint === event.mint),
      walletEnabled: wallet.enabled,
    });
    if (!decision.accepted) {
      setSkipped(current => [{
        id: crypto.randomUUID(), signature: event.signature, wallet: wallet.address, mint: event.mint,
        symbol: event.current?.symbol ?? shortAddress(event.mint), detectedAt: new Date().toISOString(), reason: decision.reason ?? "条件外",
      }, ...current.filter(item => item.signature !== event.signature)]);
      return;
    }
    try {
      const riskResponse = await fetch(`/api/live/risk?mint=${encodeURIComponent(event.mint)}`, { cache: "no-store" });
      const riskPayload = await riskResponse.json() as { safe?: boolean; risks?: string[]; error?: string };
      if (!riskResponse.ok) throw new Error(riskPayload.error ?? "危険判定を取得できない");
      if (!riskPayload.safe) throw new Error(`危険トークン: ${(riskPayload.risks ?? []).slice(0, 2).join("、")}`);
      const response = await fetch(`/api/live/quote?mint=${encodeURIComponent(event.mint)}&amountUsd=${settingsRef.current.amountPerTrade}&slippageBps=${Math.round(settingsRef.current.maxSlippage * 100)}`, { cache: "no-store" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Jupiter見積もり失敗");
      setPositions(current => [{
        id: crypto.randomUUID(),
        signature: event.signature,
        wallet: wallet.address,
        mint: event.mint,
        symbol: event.current?.symbol ?? shortAddress(event.mint),
        openedAt: new Date().toISOString(),
        sourceBlockTime: event.blockTime,
        detectionDelaySeconds: delay,
        sourcePriceUsd: event.sourcePriceUsd,
        copyPriceUsd: event.current?.priceUsd ?? 0,
        currentPriceUsd: event.current?.priceUsd ?? 0,
        amountUsd: settingsRef.current.amountPerTrade,
        liquidityUsd: event.current?.liquidityUsd ?? 0,
        entryMarketCapUsd: event.current?.marketCapUsd || undefined,
        currentMarketCapUsd: event.current?.marketCapUsd || undefined,
        executionMode: "PAPER",
        status: "OPEN",
      }, ...current.filter(item => item.signature !== event.signature)]);
    } catch (quoteError) {
      setSkipped(current => [{
        id: crypto.randomUUID(), signature: event.signature, wallet: wallet.address, mint: event.mint,
        symbol: event.current?.symbol ?? shortAddress(event.mint), detectedAt: new Date().toISOString(),
        reason: quoteError instanceof Error ? quoteError.message : "Jupiter交換経路なし",
      }, ...current.filter(item => item.signature !== event.signature)]);
    }
  }, [closePosition]);

  const refreshWallet = useCallback(async (wallet: TrackedWallet, analyze = false) => {
    if ((wallet.network ?? "SOLANA") !== "SOLANA") {
      setError("Ethereumの採用候補は現在ランキング保存のみです。Ethereumペーパートレード監視は次の実装で有効化します。");
      return;
    }
    setBusy(wallet.address);
    setError(null);
    try {
      const [activityResponse, scoreResponse] = await Promise.all([
        fetch(`/api/live/wallet?address=${encodeURIComponent(wallet.address)}`, { cache: "no-store" }),
        analyze ? fetch(`/api/live/score?address=${encodeURIComponent(wallet.address)}`, { cache: "no-store" }) : Promise.resolve(null),
      ]);
      const activityPayload = await activityResponse.json() as LiveWalletResponse & { error?: string };
      if (!activityResponse.ok) throw new Error(activityPayload.error ?? "実取引の取得に失敗しました");
      setActivities(current => ({ ...current, [wallet.address]: activityPayload }));
      setPositions(current => current.map(position => {
        if (position.status !== "OPEN") return position;
        const currentEvent = activityPayload.events.find(event => event.mint === position.mint && event.current);
        if (!currentEvent?.current) return position;
        return {
          ...position,
          currentPriceUsd: currentEvent.current.priceUsd,
          currentMarketCapUsd: currentEvent.current.marketCapUsd || undefined,
        };
      }));
      if (analyze && scoreResponse) {
        const scorePayload = await scoreResponse.json() as WalletScore & { error?: string };
        if (scoreResponse.ok) setWallets(current => current.map(item => item.address === wallet.address ? { ...item, score: scorePayload } : item));
      }
      activityPayload.events.forEach(event => processedRef.current.add(`${event.signature}:${event.mint}:${event.side}`));
      localStorage.setItem(STORAGE.processed, JSON.stringify([...processedRef.current].slice(-2000)));
      setLastRefresh(new Date().toISOString());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "更新に失敗しました");
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    for (const wallet of walletsRef.current.filter(item => item.enabled && (item.network ?? "SOLANA") === "SOLANA")) await refreshWallet(wallet);
  }, [refreshWallet]);

  useEffect(() => {
    if (!hydrated || !settings.enabled) return;
    const timer = window.setInterval(() => void refreshAll(), 15000);
    return () => window.clearInterval(timer);
  }, [hydrated, settings.enabled, refreshAll]);

  const addManual = (address: string, label: string, origin: TrackedWallet["origin"] = "MANUAL") => {
    if (!ADDRESS_PATTERN.test(address)) return "Solanaウォレットアドレスを確認してください";
    const existing = wallets.find(wallet => wallet.address === address);
    if (existing) return "このアドレスは登録済みです";
    if (wallets.length >= COPY_SOURCE_WALLET_LIMIT) return `コピー元ウォレットは合計${COPY_SOURCE_WALLET_LIMIT}件までです`;
    const wallet: TrackedWallet = {
      network: "SOLANA",
      address,
      label: label || `コピー元 ${wallets.length + 1}`,
      origin,
      enabled: true,
      addedAt: new Date().toISOString(),
    };
    setWallets(current => [...current, wallet]);
    void saveTrackedWallet(wallet).then(saved => {
      setWallets(current => current.map(item => item.address === saved.address && (item.network ?? "SOLANA") === (saved.network ?? "SOLANA") ? { ...item, ...saved } : item));
    }).catch(saveError => setError(saveError instanceof Error ? saveError.message : "ウォレットのDB保存に失敗しました"));
    return null;
  };

  const scan = async () => {
    setError(null);
    try {
      const network = scanNetwork;
      const state = await requestJson<WalletScanState>(scanUrl, 30_000, { method: "POST" });
      setScanStates(current => ({ ...current, [network]: state }));
      if (state.result) setScanResults(current => ({ ...current, [network]: state.result! }));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "スキャンに失敗しました");
    }
  };

  const addScanCandidate = (score: WalletScore, rank: number) => {
    if (rank > 5) return;
    const blockers = score.blockers ?? [];
    if (score.addable === false || blockers.length > 0 || score.score === 0 || (score.sellEvents ?? 0) === 0) {
      setError(`このウォレットは追加できません: ${blockers.join("、") || "重大な問題があります"}`);
      return;
    }
    setWallets(current => {
      const network = score.network ?? scanNetwork;
      if (current.some(wallet => (wallet.network ?? "SOLANA") === network && wallet.address.toLowerCase() === score.address.toLowerCase())) return current;
      if (current.length >= COPY_SOURCE_WALLET_LIMIT) {
        setError(`コピー元ウォレットは合計${COPY_SOURCE_WALLET_LIMIT}件までです`);
        return current;
      }
      setError(null);
      const candidate: TrackedWallet = {
        network,
        address: score.address,
        label: `${network === "SOLANA" ? "SOL" : "ETH"} 採用候補 #${rank}`,
        origin: "AUTO",
        enabled: false,
        addedAt: new Date().toISOString(),
        score,
      };
      void saveTrackedWallet(candidate).catch(saveError => setError(saveError instanceof Error ? saveError.message : "採用候補のDB保存に失敗しました"));
      return [...current, candidate];
    });
  };

  const removeWallet = (target: TrackedWallet) => {
    setWallets(current => current.filter(wallet => !((wallet.network ?? "SOLANA") === (target.network ?? "SOLANA") && wallet.address.toLowerCase() === target.address.toLowerCase())));
    void deleteTrackedWallet(target).catch(deleteError => {
      setWallets(current => current.some(wallet => (wallet.network ?? "SOLANA") === (target.network ?? "SOLANA") && wallet.address.toLowerCase() === target.address.toLowerCase()) ? current : [...current, target]);
      setError(deleteError instanceof Error ? deleteError.message : "ウォレット削除のDB反映に失敗しました");
    });
  };

  const toggleWallet = (target: TrackedWallet, enabled: boolean) => {
    const updated = { ...target, enabled };
    setWallets(current => current.map(wallet => (wallet.network ?? "SOLANA") === (target.network ?? "SOLANA") && wallet.address.toLowerCase() === target.address.toLowerCase() ? updated : wallet));
    void saveTrackedWallet(updated, "PATCH").catch(saveError => setError(saveError instanceof Error ? saveError.message : "コピー設定のDB保存に失敗しました"));
  };

  const stopAllWallets = () => {
    const enabledWallets = wallets.filter(wallet => wallet.enabled);
    setWallets(current => current.map(wallet => ({ ...wallet, enabled: false })));
    void Promise.all(enabledWallets.map(wallet => saveTrackedWallet({ ...wallet, enabled: false }, "PATCH")))
      .catch(saveError => setError(saveError instanceof Error ? saveError.message : "一括停止のDB保存に失敗しました"));
  };

  const addFavorite = async (mint: string) => {
    if (!ADDRESS_PATTERN.test(mint)) return "SolanaのCAを確認してください";
    if (favorites.some(token => token.mint === mint)) return "このコインは登録済みです";
    try {
      const payload = await requestJson<Omit<FavoriteToken, "addedAt">>(`/api/live/token?mint=${encodeURIComponent(mint)}`, 60_000);
      setFavorites(current => [...current, { ...payload, addedAt: new Date().toISOString() }]);
      return null;
    } catch (favoriteError) {
      return favoriteError instanceof Error ? favoriteError.message : "登録に失敗しました";
    }
  };

  const paperPositions = positions.filter(position => (position.executionMode ?? "PAPER") === "PAPER");
  const openPositions = paperPositions.filter(position => position.status === "OPEN");
  const closedPnl = positions
    .filter(position => (position.executionMode ?? "PAPER") === "PAPER" && position.status === "CLOSED" && position.exitPriceUsd)
    .reduce((sum, position) => sum + (position.realizedPnlUsd ?? calculatePaperPnl(position.copyPriceUsd, position.exitPriceUsd ?? position.copyPriceUsd, position.amountUsd).pnlUsd), 0);
  const openPnl = openPositions.reduce((sum, position) => sum + calculatePaperPnl(position.copyPriceUsd, position.currentPriceUsd, position.amountUsd).pnlUsd, 0);
  const paperBalance = INITIAL_PAPER_BALANCE + closedPnl + openPnl;
  const currentTitle = useMemo(() => nav.find(item => item.id === view)?.label ?? "", [view]);

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-white/[0.07] bg-[#090d0f]/95 backdrop-blur-xl transition-transform lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-16 items-center border-b border-white/[0.07] px-5">
          <img src="/next-trade-icon.png" alt="NEXT-TRADE" className="mr-3 h-10 w-10 rounded-xl object-contain" />
          <div><p className="text-sm font-bold tracking-[.12em]">NEXT-TRADE</p><p className="text-[9px] tracking-[.18em] text-[#5f7077]">SMART WALLET COPY</p></div>
        </div>
        <nav className="p-3">
          {nav.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => { setView(item.id); setMobileOpen(false); }} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${view === item.id ? "bg-[#16221e] text-[#38e7ae]" : "text-[#839299] hover:bg-white/[0.03] hover:text-white"}`}>
                <Icon size={17} />{item.label}
                {item.id === "sources" && <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px]">{wallets.length}</span>}
              </button>
            );
          })}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 border-t border-white/[0.07] p-4">
          <div className="mb-3 flex items-center justify-between"><span className="text-xs text-[#7b8b91]">運用モード</span><Badge tone={settings.liveTradingEnabled ? "red" : "amber"}>{settings.liveTradingEnabled ? "LIVE" : "PAPER"}</Badge></div>
          <div className="rounded-xl bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 text-xs"><span className="live-dot h-2 w-2 rounded-full bg-[#38e7ae]" />Solana Mainnet</div>
            <p className="mt-1.5 text-[10px] text-[#5f7077]">市場データ：実データ</p>
          </div>
        </div>
      </aside>
      {mobileOpen && <button aria-label="メニューを閉じる" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-black/70 lg:hidden" />}
      <div className="w-full min-w-0 max-w-full lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/[0.07] bg-[#080c0e]/85 px-4 backdrop-blur-xl md:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="rounded-lg border border-white/10 p-2 lg:hidden"><Menu size={17} /></button>
            <div className="flex items-center gap-2 lg:hidden">
              <img src="/next-trade-icon.png" alt="" className="h-8 w-8 rounded-lg object-contain" />
              <div>
                <p className="text-xs font-bold tracking-[.1em] text-white">NEXT-TRADE</p>
                <p className="text-[9px] text-[#64747a]">{currentTitle}</p>
              </div>
            </div>
            <span className="hidden text-sm font-medium lg:inline">{currentTitle}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block"><p className="text-[10px] text-[#64747a]">{settings.liveTradingEnabled ? "取引USDC残高" : "仮想残高"}</p><p className="text-sm font-semibold tabular-nums">{settings.liveTradingEnabled && liveStatus?.usdcBalance != null ? `${liveStatus.usdcBalance.toFixed(2)} USDC` : money(paperBalance)}</p></div>
            <WalletMultiButton />
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-[1500px] overflow-x-hidden p-4 md:p-6">
          {error && <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-400/20 bg-rose-400/[0.07] p-4 text-sm text-rose-200"><X size={17} className="mt-0.5 shrink-0" /><span className="min-w-0 flex-1 whitespace-pre-wrap break-all leading-relaxed">{error}</span><button onClick={() => setError(null)} className="text-xs">閉じる</button></div>}
          <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
            <Badge tone="green"><ShieldCheck size={12} className="mr-1" />実ウォレットデータのみ</Badge>
            <Badge tone={settings.liveTradingEnabled ? "red" : "amber"}><CircleDollarSign size={12} className="mr-1" />{settings.liveTradingEnabled ? "実資金モード" : "資金はデモ"}</Badge>
            <Badge tone="gray">コピー元 {wallets.length}/{COPY_SOURCE_WALLET_LIMIT}</Badge>
          </div>
          {view === "dashboard" && <Dashboard wallets={wallets} positions={positions} activities={activities} skipped={skipped} lastRefresh={lastRefresh} liveMode={settings.liveTradingEnabled} liveStatus={liveStatus} limitOrders={limitOrders} onClose={closePosition} onCreateLimitOrder={createLimitOrder} onCancelLimitOrder={cancelLimitOrder} />}
          {view === "sources" && <Sources wallets={wallets} activities={activities} busy={busy} onAdd={addManual} onDelete={removeWallet} onToggle={toggleWallet} onStopAll={stopAllWallets} onRefresh={refreshWallet} onRefreshAll={refreshAll} />}
          {view === "scanner" && <Scanner network={scanNetwork} onNetworkChange={setScanNetwork} result={scanResult} scanState={scanState} scanning={scanState?.status === "RUNNING"} wallets={wallets} autoCount={wallets.length} onScan={scan} onAddCandidate={addScanCandidate} />}
          {view === "favorites" && <FavoritesView favorites={favorites} activities={activities} limitOrders={limitOrders} onAdd={addFavorite} onDelete={mint => setFavorites(current => current.filter(token => token.mint !== mint))} onAddManual={addManual} onCreateLimitOrder={createLimitOrder} onCancelLimitOrder={cancelLimitOrder} />}
          {view === "activity" && <MobileActivityView activities={activities} positions={positions} skipped={skipped} onClose={closePosition} />}
          {view === "settings" && <SettingsView settings={settings} liveStatus={liveStatus} dailyLoss={dailyLoss} ntfyConfig={ntfyConfig} onChange={setSettings} />}
        </main>
      </div>
    </div>
  );
}
