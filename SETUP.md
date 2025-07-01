# セットアップ手順

## 方法1: PowerShellを使用（推奨）
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\setup.ps1
```

## 方法2: 手動セットアップ
```cmd
# 1. Node.js依存関係をインストール
npm install

# 2. Python依存関係をインストール
cd backend
pip install -r requirements.txt
cd ..

# 3. アプリを起動
npm start
```

## 方法3: コマンドプロンプト
```cmd
# CMD版を使用
setup.bat
```

## トラブルシューティング

### 文字化けする場合
PowerShellまたは手動セットアップを使用してください。

### PowerShellスクリプトが実行できない場合
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Pythonが見つからない場合
- Python 3.7以上がインストールされているか確認
- パスが通っているか確認

### npmが見つからない場合
- Node.js（v16以上）がインストールされているか確認