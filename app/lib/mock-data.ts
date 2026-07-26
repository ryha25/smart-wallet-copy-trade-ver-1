import type { CopySettings, FavoriteToken, Position, Trade, Wallet } from "./types";

export const wallets: Wallet[] = [
  { id:"w1", name:"Delta Harvester", address:"7xKXtg2CW8...m3YqA9", roi30d:184.2, realizedProfitUsd:48210, unrealizedProfitUsd:3850, winRate:78.4, trades30d:67, avgHold:"3時間 24分", maxDrawdown:-11.8, ageDays:418, score:94, copying:true, consistency:91, favoriteSymbols:["BONK","WIF"] },
  { id:"w2", name:"Quiet Compounder", address:"F3tR9vLq1P...k7NwB2", roi30d:126.8, realizedProfitUsd:31740, unrealizedProfitUsd:1240, winRate:71.2, trades30d:54, avgHold:"8時間 12分", maxDrawdown:-8.6, ageDays:302, score:89, copying:true, consistency:94, favoriteSymbols:["JUP"] },
  { id:"w3", name:"Wave Rider", address:"9kT2pLm8Za...q4HxC1", roi30d:98.4, realizedProfitUsd:22680, unrealizedProfitUsd:-420, winRate:68.9, trades30d:83, avgHold:"1時間 48分", maxDrawdown:-16.2, ageDays:221, score:84, copying:false, consistency:82, favoriteSymbols:["WIF","POPCAT"] },
  { id:"w4", name:"Long Arc", address:"C5nV7yQm2E...r8JsD4", roi30d:76.3, realizedProfitUsd:15920, unrealizedProfitUsd:730, winRate:65.7, trades30d:41, avgHold:"14時間 06分", maxDrawdown:-7.9, ageDays:614, score:81, copying:true, consistency:88, favoriteSymbols:["BONK"] },
  { id:"w5", name:"Microcap Scout", address:"Bm2Q8sYw6K...u1FaP5", roi30d:64.7, realizedProfitUsd:9840, unrealizedProfitUsd:910, winRate:62.5, trades30d:32, avgHold:"42分", maxDrawdown:-18.4, ageDays:143, score:73, copying:false, consistency:72, favoriteSymbols:["POPCAT"] },
];

export const positions: Position[] = [
  { id:"p1", symbol:"WIF", name:"dogwifhat", source:"Delta Harvester", entry:2.184, current:2.469, amountUsd:250, openedAt:"2時間 18分", pnlPct:13.05, pnlUsd:32.63 },
  { id:"p2", symbol:"BONK", name:"Bonk", source:"Long Arc", entry:0.0000214, current:0.0000228, amountUsd:250, openedAt:"5時間 42分", pnlPct:6.54, pnlUsd:16.36 },
  { id:"p3", symbol:"JUP", name:"Jupiter", source:"Quiet Compounder", entry:0.861, current:0.842, amountUsd:250, openedAt:"1日 3時間", pnlPct:-2.21, pnlUsd:-5.52 },
];

export const trades: Trade[] = [
  { id:"t1", at:"今日 14:32", side:"買い", symbol:"WIF", wallet:"Delta Harvester", buyPrice:2.184, status:"保有中" },
  { id:"t2", at:"今日 12:08", side:"売り", symbol:"BONK", wallet:"Delta Harvester", buyPrice:0.0000192, sellPrice:0.0000231, pnlPct:20.31, pnlUsd:50.78, status:"決済済み", reason:"コピー元が売却" },
  { id:"t3", at:"今日 10:41", side:"見送り", symbol:"POPCAT", wallet:"Wave Rider", status:"見送り", reason:"価格上昇済み（+8.4%）" },
  { id:"t4", at:"昨日 23:19", side:"売り", symbol:"JUP", wallet:"Quiet Compounder", buyPrice:0.811, sellPrice:0.902, pnlPct:11.22, pnlUsd:28.05, status:"決済済み", reason:"利確" },
  { id:"t5", at:"昨日 19:54", side:"見送り", symbol:"MEW", wallet:"Microcap Scout", status:"見送り", reason:"流動性不足" },
  { id:"t6", at:"昨日 17:12", side:"売り", symbol:"WEN", wallet:"Long Arc", buyPrice:0.000102, sellPrice:0.000095, pnlPct:-6.86, pnlUsd:-17.15, status:"決済済み", reason:"損切り" },
];

export const favorites: FavoriteToken[] = [
  { id:"f1", name:"Bonk", symbol:"BONK", mint:"DezXAZ8z7P...B263", icon:"B", createdAt:"2026/07/18", wallets:["Delta Harvester","Long Arc"] },
  { id:"f2", name:"dogwifhat", symbol:"WIF", mint:"EKpQGSJtjM...zcjm", icon:"W", createdAt:"2026/07/20", wallets:["Delta Harvester","Wave Rider"] },
  { id:"f3", name:"Jupiter", symbol:"JUP", mint:"JUPyiwrYJF...ZNs", icon:"J", createdAt:"2026/07/21", wallets:["Quiet Compounder"] },
];

export const defaultSettings: CopySettings = {
  enabled:true, amountPerTrade:250, maxPositions:8, maxDailyAmount:1500, stopLoss:8,
  takeProfit:20, maxSlippage:2, maxWallets:5, allowDuplicate:false, favoritesOnly:false,
  minLiquidity:100000, minMarketCap:1000000, maxDetectionSeconds:20, maxPriceRise:5,
};

export const equityCurve = [10000,10140,10090,10310,10480,10420,10790,10950,11120,11060,11420,11680,11940,12180];
