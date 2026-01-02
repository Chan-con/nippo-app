# 日報管理アプリ (Electron版)

モダンなデザインの日報管理アプリケーションです。Electronを使用してデスクトップアプリとして動作します。

## 📥 ダウンロード

**アプリをすぐに使いたい方は、以下からダウンロードできます：**

**[📂 Releases ページからダウンロード](https://github.com/Chan-con/nippo-app/releases)**

- **Windows**: `.exe` ファイル（インストーラー版）または `.zip` ファイル（ポータブル版）
- **macOS**: `.dmg` ファイル  
- **Linux**: `.AppImage` ファイル

> **💡 ヒント**: 最新版は [Releases ページ](https://github.com/Chan-con/nippo-app/releases) の一番上にあります。

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

このリポジトリは元々Electronアプリですが、Webとして動かすための最小構成も同梱しています。

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
npm run web:start
```

ブラウザで `http://localhost:3000` を開き、上部の「Googleでログイン」からログインしてください。

## 🔐 データの保存と分離

Web版では、Supabase Auth のユーザーID（`auth.uid()`）をキーにデータを保存します。

- DB: `nippo_docs (user_id, doc_type, doc_key, content)`
- RLS: `auth.uid() = user_id` のみ操作可能

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
npm start
```

### アプリケーションのビルド
各種OS向けのインストーラーをビルドします。

#### Windows
```bash
npm run package:win
```

#### macOS
```bash
npm run package:mac
```

#### Linux
```bash
npm run package:linux
```

ビルド後のファイルは `dist/` フォルダに生成されます。

## 📁 プロジェクト構造

```
nippo/
├── main.js              # Electronメインプロセス
├── preload.js           # プリロードスクリプト
├── package.json         # Node.js設定
├── renderer/            # フロントエンド
│   ├── index.html       # メインHTML
│   ├── styles.css       # スタイルシート
│   └── app.js           # フロントエンドロジック
├── backend/             # バックエンド
│   └── task-manager.js  # タスク管理ロジック
└── dist/                # ビルド出力
```

## 🔧 技術スタック

- **フロントエンド**: HTML5, CSS3, JavaScript (ES6+)
- **デスクトップ**: Electron
- **UI/UX**: Material Icons, Inter Font
- **テーマ**: Catppuccin Mocha

## 📄 ライセンス

このプロジェクトはMITライセンスの下で公開されています。
