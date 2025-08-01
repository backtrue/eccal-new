#!/bin/bash
# 自動備份版本的 db:push
echo "🛡️ 執行安全版本的資料庫推送..."
node auto-backup-on-schema-change.js
npx drizzle-kit push
