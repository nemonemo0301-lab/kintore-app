# 筋トレ記録 LINE Bot

LINEで「ベンチ60kg×8回」と送ると記録してくれるBotです。Cloudflare Workers（無料枠）で動き、記録は Cloudflare D1 に保存されます。
入力の読み取りはWebアプリと同じ `../parser.js` を使っています。

## できること

| 送る言葉 | 動き |
| --- | --- |
| `ベンチ60kg×8回` / `スクワット 80 5 3セット` / `懸垂 10回 3セット` | 記録して推定1RMを返信。自己ベスト更新なら🎉 |
| 改行で複数行 | まとめて記録 |
| `今日` | 今日の記録と総挙上量 |
| `履歴` | 最近15件 |
| `ベスト` | 種目ごとの自己ベスト |
| `取り消し` | 直前の記録を削除 |
| `ヘルプ` | 使い方 |

返信の下にボタン（今日・履歴・ベスト…）が出るので、タップだけでも操作できます。記録はLINEユーザーごとに分かれていて、他の人からは見えません。

## セットアップ（PCで30分くらい）

必要なもの: Node.js 20以上、Cloudflareアカウント（無料）、LINEアカウント

### 1. LINE側でチャネルを作る

1. [LINE Developers](https://developers.line.biz/console/) にLINEアカウントでログイン
2. プロバイダーを作成 → 「Messaging API」チャネルを作成（LINE公式アカウントの作成画面に案内された場合はそこから作成し、公式アカウントの設定で Messaging API を有効化）
3. 次の2つを控える
   - 「チャネル基本設定」タブ → **チャネルシークレット**
   - 「Messaging API設定」タブ → **チャネルアクセストークン（長期）**の「発行」
4. [LINE Official Account Manager](https://manager.line.biz/) の「応答設定」で
   - **応答メッセージ: オフ**（自動の定型文を止める）
   - **Webhook: オン**

### 2. Cloudflareにデプロイ

```sh
cd line-bot
npm install
npx wrangler login                      # ブラウザでCloudflareにログイン
npx wrangler d1 create kintore          # 出力された database_id を wrangler.toml に貼る
npm run db:init                         # テーブル作成
npx wrangler secret put LINE_CHANNEL_SECRET        # チャネルシークレットを貼る
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN  # アクセストークンを貼る
npm run deploy
```

最後に `https://kintore-line-bot.<あなたのサブドメイン>.workers.dev` のようなURLが表示されます。

### 3. WebhookのURLを登録

1. LINE Developers の「Messaging API設定」→ **Webhook URL** に
   `https://kintore-line-bot.<サブドメイン>.workers.dev/webhook` を入力（末尾の `/webhook` を忘れずに）
2. 「検証」ボタン → 成功と出ればOK
3. **Webhookの利用** をオン
4. 同じ画面のQRコードで友だち追加 → 「ベンチ60kg×8回」と送ってみる

## 困ったとき

- **返事がない**: `npx wrangler tail` でログを見ながらメッセージを送る
  - `LINE reply failed 401` → アクセストークンが違う。`wrangler secret put` し直す
  - 何も出ない → Webhook URL か「Webhookの利用」設定を確認
  - `no such table` → `npm run db:init` を実行
- **定型文が返ってくる**: 公式アカウントの「応答メッセージ」をオフにする
- **Webhookの検証で401**: チャネルシークレットが違う

## 開発

```sh
npm test   # Botのロジックと署名チェックのテスト（ネット接続不要）
```

- `src/index.js` … Webhookの受け口、署名チェック、LINEへの返信
- `src/bot.js` … 受け取った文章に対する処理（記録・集計）
- `schema.sql` … テーブル定義。項目はWebアプリの書き出しJSONと同じ形
