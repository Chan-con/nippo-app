#!/bin/bash

echo "日報管理アプリのセットアップを開始しています..."

echo ""
echo "1. Node.js依存関係をインストール中..."
npm install

echo ""
echo "2. Python依存関係をインストール中..."
cd backend
pip install -r requirements.txt
cd ..

echo ""
echo "セットアップが完了しました！"
echo ""
echo "アプリを起動するには:"
echo "  npm start"
echo ""
echo "ビルドするには:"
echo "  npm run build"
echo ""