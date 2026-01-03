# 日報管理アプリ (Web版)

モダンなデザインの日報管理アプリケーションです。Cloudflare Pages + Functions と Supabase（Googleログイン）で動作します。

## 🚀 特徴

- **モダンなUI**: Catppuccin Mochaテーマを使用したダークモード
- **リアルタイム更新**: タスクの追加・終了が即座に反映
- **タイムライン表示**: 作業時間の可視化
- **統計情報**: 完了タスク数、作業時間、生産性の表示
- **クリップボード連携**: タイムラインのコピー機能
- **タスクストック機能**: よく使うタスクを保存・管理
- **報告書作成**: タブ別報告書の作成と管理
- **システムトレイ**: バックグラウンドでの動作をサポート

## 🛠️ 開発者向けセットアップ

> **注意**: 以下は開発者やアプリをカスタマイズしたい方向けの情報です。  
> **単純にアプリを使いたいだけの場合は、上記の「ダウンロード」セクションからインストーラーをダウンロードしてください。**

### 前提条件
- Node.js (v16以上)
- npm または yarn

### インストール手順
```bash
# 依存関係をインストール
npm install
```

## 🌐 Web版（Supabase + Googleログイン）

このリポジトリはWebアプリとして動作します。

### 1) Supabase側の準備

1. Supabaseで新規プロジェクトを作成
2. SQL Editorで [supabase/schema.sql](supabase/schema.sql) を実行（`nippo_docs`テーブル + RLS）
3. Authentication → Providers → Google を有効化
4. Authentication → URL Configuration の Redirect URLs に以下を追加
	- 開発: `http://localhost:3000/`

### 2) 環境変数

`.env.example` をコピーして `.env` を作成し、値を設定します。

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`（ブラウザへ公開してOK）
- `SUPABASE_SERVICE_ROLE_KEY`（サーバー専用。絶対にクライアントへ出さない）

### 3) 起動

```bash
npm install
npm start
```

ブラウザで `http://localhost:3000` を開き、上部の「Googleでログイン」からログインしてください。

## ☁️ Cloudflare Pages 対応

Cloudflare Pagesでは、静的ファイル配信 + Pages Functionsで `/api/*` を提供します。

### デプロイ設定（Pages）

- **Framework preset**: None
- **Build command**: `npm run pages:build`
- **Build output directory**: `out`
- **Functions directory**: `functions`

> 補足: Next.js の静的エクスポート（`out/`）では `app/api/*` の Route Handler は利用できません。
> 本番の `/api/*` は Cloudflare Pages Functions（`functions/`）で提供します。

### Pagesの環境変数

Pagesプロジェクトの Settings → Environment variables に以下を設定します。

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`（サーバー専用。絶対にクライアントへ出さない）

### SupabaseのRedirect URL

Authentication → URL Configuration の Redirect URLs に、PagesのURLを追加してください。

- 例: `https://<your-project>.pages.dev/`

## 🔐 データの保存と分離

Web版では、Supabase Auth のユーザーID（`auth.uid()`）をキーにデータを保存します。

- DB: `nippo_docs (user_id, doc_type, doc_key, content)`
- RLS: `auth.uid() = user_id` のみ操作可能

## 🔄 他端末へ即時反映（リアルタイム同期）

同じアカウントでログインしている別端末（例: スマホ→PC）に、更新内容を「即時に」反映させたい場合は Supabase Realtime を有効化してください。

### 1) Supabase Realtime を有効化

Supabase Dashboard で **Database → Replication**（または Realtime/Replication 設定）を開き、テーブル `nippo_docs` を有効化します。

SQLで有効化する場合の例:

```sql
alter publication supabase_realtime add table public.nippo_docs;
```

### 2) ポリシー（RLS）

Realtimeで受信するためにも、`nippo_docs` に対する `SELECT` を含むRLSポリシーが必要です（本リポジトリの [supabase/schema.sql](supabase/schema.sql) に含まれます）。

> Realtimeを有効化しない場合でもアプリは動作しますが、他端末への反映は手動リロードになります。

## 🏃‍♂️ 使用方法

### 基本機能

#### タスク管理
1. **タスク追加**: サイドバーの入力フィールドにタスク名を入力してEnterキーまたは「+」ボタンをクリック
2. **タスク終了**: 「タスク終了」ボタンで現在のタスクを完了
3. **休憩機能**: 「休憩開始」ボタンで休憩時間を記録
4. **タスク編集**: タイムラインの編集ボタンでタスクの名前や時間を変更

#### タスクストック機能 ✨NEW
1. **タスクストック管理**: 「タスクストック」ボタンでよく使うタスクを保存
2. **ワンクリック入力**: 保存されたタスクをクリックすると入力フィールドに自動入力
3. **タスク管理**: 不要なタスクは削除ボタンで個別削除、または一括クリア

#### 報告書作成
1. **報告書作成**: 「報告書作成」ボタンで今日の作業内容を自動生成
2. **タブ別管理**: 複数の報告先に対応したタブ形式
3. **コピー機能**: タイムラインや報告内容をクリップボードにコピー

### 開発環境で実行
```bash
npm run dev
```

## 📁 プロジェクト構造

```
nippo/
├── package.json         # Node.js設定
├── renderer/            # フロントエンド
│   ├── index.html       # メインHTML
│   ├── styles.css       # スタイルシート
│   └── app.js           # フロントエンドロジック
├── backend/             # バックエンド
│   └── task-manager.js  # タスク管理ロジック
└── functions/            # Cloudflare Pages Functions
```

## 🔧 技術スタック

- **フロントエンド**: HTML5, CSS3, JavaScript (ES6+)
- **ホスティング**: Cloudflare Pages + Functions
- **UI/UX**: Material Icons, Inter Font
- **テーマ**: Catppuccin Mocha

## 📄 ライセンス

このプロジェクトはMITライセンスの下で公開されています。
