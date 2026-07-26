"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { defaultSettings, equityCurve, favorites as initialFavorites, positions, trades, wallets as initialWallets } from "../lib/mock-data";
import type { CopySettings, FavoriteToken, Wallet } from "../lib/types";
import type { LivePaperPosition, LiveWalletEvent, LiveWalletResponse } from "../lib/live-types";

type View = "live" | "dashboard" | "wallets" | "favorites" | "settings" | "paper" | "history";

const nav: { id: View; label: string; glyph: string }[] = [
  { id:"live", label:"実データ・デモ", glyph:"●" },
  { id:"dashboard", label:"ダッシュボード", glyph:"⌁" },
  { id:"wallets", label:"優秀ウォレット", glyph:"◉" },
  { id:"favorites", label:"お気に入りコイン", glyph:"☆" },
  { id:"settings", label:"コピー設定", glyph:"⚙" },
  { id:"paper", label:"ペーパートレード", glyph:"▤" },
  { id:"history", label:"取引履歴", glyph:"↕" },
];

const money = (value: number, signed = false) =>
  `${signed && value >= 0 ? "+" : ""}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function Pill({ children, tone = "green" }: { children: React.ReactNode; tone?: "green"|"red"|"gray"|"amber" }) {
  const colors = { green:"bg-[#173c31] text-[#43e8ae]", red:"bg-[#3a2025] text-[#ff7e87]", gray:"bg-[#1b2327] text-[#9caab1]", amber:"bg-[#3d3020] text-[#ffc76b]" };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${colors[tone]}`}>{children}</span>;
}

function Toggle({ checked, onChange, label }: { checked:boolean; onChange:(v:boolean)=>void; label:string }) {
  return <button aria-label={label} aria-pressed={checked} onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full border transition ${checked ? "border-[#2ee6a6] bg-[#1d7458]" : "border-[#39464d] bg-[#20282c]"}`}>
    <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition ${checked ? "left-[21px]" : "left-0.5"}`} />
  </button>;
}

function Card({ children, className = "" }: { children:React.ReactNode; className?:string }) {
  return <section className={`rounded-xl border border-[#202a30] bg-[#0f1417] ${className}`}>{children}</section>;
}

function SectionTitle({ title, note, action }: { title:string; note?:string; action?:React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4 border-b border-[#202a30] px-5 py-4">
    <div><h2 className="text-sm font-semibold">{title}</h2>{note && <p className="mt-1 text-xs text-[#819099]">{note}</p>}</div>{action}
  </div>;
}

function Metric({ label, value, delta, accent = false }: { label:string; value:string; delta?:string; accent?:boolean }) {
  return <Card className="min-h-28 p-4">
    <div className="text-xs text-[#819099]">{label}</div>
    <div className={`num mt-3 text-2xl font-semibold tracking-tight ${accent ? "text-[#2ee6a6]" : ""}`}>{value}</div>
    {delta && <div className={`mt-2 text-xs ${delta.startsWith("+") ? "text-[#2ee6a6]" : "text-[#ff6b76]"}`}>{delta}</div>}
  </Card>;
}

function EquityChart() {
  const max = Math.max(...equityCurve), min = Math.min(...equityCurve);
  return <div className="relative flex h-56 items-end gap-1.5 overflow-hidden px-1 pt-6">
    {[10000,10600,11200,11800].map((n,i)=><div key={n} className="absolute left-0 right-0 border-t border-dashed border-[#263137]" style={{bottom:`${i*29+12}%`}}><span className="absolute -top-4 right-1 text-[10px] text-[#5f6c73]">${(n/1000).toFixed(1)}k</span></div>)}
    {equityCurve.map((value,i)=><div key={i} className="relative z-10 flex-1 rounded-t-sm bg-gradient-to-t from-[#123a2d] to-[#2ee6a6] opacity-75 transition hover:opacity-100" style={{height:`${18 + ((value-min)/(max-min))*72}%`}} title={`$${value.toLocaleString()}`} />)}
  </div>;
}

function Dashboard({ onView }: { onView:(v:View)=>void }) {
  return <>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-xl font-semibold">運用サマリー</h1><p className="mt-1 text-sm text-[#819099]">ペーパートレードの現在状況</p></div>
      <div className="flex items-center gap-2 text-xs text-[#819099]"><span className="live-dot h-2 w-2 rounded-full bg-[#2ee6a6]"/>リアルタイム更新中</div>
    </div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Metric label="コピー対象ウォレット" value="3 / 5" delta="+1 今週" />
      <Metric label="ペーパートレード残高" value="$12,180.42" delta="+21.8% 開始時比" accent />
      <Metric label="本日の損益" value="+$112.31" delta="+0.93%" accent />
      <Metric label="今月の損益" value="+$2,180.42" delta="+21.8%" accent />
    </div>
    <div className="mt-3 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
      <Card>
        <SectionTitle title="資産推移" note="過去14日・USD建て" action={<Pill>+$2,180.42</Pill>} />
        <EquityChart />
      </Card>
      <Card>
        <SectionTitle title="パフォーマンス" note="決済済みコピー取引" />
        <div className="grid grid-cols-2 gap-px bg-[#202a30]">
          {[["総損益","+$2,180.42"],["勝率","71.4%"],["コピー成功率","82.6%"],["取引回数","42"],["平均利益","+12.8%"],["最大DD","-6.9%"]].map(([a,b],i)=><div key={a} className="bg-[#0f1417] p-4"><div className="text-xs text-[#819099]">{a}</div><div className={`num mt-2 font-semibold ${i===0||i===4?"text-[#2ee6a6]":i===5?"text-[#ff6b76]":""}`}>{b}</div></div>)}
        </div>
      </Card>
    </div>
    <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.25fr]">
      <Card>
        <SectionTitle title="現在保有中" note={`${positions.length} ポジション`} action={<button onClick={()=>onView("paper")} className="text-xs text-[#2ee6a6]">すべて見る →</button>} />
        <div className="divide-y divide-[#202a30]">
          {positions.map(p=><div key={p.id} className="flex items-center gap-3 px-5 py-3.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1c272b] text-xs font-bold">{p.symbol[0]}</div>
            <div className="min-w-0 flex-1"><div className="font-semibold">{p.symbol}</div><div className="truncate text-xs text-[#819099]">{p.source}</div></div>
            <div className="text-right"><div className={`num text-sm font-semibold ${p.pnlUsd>=0?"text-[#2ee6a6]":"text-[#ff6b76]"}`}>{money(p.pnlUsd,true)}</div><div className="num text-xs text-[#819099]">{p.pnlPct>0?"+":""}{p.pnlPct}%</div></div>
          </div>)}
        </div>
      </Card>
      <Card>
        <SectionTitle title="直近のコピー取引" note="約5秒ごとに同期" action={<button onClick={()=>onView("history")} className="text-xs text-[#2ee6a6]">履歴へ →</button>} />
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs">
          <thead className="text-[#65737a]"><tr>{["時刻","区分","コイン","コピー元","損益","状態"].map(h=><th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{trades.slice(0,5).map(t=><tr key={t.id} className="border-t border-[#202a30]">
            <td className="px-4 py-3 text-[#819099]">{t.at}</td><td className="px-4 py-3"><Pill tone={t.side==="売り"?"green":t.side==="見送り"?"gray":"amber"}>{t.side}</Pill></td>
            <td className="px-4 py-3 font-semibold">{t.symbol}</td><td className="px-4 py-3 text-[#aab6bb]">{t.wallet}</td>
            <td className={`num px-4 py-3 ${t.pnlUsd==null?"text-[#65737a]":t.pnlUsd>=0?"text-[#2ee6a6]":"text-[#ff6b76]"}`}>{t.pnlUsd==null?"—":money(t.pnlUsd,true)}</td>
            <td className="px-4 py-3 text-[#aab6bb]">{t.status}</td>
          </tr>)}</tbody>
        </table></div>
      </Card>
    </div>
  </>;
}

function Wallets({ data, setData, selected, setSelected }: { data:Wallet[]; setData:React.Dispatch<React.SetStateAction<Wallet[]>>; selected:Wallet|null; setSelected:(w:Wallet|null)=>void }) {
  if (selected) return <WalletDetail wallet={selected} onBack={()=>setSelected(null)} onToggle={() => {
    setData(all=>all.map(w=>w.id===selected.id?{...w,copying:!w.copying}:w));
    setSelected({...selected,copying:!selected.copying});
  }} />;
  return <>
    <div className="mb-5"><h1 className="text-xl font-semibold">優秀ウォレット</h1><p className="mt-1 text-sm text-[#819099]">確定損益と継続性を重視したランキング</p></div>
    <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric label="採用ウォレット" value="5" /><Metric label="平均30日ROI" value="110.1%" accent /><Metric label="平均勝率" value="69.3%" /><Metric label="分析対象" value="8,420" />
    </div>
    <Card>
      <SectionTitle title="ウォレットランキング" note="ROI 60%以上・30日20取引以上・経過90日以上・リスク審査済み" />
      <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs">
        <thead className="text-[#65737a]"><tr>{["# / ウォレット","スコア","30日ROI","確定利益","勝率","取引数","平均保有","最大DD","経過日数","コピー",""].map(h=><th key={h} className="whitespace-nowrap px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{data.map((w,i)=><tr key={w.id} className="border-t border-[#202a30] transition hover:bg-[#131a1e]">
          <td className="px-4 py-3"><div className="flex items-center gap-3"><span className="text-[#56636a]">{String(i+1).padStart(2,"0")}</span><div><div className="font-semibold text-[#edf4f1]">{w.name}</div><div className="mt-0.5 font-mono text-[10px] text-[#65737a]">{w.address}</div></div></div></td>
          <td className="px-4 py-3"><span className="num text-base font-semibold">{w.score}</span><span className="text-[#65737a]"> /100</span></td>
          <td className="num px-4 py-3 font-semibold text-[#2ee6a6]">+{w.roi30d}%</td><td className="num px-4 py-3">{money(w.realizedProfitUsd,true)}</td><td className="num px-4 py-3">{w.winRate}%</td><td className="num px-4 py-3">{w.trades30d}</td><td className="px-4 py-3">{w.avgHold}</td>
          <td className="num px-4 py-3 text-[#ff7e87]">{w.maxDrawdown}%</td><td className="num px-4 py-3">{w.ageDays}日</td>
          <td className="px-4 py-3"><Toggle checked={w.copying} label={`${w.name}のコピー`} onChange={(v)=>setData(all=>all.map(x=>x.id===w.id?{...x,copying:v}:x))}/></td>
          <td className="px-4 py-3"><button onClick={()=>setSelected(w)} className="rounded-md border border-[#344149] px-3 py-2 transition hover:border-[#2ee6a6] hover:text-[#2ee6a6]">詳細</button></td>
        </tr>)}</tbody>
      </table></div>
    </Card>
  </>;
}

function WalletDetail({ wallet:w, onBack, onToggle }: { wallet:Wallet; onBack:()=>void; onToggle:()=>void }) {
  return <>
    <button onClick={onBack} className="mb-5 text-sm text-[#819099] hover:text-white">← ランキングへ戻る</button>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex items-center gap-3"><h1 className="text-xl font-semibold">{w.name}</h1><Pill>{w.score}点</Pill></div><p className="mt-2 font-mono text-xs text-[#819099]">{w.address}</p></div>
      <button onClick={onToggle} className={`rounded-lg px-5 py-2.5 text-sm font-semibold ${w.copying?"border border-[#39464d]":"bg-[#2ee6a6] text-[#07100d]"}`}>{w.copying?"コピーを停止":"コピーを開始"}</button>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric label="30日ROI（確定損益基準）" value={`+${w.roi30d}%`} accent/><Metric label="確定利益" value={money(w.realizedProfitUsd,true)} accent/><Metric label="未確定損益" value={money(w.unrealizedProfitUsd,true)} /><Metric label="勝率" value={`${w.winRate}%`} />
      <Metric label="平均利益率" value="+14.8%" /><Metric label="平均損失率" value="-5.2%" /><Metric label="最大ドローダウン" value={`${w.maxDrawdown}%`} /><Metric label="平均保有時間" value={w.avgHold} />
    </div>
    <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
      <Card><SectionTitle title="利益推移" note="直近30日・確定損益のみ" /><EquityChart/></Card>
      <Card><SectionTitle title="評価内訳" note="100点満点" /><div className="space-y-4 p-5">{[["30日ROI",24,25],["確定利益額",14,15],["勝率",13,15],["利益継続性",14,15],["ドローダウン",9,10],["取引回数",9,10],["経過日数",5,5],["お気に入り実績",w.favoriteSymbols.length?5:0,5]].map(([label,v,m])=><div key={label as string}><div className="mb-1.5 flex justify-between text-xs"><span>{label}</span><span className="num text-[#819099]">{v} / {m}</span></div><div className="h-1.5 rounded bg-[#202a30]"><div className="h-full rounded bg-[#2ee6a6]" style={{width:`${Number(v)/Number(m)*100}%`}}/></div></div>)}</div></Card>
    </div>
    <Card className="mt-3"><SectionTitle title="取引履歴" note="直近のオンチェーン売買（モック）" /><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-xs"><thead className="text-[#65737a]"><tr>{["日時","コイン","区分","価格","確定損益","保有時間"].map(x=><th key={x} className="px-5 py-3 font-medium">{x}</th>)}</tr></thead><tbody>{trades.slice(0,4).map(t=><tr key={t.id} className="border-t border-[#202a30]"><td className="px-5 py-3">{t.at}</td><td className="px-5 py-3 font-semibold">{t.symbol}</td><td className="px-5 py-3">{t.side}</td><td className="num px-5 py-3">{t.sellPrice??t.buyPrice??"—"}</td><td className={`num px-5 py-3 ${Number(t.pnlUsd)>=0?"text-[#2ee6a6]":"text-[#ff6b76]"}`}>{t.pnlUsd==null?"保有中":money(t.pnlUsd,true)}</td><td className="px-5 py-3">2時間 14分</td></tr>)}</tbody></table></div></Card>
  </>;
}

function Favorites({ items, setItems }: { items:FavoriteToken[]; setItems:React.Dispatch<React.SetStateAction<FavoriteToken[]>> }) {
  const [open,setOpen]=useState(false), [name,setName]=useState(""), [symbol,setSymbol]=useState(""), [mint,setMint]=useState("");
  const add = () => { if(!name||!symbol||!mint)return; setItems(x=>[...x,{id:crypto.randomUUID(),name,symbol:symbol.toUpperCase(),mint,icon:symbol[0].toUpperCase(),createdAt:new Date().toLocaleDateString("ja-JP"),wallets:[]}]); setName("");setSymbol("");setMint("");setOpen(false); };
  return <>
    <div className="mb-5 flex items-end justify-between gap-3"><div><h1 className="text-xl font-semibold">お気に入りコイン</h1><p className="mt-1 text-sm text-[#819099]">指定コインで実績のある優秀ウォレットを探索</p></div><button onClick={()=>setOpen(true)} className="rounded-lg bg-[#2ee6a6] px-4 py-2.5 text-sm font-semibold text-[#07100d]">＋ コインを登録</button></div>
    {open && <Card className="mb-3 p-5"><div className="grid gap-3 md:grid-cols-3"><Field label="コイン名" value={name} onChange={setName} placeholder="例：Bonk"/><Field label="シンボル" value={symbol} onChange={setSymbol} placeholder="BONK"/><Field label="コントラクトアドレス" value={mint} onChange={setMint} placeholder="Solana Mint Address"/></div><div className="mt-4 flex justify-end gap-2"><button onClick={()=>setOpen(false)} className="rounded-lg border border-[#344149] px-4 py-2 text-sm">キャンセル</button><button onClick={add} className="rounded-lg bg-[#2ee6a6] px-4 py-2 text-sm font-semibold text-black">登録する</button></div></Card>}
    <div className="grid gap-3 lg:grid-cols-2">{items.map(token=><Card key={token.id}>
      <div className="flex items-start gap-4 p-5"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1e2a2e] text-lg font-bold text-[#2ee6a6]">{token.icon}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="font-semibold">{token.name}</h2><Pill>{token.symbol}</Pill></div><div className="mt-2 truncate font-mono text-[11px] text-[#65737a]">{token.mint}</div><div className="mt-1 text-[11px] text-[#65737a]">登録日 {token.createdAt}</div></div><button onClick={()=>setItems(a=>a.filter(x=>x.id!==token.id))} className="text-xs text-[#65737a] hover:text-[#ff6b76]">削除</button></div>
      <div className="border-t border-[#202a30] px-5 py-4"><div className="mb-3 text-xs text-[#819099]">利益実績のあるウォレット</div>{token.wallets.length?<div className="space-y-2">{token.wallets.map((name,i)=><div key={name} className="flex items-center justify-between rounded-lg bg-[#131a1e] px-3 py-2.5"><div><span className="text-sm font-medium">{name}</span><span className="ml-2 text-xs text-[#65737a]">{i===0?"+$12,840":"+$7,210"} 確定</span></div><Pill>{i===0?"184.2%":"76.3%"} ROI</Pill></div>)}</div>:<div className="rounded-lg border border-dashed border-[#2b373d] p-4 text-center text-xs text-[#65737a]">次回分析で対象ウォレットを探索します</div>}</div>
    </Card>)}</div>
  </>;
}

function Field({ label, value, onChange, suffix, type="text", placeholder }: { label:string; value:string|number; onChange:(v:any)=>void; suffix?:string; type?:string; placeholder?:string }) {
  return <label className="block"><span className="mb-2 block text-xs text-[#819099]">{label}</span><div className="flex items-center rounded-lg border border-[#29343a] bg-[#0b1012] focus-within:border-[#2ee6a6]"><input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(type==="number"?Number(e.target.value):e.target.value)} className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-[#465158]"/>{suffix&&<span className="pr-3 text-xs text-[#65737a]">{suffix}</span>}</div></label>;
}

function Settings({ settings, setSettings }: { settings:CopySettings; setSettings:React.Dispatch<React.SetStateAction<CopySettings>> }) {
  const [saved,setSaved]=useState(false);
  const update = <K extends keyof CopySettings>(key:K,value:CopySettings[K])=>setSettings(s=>({...s,[key]:value}));
  return <>
    <div className="mb-5 flex items-end justify-between gap-3"><div><h1 className="text-xl font-semibold">コピー設定</h1><p className="mt-1 text-sm text-[#819099]">ペーパートレードの実行条件とリスク管理</p></div><button onClick={()=>{localStorage.setItem("nexus-settings",JSON.stringify(settings));setSaved(true);setTimeout(()=>setSaved(false),1800)}} className="rounded-lg bg-[#2ee6a6] px-5 py-2.5 text-sm font-semibold text-[#07100d]">{saved?"保存しました ✓":"設定を保存"}</button></div>
    <Card className="mb-3"><div className="flex items-center justify-between p-5"><div><h2 className="font-semibold">コピー機能</h2><p className="mt-1 text-xs text-[#819099]">対象ウォレットの購入シグナルを仮想取引に反映します</p></div><Toggle checked={settings.enabled} onChange={v=>update("enabled",v)} label="コピー機能"/></div></Card>
    <div className="grid gap-3 lg:grid-cols-2">
      <Card><SectionTitle title="資金管理" note="仮想残高の利用上限"/><div className="grid grid-cols-2 gap-4 p-5"><Field label="1取引の仮想購入額" value={settings.amountPerTrade} onChange={v=>update("amountPerTrade",v)} type="number" suffix="USD"/><Field label="最大同時保有数" value={settings.maxPositions} onChange={v=>update("maxPositions",v)} type="number" suffix="件"/><Field label="1日の最大購入額" value={settings.maxDailyAmount} onChange={v=>update("maxDailyAmount",v)} type="number" suffix="USD"/><Field label="コピー対象ウォレット数" value={settings.maxWallets} onChange={v=>update("maxWallets",v)} type="number" suffix="件"/></div></Card>
      <Card><SectionTitle title="決済ルール" note="コピー元の売却より先に適用可能"/><div className="grid grid-cols-2 gap-4 p-5"><Field label="損切り率" value={settings.stopLoss} onChange={v=>update("stopLoss",v)} type="number" suffix="%"/><Field label="利確率" value={settings.takeProfit} onChange={v=>update("takeProfit",v)} type="number" suffix="%"/><Field label="最大スリッページ" value={settings.maxSlippage} onChange={v=>update("maxSlippage",v)} type="number" suffix="%"/><Field label="許容検知遅延" value={settings.maxDetectionSeconds} onChange={v=>update("maxDetectionSeconds",v)} type="number" suffix="秒"/></div></Card>
      <Card><SectionTitle title="トークン条件" note="購入前の安全・市場性チェック"/><div className="grid grid-cols-2 gap-4 p-5"><Field label="最低流動性" value={settings.minLiquidity} onChange={v=>update("minLiquidity",v)} type="number" suffix="USD"/><Field label="最低時価総額" value={settings.minMarketCap} onChange={v=>update("minMarketCap",v)} type="number" suffix="USD"/><div className="col-span-2"><Field label="コピー時点の許容上昇率" value={settings.maxPriceRise} onChange={v=>update("maxPriceRise",v)} type="number" suffix="%"/></div></div></Card>
      <Card><SectionTitle title="詳細条件" note="重複・対象範囲"/><div className="divide-y divide-[#202a30] px-5">{[["同じコインへの重複購入を許可","allowDuplicate"],["お気に入りコインだけをコピー","favoritesOnly"]].map(([label,key])=><div key={key} className="flex items-center justify-between py-5"><span className="text-sm">{label}</span><Toggle checked={settings[key as keyof CopySettings] as boolean} onChange={v=>update(key as keyof CopySettings,v as never)} label={label}/></div>)}</div></Card>
    </div>
    <div className="mt-3 rounded-lg border border-[#3d3020] bg-[#211b13] p-4 text-xs leading-6 text-[#d8b77f]">このMVPはペーパートレード専用です。秘密鍵・シードフレーズを保存せず、実資金を動かす処理は含まれていません。</div>
  </>;
}

function Paper() {
  const [balance,setBalance]=useState(12180.42);
  const [closed,setClosed]=useState<string[]>([]);
  return <>
    <div className="mb-5"><h1 className="text-xl font-semibold">ペーパートレード</h1><p className="mt-1 text-sm text-[#819099]">コピー取引を実資金なしで検証</p></div>
    <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="仮想残高" value={money(balance)} accent/><Metric label="ポジション評価額" value="$793.47"/><Metric label="含み損益" value="+$43.47" accent/><Metric label="利用可能額" value={money(balance-750)}/></div>
    <Card><SectionTitle title="保有ポジション" note="価格はモックフィードで更新" action={<div className="text-xs text-[#819099]"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#2ee6a6]"/>接続中</div>}/>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="text-[#65737a]"><tr>{["コイン","コピー元","購入価格","現在価格","仮想購入額","損益率","損益額","保有時間",""].map(h=><th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{positions.filter(p=>!closed.includes(p.id)).map(p=><tr key={p.id} className="border-t border-[#202a30]"><td className="px-4 py-4"><div className="font-semibold">{p.symbol}</div><div className="text-[10px] text-[#65737a]">{p.name}</div></td><td className="px-4 py-4">{p.source}</td><td className="num px-4 py-4">{p.entry}</td><td className="num px-4 py-4">{p.current}</td><td className="num px-4 py-4">{money(p.amountUsd)}</td><td className={`num px-4 py-4 ${p.pnlPct>=0?"text-[#2ee6a6]":"text-[#ff6b76]"}`}>{p.pnlPct>0?"+":""}{p.pnlPct}%</td><td className={`num px-4 py-4 ${p.pnlUsd>=0?"text-[#2ee6a6]":"text-[#ff6b76]"}`}>{money(p.pnlUsd,true)}</td><td className="px-4 py-4">{p.openedAt}</td><td className="px-4 py-4"><button onClick={()=>{setClosed(x=>[...x,p.id]);setBalance(x=>x+p.pnlUsd)}} className="rounded-md border border-[#39464d] px-3 py-2 hover:border-[#ff6b76] hover:text-[#ff6b76]">手動決済</button></td></tr>)}</tbody></table></div>
      {positions.every(p=>closed.includes(p.id))&&<div className="p-10 text-center text-sm text-[#65737a]">現在保有中のポジションはありません</div>}
    </Card>
    <Card className="mt-3"><SectionTitle title="コピー検知ログ" note="シグナルから仮想約定までの計測"/><div className="grid gap-px bg-[#202a30] sm:grid-cols-4">{[["平均検知遅延","3.2秒"],["平均スリッページ","0.84%"],["本日検知","18件"],["見送り","6件"]].map(([a,b])=><div key={a} className="bg-[#0f1417] p-5"><div className="text-xs text-[#819099]">{a}</div><div className="num mt-2 text-lg font-semibold">{b}</div></div>)}</div></Card>
  </>;
}

function History() {
  const [filter,setFilter]=useState("すべて");
  const shown=trades.filter(t=>filter==="すべて"||t.status===filter);
  return <>
    <div className="mb-5"><h1 className="text-xl font-semibold">取引履歴</h1><p className="mt-1 text-sm text-[#819099]">約定・決済・見送りをすべて記録</p></div>
    <Card><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#202a30] p-4"><div className="flex gap-1">{["すべて","保有中","決済済み","見送り"].map(f=><button key={f} onClick={()=>setFilter(f)} className={`rounded-md px-3 py-2 text-xs ${filter===f?"bg-[#26332f] text-[#2ee6a6]":"text-[#819099] hover:text-white"}`}>{f}</button>)}</div><button onClick={()=>alert("CSVエクスポートはDB接続後に利用できます")} className="rounded-md border border-[#344149] px-3 py-2 text-xs">CSVエクスポート</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="text-[#65737a]"><tr>{["日時","売買区分","コイン","コピー元","購入価格","売却価格","損益率","損益額","ステータス / 理由"].map(h=><th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{shown.map(t=><tr key={t.id} className="border-t border-[#202a30]"><td className="px-4 py-4 text-[#819099]">{t.at}</td><td className="px-4 py-4"><Pill tone={t.side==="見送り"?"gray":t.side==="売り"?"green":"amber"}>{t.side}</Pill></td><td className="px-4 py-4 font-semibold">{t.symbol}</td><td className="px-4 py-4">{t.wallet}</td><td className="num px-4 py-4">{t.buyPrice??"—"}</td><td className="num px-4 py-4">{t.sellPrice??"—"}</td><td className={`num px-4 py-4 ${Number(t.pnlPct)>=0?"text-[#2ee6a6]":"text-[#ff6b76]"}`}>{t.pnlPct==null?"—":`${t.pnlPct>0?"+":""}${t.pnlPct}%`}</td><td className={`num px-4 py-4 ${Number(t.pnlUsd)>=0?"text-[#2ee6a6]":"text-[#ff6b76]"}`}>{t.pnlUsd==null?"—":money(t.pnlUsd,true)}</td><td className="px-4 py-4"><div>{t.status}</div>{t.reason&&<div className="mt-1 text-[10px] text-[#65737a]">{t.reason}</div>}</td></tr>)}</tbody></table></div>
    </Card>
  </>;
}

function LiveDemo({ settings }: { settings: CopySettings }) {
  const { publicKey } = useWallet();
  const [address,setAddress]=useState("");
  const [data,setData]=useState<LiveWalletResponse|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [monitoring,setMonitoring]=useState(false);
  const [autoCopy,setAutoCopy]=useState(true);
  const [paperPositions,setPaperPositions]=useState<LivePaperPosition[]>([]);
  const [realizedPnl,setRealizedPnl]=useState(0);
  const knownSignatures=useRef(new Set<string>());

  useEffect(()=>{ const saved=localStorage.getItem("nexus-live-wallet"); if(saved)setAddress(saved); },[]);

  const openPaperPosition=(event:LiveWalletEvent)=>{
    if(!event.current || event.side!=="BUY") return;
    setPaperPositions(current=>{
      if(current.some(p=>p.signature===event.signature)) return current;
      if(current.length>=settings.maxPositions) return current;
      if(event.current!.liquidityUsd<settings.minLiquidity || event.current!.marketCapUsd<settings.minMarketCap) return current;
      return [{
        id:crypto.randomUUID(), signature:event.signature, wallet:address, mint:event.mint,
        symbol:event.current!.symbol, openedAt:new Date().toISOString(),
        copyPriceUsd:event.current!.priceUsd, currentPriceUsd:event.current!.priceUsd,
        amountUsd:settings.amountPerTrade, liquidityUsd:event.current!.liquidityUsd,
      },...current];
    });
  };

  const load=async(isPoll=false)=>{
    if(!address.trim()) { setError("追跡するSolanaウォレットアドレスを入力してください"); return; }
    if(!isPoll)setLoading(true);
    setError("");
    try{
      const response=await fetch(`/api/live/wallet?address=${encodeURIComponent(address.trim())}`,{cache:"no-store"});
      const payload=await response.json() as LiveWalletResponse & {error?:string};
      if(!response.ok)throw new Error(payload.error??"実データを取得できませんでした");
      const previous=knownSignatures.current;
      if(isPoll&&autoCopy){
        payload.events.filter(event=>event.side==="BUY"&&!previous.has(event.signature)).forEach(openPaperPosition);
      }
      knownSignatures.current=new Set(payload.events.map(event=>event.signature));
      setPaperPositions(current=>current.map(position=>{
        const latest=payload.events.find(event=>event.mint===position.mint)?.current?.priceUsd;
        return latest?{...position,currentPriceUsd:latest}:position;
      }));
      setData(payload);
      localStorage.setItem("nexus-live-wallet",address.trim());
    }catch(caught){setError(caught instanceof Error?caught.message:"実データを取得できませんでした");}
    finally{if(!isPoll)setLoading(false);}
  };

  useEffect(()=>{
    if(!monitoring||!address)return;
    const timer=window.setInterval(()=>void load(true),15000);
    return()=>window.clearInterval(timer);
  });

  const closePosition=(position:LivePaperPosition)=>{
    const pnl=(position.currentPriceUsd-position.copyPriceUsd)/position.copyPriceUsd*position.amountUsd;
    setRealizedPnl(value=>value+pnl);
    setPaperPositions(current=>current.filter(item=>item.id!==position.id));
  };

  return <>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><div className="flex items-center gap-2"><h1 className="text-xl font-semibold">実データ・デモトレード</h1><Pill>LIVE DATA</Pill><Pill tone="amber">PAPER ONLY</Pill></div><p className="mt-1 text-sm text-[#819099]">実在ウォレットのオンチェーン取引を、実際のDEX価格で仮想コピー</p></div>
      <div className="text-right text-xs text-[#819099]"><div>確定デモ損益</div><div className={`num mt-1 text-base font-semibold ${realizedPnl>=0?"text-[#2ee6a6]":"text-[#ff6b76]"}`}>{money(realizedPnl,true)}</div></div>
    </div>
    <Card className="mb-3">
      <SectionTitle title="追跡ウォレット" note="公開されているSolanaアドレスのみ。秘密鍵は不要です。" action={data&&<Pill tone={data.source==="HELIUS_RPC"?"green":"gray"}>{data.source==="HELIUS_RPC"?"HELIUS":"PUBLIC RPC"}</Pill>}/>
      <div className="p-5">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="flex-1"><Field label="コピー元ウォレットアドレス" value={address} onChange={setAddress} placeholder="例: 7xKX...（32〜44文字）"/></div>
          <div className="flex items-end gap-2">
            {publicKey&&<button onClick={()=>setAddress(publicKey.toBase58())} className="h-[42px] rounded-lg border border-[#344149] px-3 text-xs">接続中アドレスを使用</button>}
            <button onClick={()=>void load(false)} disabled={loading} className="h-[42px] rounded-lg bg-[#2ee6a6] px-5 text-sm font-semibold text-[#07100d] disabled:opacity-50">{loading?"取得中…":"実データを取得"}</button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-5 border-t border-[#202a30] pt-4">
          <div className="flex items-center gap-2 text-sm"><Toggle checked={monitoring} onChange={setMonitoring} label="15秒ごとに監視"/><span>15秒ごとに監視</span></div>
          <div className="flex items-center gap-2 text-sm"><Toggle checked={autoCopy} onChange={setAutoCopy} label="新規購入を自動デモコピー"/><span>新規購入を自動デモコピー</span></div>
          {data&&<span className="ml-auto text-xs text-[#65737a]">最終取得 {new Date(data.fetchedAt).toLocaleTimeString("ja-JP")}</span>}
        </div>
        {error&&<div className="mt-4 rounded-lg border border-[#5a2930] bg-[#29171b] p-3 text-sm text-[#ff8c94]">{error}</div>}
      </div>
    </Card>
    <div className="grid gap-3 xl:grid-cols-[1.35fr_1fr]">
      <Card>
        <SectionTitle title="直近の実取引候補" note={data?`${data.events.length}件をオンチェーンから検出`:"ウォレットアドレスを入力して取得してください"}/>
        {data?.events.length?<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs">
          <thead className="text-[#65737a]"><tr>{["時刻","区分","トークン","数量","元価格","現在価格","流動性",""].map(label=><th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>{data.events.map(event=><tr key={`${event.signature}-${event.mint}`} className="border-t border-[#202a30]">
            <td className="px-4 py-3">{event.blockTime?new Date(event.blockTime*1000).toLocaleString("ja-JP"):"—"}</td>
            <td className="px-4 py-3"><Pill tone={event.side==="BUY"?"green":"red"}>{event.side==="BUY"?"購入":"売却"}</Pill></td>
            <td className="px-4 py-3"><div className="font-semibold">{event.current?.symbol??`${event.mint.slice(0,5)}…`}</div><div className="mt-1 max-w-28 truncate font-mono text-[9px] text-[#65737a]">{event.mint}</div></td>
            <td className="num px-4 py-3">{event.tokenAmount.toLocaleString("en-US",{maximumFractionDigits:4})}</td>
            <td className="num px-4 py-3">{event.sourcePriceUsd?`$${event.sourcePriceUsd.toPrecision(5)}`:"算出不可"}</td>
            <td className="num px-4 py-3">{event.current?`$${event.current.priceUsd.toPrecision(5)}`:"価格なし"}</td>
            <td className="num px-4 py-3">{event.current?money(event.current.liquidityUsd):"—"}</td>
            <td className="px-4 py-3"><button disabled={event.side!=="BUY"||!event.current||paperPositions.some(p=>p.signature===event.signature)} onClick={()=>openPaperPosition(event)} className="rounded-md border border-[#344149] px-3 py-2 disabled:cursor-not-allowed disabled:opacity-30">現在価格でデモ購入</button></td>
          </tr>)}</tbody>
        </table></div>:<div className="p-10 text-center text-sm text-[#65737a]">{data?"直近の単純なスワップ候補は見つかりませんでした":"実データはまだ読み込まれていません"}</div>}
      </Card>
      <Card>
        <SectionTitle title="ライブ・ペーパーポジション" note={`${paperPositions.length} / ${settings.maxPositions} 保有中`}/>
        {paperPositions.length?<div className="divide-y divide-[#202a30]">{paperPositions.map(position=>{
          const pnlPct=(position.currentPriceUsd-position.copyPriceUsd)/position.copyPriceUsd*100;
          const pnlUsd=position.amountUsd*pnlPct/100;
          return <div key={position.id} className="p-4"><div className="flex items-start justify-between"><div><div className="font-semibold">{position.symbol}</div><div className="mt-1 text-[10px] text-[#65737a]">{new Date(position.openedAt).toLocaleTimeString("ja-JP")} デモ約定</div></div><div className={`num text-right ${pnlUsd>=0?"text-[#2ee6a6]":"text-[#ff6b76]"}`}><div className="font-semibold">{money(pnlUsd,true)}</div><div className="text-xs">{pnlPct>=0?"+":""}{pnlPct.toFixed(2)}%</div></div></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[#819099]"><div>購入 <span className="num text-white">${position.copyPriceUsd.toPrecision(5)}</span></div><div>現在 <span className="num text-white">${position.currentPriceUsd.toPrecision(5)}</span></div><div>仮想額 <span className="num text-white">{money(position.amountUsd)}</span></div><button onClick={()=>closePosition(position)} className="text-right text-[#ff8c94]">手動決済</button></div></div>;
        })}</div>:<div className="p-10 text-center text-sm text-[#65737a]">購入候補からデモ取引を開始できます</div>}
      </Card>
    </div>
    {data&&<div className="mt-3 rounded-lg border border-[#3d3020] bg-[#211b13] p-4 text-xs leading-6 text-[#d8b77f]">{data.warnings.join(" ")}</div>}
  </>;
}

export function TradingApp() {
  const [view,setView]=useState<View>("live"), [mobileOpen,setMobileOpen]=useState(false);
  const [wallets,setWallets]=useState(initialWallets), [selected,setSelected]=useState<Wallet|null>(null);
  const [favorites,setFavorites]=useState(initialFavorites), [settings,setSettings]=useState(defaultSettings);
  useEffect(()=>{ const saved=localStorage.getItem("nexus-settings"); if(saved) try{setSettings(JSON.parse(saved))}catch{} },[]);
  const title = useMemo(()=>nav.find(n=>n.id===view)?.label,[view]);
  const go=(v:View)=>{setView(v);setSelected(null);setMobileOpen(false)};
  return <div className="min-h-screen">
    <aside className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-[#202a30] bg-[#0b0f11]/95 backdrop-blur transition-transform lg:translate-x-0 ${mobileOpen?"translate-x-0":"-translate-x-full"}`}>
      <div className="flex h-16 items-center border-b border-[#202a30] px-5"><div className="mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[#2ee6a6] font-black text-[#07100d]">N</div><div><div className="text-sm font-bold tracking-[.18em]">NEXUS</div><div className="text-[9px] tracking-widest text-[#65737a]">SMART WALLET</div></div></div>
      <nav className="p-3">{nav.map(n=><button key={n.id} onClick={()=>go(n.id)} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition ${view===n.id?"bg-[#18231f] text-[#2ee6a6]":"text-[#87959c] hover:bg-[#11181b] hover:text-white"}`}><span className="w-5 text-center text-base">{n.glyph}</span>{n.label}{n.id==="wallets"&&<span className="ml-auto rounded bg-[#24302d] px-1.5 py-0.5 text-[9px]">5</span>}</button>)}</nav>
      <div className="absolute bottom-0 left-0 right-0 border-t border-[#202a30] p-4"><div className="mb-3 flex items-center justify-between text-xs"><span className="text-[#819099]">売買モード</span><Pill tone="amber">PAPER ONLY</Pill></div><div className="rounded-lg bg-[#11181b] p-3"><div className="flex items-center gap-2 text-xs"><span className="h-2 w-2 rounded-full bg-[#2ee6a6]"/>Solana Mainnet</div><div className="mt-1.5 text-[10px] text-[#65737a]">実データ / 実売買なし</div></div></div>
    </aside>
    {mobileOpen&&<button aria-label="メニューを閉じる" onClick={()=>setMobileOpen(false)} className="fixed inset-0 z-30 bg-black/60 lg:hidden"/>}
    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#202a30] bg-[#080b0d]/85 px-4 backdrop-blur md:px-6"><div className="flex items-center gap-3"><button onClick={()=>setMobileOpen(true)} className="rounded border border-[#29343a] px-2 py-1 lg:hidden">☰</button><span className="text-sm font-medium">{title}</span></div><div className="flex items-center gap-3"><span className="hidden text-xs text-[#65737a] sm:block">Paper Balance</span><span className="num text-sm font-semibold">$12,180.42</span><WalletMultiButton /></div></header>
      <main className="mx-auto max-w-[1500px] p-4 md:p-6">
        {view==="live"&&<LiveDemo settings={settings}/>}
        {view==="dashboard"&&<Dashboard onView={go}/>}
        {view==="wallets"&&<Wallets data={wallets} setData={setWallets} selected={selected} setSelected={setSelected}/>}
        {view==="favorites"&&<Favorites items={favorites} setItems={setFavorites}/>}
        {view==="settings"&&<Settings settings={settings} setSettings={setSettings}/>}
        {view==="paper"&&<Paper/>}
        {view==="history"&&<History/>}
      </main>
    </div>
  </div>;
}
