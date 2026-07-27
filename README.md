# NEXT-TRADE — Smart Wallet Copy Trade MVP

## Replitで起動・デプロイ

1. GitHubリポジトリをReplitへインポートします。
2. ReplitのSecretsに必要なAPIキーとログイン設定を登録します。
3. Runボタンを押すと、NEXT-TRADEがポート8080で起動します。
4. PublishingからAutoscale Deploymentを選び、Publishします。

Replitでは `.replit` の設定により、開発時は `replit:dev`、公開時は
`replit:build` と `replit:start` が自動実行されます。サーバーは
`0.0.0.0:8080` で待ち受けます。

ログインには次のSecretsが必須です。

- `APP_USERNAME`: ログイン画面のユーザー名
- `APP_PASSCODE`: 6文字のパスコード
- `SESSION_SECRET`: 十分に長いランダム文字列

実データ取得には最低限 `HELIUS_API_KEY` を推奨します。詳細なStackTraceを
Previewで確認する場合だけ `DEBUG_ERRORS=true` を設定してください。本番公開時は
`DEBUG_ERRORS=false` に戻してください。

Solana上の実在ウォレットと実市場データを分析し、コピー取引を仮想資金で検証する日本語Webアプリです。実資金の注文は送信しません。

## 実装済み機能

- 手動コピー元ウォレットを最大10件登録
- Jupiterの直近実取引から優秀ウォレット候補を抽出し、自動枠へ最大5件採用
- 30日ROI、確定利益、勝率、売買回数、ウォレット経過日数、最大ドローダウン、利益継続性を実履歴から集計
- 登録ウォレットを15秒間隔で監視
- 新規購入検知時にJupiterの実見積もりを確認し、仮想資金でペーパートレード
- コピー元売却、利確、損切り、手動決済
- 見送った実シグナルと理由を端末内に保存
- CAだけでお気に入りコインを登録し、名称・シンボル・価格・流動性・時価総額を自動取得
- お気に入りコインを開くと、そのCAで確定利益がある実ウォレットを最大5件表示
- お気に入り候補を手動コピー元へ登録
- CAを1タップでコピー
- RugCheck、Mint権限、Freeze権限による危険トークン除外
- 開発者権限との一致、高頻度BOT、異常勝率、利益集中などの疑わしいウォレットを除外
- Solana Wallet Adapterによるユーザーウォレット接続
- PC・スマートフォン対応のダークテーマ

架空ウォレット、架空売買、架空収益のシードデータはありません。初回表示は空で、実APIから取得したデータだけが追加されます。仮想なのはペーパートレードの開始残高と取引資金だけです。

## データソース

- Helius: ウォレット履歴、初回取引日、Jupiter・Raydium・Orca・Meteora・Pump.fun・PumpSwapの取引候補
- Birdeye: SOLの過去価格
- Jupiter: ペーパートレード時点の交換経路と見積もり
- DEX Screener: トークン情報、現在価格、流動性、時価総額
- RugCheck: ラグプル関連リスク
- Solana RPC: Mint権限、Freeze権限

## 起動方法

Node.js 22.13以降が必要です。

```bash
npm install
cp .env.example .env.local
npm run dev
```

画面に表示されたローカルURLをブラウザで開いてください。

## 環境変数

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/smart_wallet?schema=public"
NEXT_PUBLIC_SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
HELIUS_API_KEY=""
BIRDEYE_API_KEY=""
JUPITER_API_KEY=""
```

`HELIUS_API_KEY`、`BIRDEYE_API_KEY`、`JUPITER_API_KEY`を設定してください。`.env.local`はGit管理対象外です。秘密鍵やシードフレーズは設定しないでください。

## データベース

Prismaスキーマと初期マイグレーションを含みます。

```bash
npx prisma generate
npx prisma migrate dev
```

架空データを防ぐため、`npm run db:seed`はサンプルウォレットを投入しません。

## スキャン範囲と注意

自動スキャンはJupiter・Raydium・Orca・Meteora・Pump.fun・PumpSwapの各直近最大100件からウォレットを抽出し、重複除外後の最大60ウォレットを30日履歴で評価します。画面にはランキング上位10件を表示し、上位5件だけをコピーOFFの採用候補として手動追加できます。Solanaチェーン全履歴を常時完全走査するものではありません。

解析量は `WALLET_SCAN_DISCOVERY_PER_DEX`（40〜100）、`WALLET_SCAN_ANALYSIS_LIMIT`（20〜100）、`WALLET_SCAN_CONCURRENCY`（1〜10）で調整できます。値を増やすとHeliusの使用クレジットと処理時間も増えます。

危険判定はリスク低減のためのフィルターであり、安全性や将来利益を保証しません。RugCheckの判定を取得できない場合も安全扱いせず、コピーを見送ります。

## 検証

```bash
npm run typecheck
npm test
npm run build
```
