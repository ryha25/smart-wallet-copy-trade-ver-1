# Smart Wallet Copy Trade — MVP

Solana上の高収益ウォレットを分析し、対象を選択してコピー戦略をペーパートレードで検証する日本語Webアプリです。実資金を動かす処理、秘密鍵・シードフレーズの保存処理は含みません。

## 実装済み

- 運用ダッシュボード（残高、損益、勝率、保有、直近取引）
- 優秀ウォレットランキングと100点評価、コピーON/OFF
- ウォレット詳細（確定・未確定損益、評価内訳、推移、履歴）
- お気に入りコイン登録・削除と関連ウォレット表示
- コピー条件・資金管理・決済設定（ブラウザ保存）
- ペーパーポジションと手動決済
- 約定・決済・見送りを含む取引履歴
- モックデータモード
- PostgreSQL用Prismaスキーマ、初期マイグレーション、シード
- Helius / Birdeye / Jupiter接続を差し替えるサービス境界
- Solana Wallet Adapterプロバイダー（閲覧アドレス接続用）

## 必要環境

- Node.js 22.13以上
- PostgreSQL 15以上（DB機能を使う場合のみ）
- npm または pnpm

## 起動

```bash
cp .env.example .env
npm install
npm run dev
```

表示されたローカルURLをブラウザで開いてください。`NEXT_PUBLIC_MOCK_MODE=true` のままなら、PostgreSQLや外部APIキーなしで全画面を操作できます。

## データベース

PostgreSQLを起動し、`.env` の `DATABASE_URL` を設定した後に実行します。

```bash
npx prisma generate
npx prisma migrate dev
npm run db:seed
```

主なテーブルは `users`、`tracked_wallets`、`wallet_statistics`、`wallet_scores`、`wallet_trades`、`wallet_holdings`、`favorite_tokens`、`favorite_token_wallets`、`copy_settings`、`paper_positions`、`paper_trades`、`skipped_trades`、`token_risk_checks`、`system_logs` です。金額・損益はUSD建てとSOL建てを保持できます。

## 環境変数

| 変数 | 必須 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | DB利用時 | PostgreSQL接続文字列 |
| `NEXT_PUBLIC_MOCK_MODE` | いいえ | `true`でモックデータを使用 |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | いいえ | Solana RPC |
| `HELIUS_API_KEY` | 実データ接続時 | ウォレット取引解析 |
| `BIRDEYE_API_KEY` | 実データ接続時 | 価格・流動性・時価総額 |
| `JUPITER_API_KEY` | 将来 | 見積・実売買連携 |

## 安全性

このバージョンはペーパートレード専用です。実売買へ移行する際も秘密鍵をDBへ保存せず、ユーザー署名または専用の安全な署名基盤を別モジュールとして追加してください。
