# 日報管理アプリ (Electron版)

モダンなデザインの日報管理アプリケーションです。Electronを使用してデスクトップアプリとして動作し、Pythonバックエンドで元のCLI機能を再現しています。

## 🚀 特徴

- **モダンなUI**: Catppuccin Mochaテーマを使用したダークモード
- **リアルタイム更新**: タスクの追加・終了が即座に反映
- **タイムライン表示**: 作業時間の可視化
- **統計情報**: 完了タスク数、作業時間、生産性の表示
- **クリップボード連携**: タイムラインのコピー機能

## 📋 既存機能の対応

### CLI版の主要コマンド
- `a` (タスク追加) → **✅ 実装済み**
- `e` (タスク終了) → **✅ 実装済み**  
- `cpt` (タイムラインコピー) → **✅ 実装済み**

## 🛠️ セットアップ

### 前提条件
- Node.js (v16以上)
- Python 3.7以上
- npm または yarn

### インストール手順

1. **自動セットアップ (推奨)**
   ```bash
   # Windows
   setup.bat
   
   # Linux/Mac
   ./setup.sh
   ```

2. **手動セットアップ**
   ```bash
   # Node.js依存関係をインストール
   npm install
   
   # Python依存関係をインストール  
   cd backend
   pip install -r requirements.txt
   cd ..
   ```

## 🏃‍♂️ 使用方法

### 開発環境で実行
```bash
npm start
```

### 本番ビルド
```bash
npm run build
```

ビルド後のファイルは `dist/` フォルダに生成されます。

### 開発モード（ホットリロード）
```bash
npm run dev
```

## 🎯 主な機能

### 1. タスク管理
- **タスク追加**: 上部の入力欄からタスクを追加
- **タスク終了**: サイドバーの「タスク終了」ボタン
- **現在のタスク表示**: ヘッダーに実行中のタスクを表示

### 2. データ管理
- **データ保存**: `datas/data.txt`に自動保存
- **フォーマット互換**: 既存のCLI版と同じデータ形式
- **バックアップ**: 元のデータファイルをそのまま使用可能

### 3. UI機能
- **タイムライン表示**: 今日の作業履歴を時系列で表示
- **統計ダッシュボード**: 作業効率の可視化
- **レスポンシブデザイン**: 様々な画面サイズに対応

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
├── backend/             # Pythonバックエンド
│   ├── api.py           # Flask API
│   └── requirements.txt # Python依存関係
├── datas/               # データファイル
│   └── data.txt         # タスクデータ
└── dist/                # ビルド出力
```

## 🔧 技術スタック

- **フロントエンド**: HTML5, CSS3, JavaScript (ES6+)
- **デスクトップ**: Electron
- **バックエンド**: Python Flask
- **通信**: REST API (JSON)
- **UI/UX**: Material Icons, Inter Font
- **テーマ**: Catppuccin Mocha

## 🎨 カスタマイズ

### テーマカラーの変更
`renderer/styles.css`の`:root`セクションで色を変更できます：

```css
:root {
  --bg-primary: #1e1e2e;    /* メインの背景色 */
  --accent: #89b4fa;        /* アクセントカラー */
  --text-primary: #cdd6f4;  /* メインテキスト色 */
}
```

### 機能の追加
1. `backend/api.py`にAPIエンドポイントを追加
2. `preload.js`にIPC通信を追加
3. `renderer/app.js`にフロントエンド機能を実装

## 🐛 トラブルシューティング

### よくある問題

1. **Pythonプロセスが起動しない**
   - Python3がインストールされているか確認
   - `pip install -r backend/requirements.txt`を実行

2. **ポート5000が使用中**
   - `backend/api.py`のポート番号を変更
   - `main.js`の対応するURLも変更

3. **データが保存されない**
   - `datas/`フォルダが存在するか確認
   - 書き込み権限があるか確認

## 📝 今後の機能予定

- [ ] 週報・月報機能
- [ ] カレンダー統合
- [ ] エクスポート機能 (PDF, Excel)
- [ ] 通知機能
- [ ] 複数プロジェクト対応
- [ ] クラウド同期

## 🤝 コントリビューション

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add some amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## 📄 ライセンス

このプロジェクトはMITライセンスの下で公開されています。