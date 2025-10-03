#!/bin/bash

# Credits API 測試腳本
# 用於測試外部服務增加點數的 API

API_KEY="sk_live_81de5b1388d556d6e6e86a96d6bf412b554d0cd2a1a96028bed2064c1b23ffff"
BASE_URL="http://localhost:5000"

echo "========================================"
echo "Credits API 測試腳本"
echo "========================================"
echo ""

# 測試 1: 缺少 API Key
echo "測試 1: 缺少 API Key"
curl -X POST "$BASE_URL/api/account-center/credits/test@example.com/add" \
  -H "Content-Type: application/json" \
  -d '{"amount": 50, "reason": "測試", "service": "fabe"}' \
  -s | python3 -m json.tool
echo ""
echo ""

# 測試 2: 錯誤的 API Key
echo "測試 2: 錯誤的 API Key"
curl -X POST "$BASE_URL/api/account-center/credits/test@example.com/add" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: wrong_key_12345" \
  -d '{"amount": 50, "reason": "測試", "service": "fabe"}' \
  -s | python3 -m json.tool
echo ""
echo ""

# 測試 3: 正確的 API Key + 用戶不存在
echo "測試 3: 正確的 API Key + 用戶不存在"
curl -X POST "$BASE_URL/api/account-center/credits/nonexistent@example.com/add" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"amount": 50, "reason": "測試", "service": "fabe"}' \
  -s | python3 -m json.tool
echo ""
echo ""

# 測試 4: 無效的金額
echo "測試 4: 無效的金額 (負數)"
curl -X POST "$BASE_URL/api/account-center/credits/test@example.com/add" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"amount": -10, "reason": "測試", "service": "fabe"}' \
  -s | python3 -m json.tool
echo ""
echo ""

# 測試 5: 缺少 service 參數
echo "測試 5: 缺少 service 參數"
curl -X POST "$BASE_URL/api/account-center/credits/test@example.com/add" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"amount": 50, "reason": "測試"}' \
  -s | python3 -m json.tool
echo ""
echo ""

echo "========================================"
echo "測試完成"
echo "========================================"
echo ""
echo "注意：要讓 API 正常工作，需要："
echo "1. 在 Replit Secrets 中設置 SERVICE_API_KEY"
echo "2. 重啟服務器讓環境變數生效"
echo "3. 使用真實用戶的 email 或 userId 進行測試"
