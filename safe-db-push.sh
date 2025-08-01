#!/bin/bash

# 安全的資料庫推送腳本 - 自動檢測 schema 變更並備份

echo "🛡️ 安全資料庫推送程序啟動..."

# 檢查 schema 變更並備份
echo "🔍 檢查是否需要備份..."
node auto-backup-on-schema-change.js

# 執行 drizzle push
echo "🚀 執行資料庫推送..."
npm run db:push-original

echo "✅ 安全推送完成"