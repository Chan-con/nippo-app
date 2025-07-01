# 日報管理アプリ (Electron版)

モダンなデザインの日報管理アプリケーションです。Electronを使用してデスクトップアプリとして動作します。

## 🚀 特徴

- **モダンなUI**: Catppuccin Mochaテーマを使用したダークモード
- **リアルタイム更新**: タスクの追加・終了が即座に反映
- **タイムライン表示**: 作業時間の可視化
- **統計情報**: 完了タスク数、作業時間、生産性の表示
- **クリップボード連携**: タイムラインのコピー機能

## 🛠️ セットアップ

### 前提条件
- Node.js (v16以上)
- npm または yarn

### インストール手順
```bash
# 依存関係をインストール
npm install
```

## 🏃‍♂️ 使用方法

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
