# Eccal 折扣券系統實作指南

## 概述
本文件描述如何在 eccal 系統中實作完整的折扣券功能，包括前端 UI、後端 API、資料庫結構及 Stripe 整合。

## 資料庫架構

### 1. 折扣碼表 (discount_codes)
```sql
CREATE TABLE discount_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'ALL',
  usage_limit INTEGER,
  used_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  valid_from TIMESTAMP,
  valid_until TIMESTAMP,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2. 折扣碼使用記錄表 (discount_usages)
```sql
CREATE TABLE discount_usages (
  id SERIAL PRIMARY KEY,
  discount_code_id INTEGER REFERENCES discount_codes(id),
  user_id VARCHAR(255),
  original_amount DECIMAL(10,2) NOT NULL,
  discount_amount DECIMAL(10,2) NOT NULL,
  final_amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 後端 API 實作

### 1. 折扣碼驗證 API
```javascript
// POST /api/discount-codes/validate
app.post('/api/discount-codes/validate', async (req, res) => {
  try {
    const { code, originalAmount, currency = 'TWD' } = req.body;
    
    if (!code || !originalAmount) {
      return res.status(400).json({ message: "缺少必要參數" });
    }

    const discountCode = await storage.getDiscountCodeByCode(code.toUpperCase());
    
    if (!discountCode) {
      return res.status(404).json({ message: "折扣碼不存在" });
    }

    // 檢查是否啟用
    if (!discountCode.isActive) {
      return res.status(400).json({ message: "折扣碼已停用" });
    }

    // 檢查有效期限
    const now = new Date();
    if (discountCode.validFrom && now < new Date(discountCode.validFrom)) {
      return res.status(400).json({ message: "折扣碼尚未生效" });
    }
    if (discountCode.validUntil && now > new Date(discountCode.validUntil)) {
      return res.status(400).json({ message: "折扣碼已過期" });
    }

    // 檢查使用限制
    if (discountCode.usageLimit && discountCode.usedCount >= discountCode.usageLimit) {
      return res.status(400).json({ message: "折扣碼使用次數已達上限" });
    }

    // 檢查幣別限制
    if (discountCode.currency !== 'ALL' && discountCode.currency !== currency) {
      return res.status(400).json({ message: `此折扣碼僅適用於 ${discountCode.currency}` });
    }

    // 計算折扣
    let discountAmount = 0;
    if (discountCode.discountType === 'percentage') {
      discountAmount = Math.round((originalAmount * parseFloat(discountCode.discountValue)) / 100);
    } else if (discountCode.discountType === 'fixed') {
      discountAmount = parseFloat(discountCode.discountValue) * (currency === 'JPY' ? 1 : 100);
    }

    const finalAmount = Math.max(0, originalAmount - discountAmount);

    res.json({
      valid: true,
      discountCode: {
        id: discountCode.id,
        code: discountCode.code,
        discountType: discountCode.discountType,
        discountValue: discountCode.discountValue
      },
      originalAmount,
      discountAmount,
      finalAmount,
      currency
    });
  } catch (error) {
    console.error('Error validating discount code:', error);
    res.status(500).json({ message: "驗證折扣碼時發生錯誤" });
  }
});
```

### 2. 管理員創建折扣碼 API
```javascript
// POST /api/admin/discount-codes
app.post('/api/admin/discount-codes', adminAuth, async (req, res) => {
  try {
    const codeData = {
      code: req.body.code.toUpperCase(),
      discountType: req.body.discountType,
      discountValue: req.body.discountValue,
      currency: req.body.currency || 'ALL',
      isActive: req.body.isActive !== undefined ? req.body.isActive : true
    };

    // 處理可選欄位
    if (req.body.usageLimit) {
      codeData.usageLimit = parseInt(req.body.usageLimit);
    }
    if (req.body.validFrom) {
      codeData.validFrom = new Date(req.body.validFrom);
    }
    if (req.body.validUntil) {
      codeData.validUntil = new Date(req.body.validUntil);
    }
    if (req.body.description) {
      codeData.description = req.body.description;
    }

    const discountCode = await storage.createDiscountCode(codeData);
    res.json(discountCode);
  } catch (error) {
    console.error('Error creating discount code:', error);
    res.status(500).json({ message: "創建折扣碼失敗: " + error.message });
  }
});
```

### 3. Stripe 付款整合
```javascript
// POST /api/create-payment-intent
app.post("/api/create-payment-intent", jwtAuth, async (req, res) => {
  try {
    const userId = req.user.claims.sub;
    const { amount, currency = 'TWD', locale = 'zh', discountCodeId } = req.body;
    
    let finalAmount = amount;
    let discountUsageData = null;
    
    // 處理折扣碼
    if (discountCodeId) {
      const discountCode = await storage.getDiscountCode(discountCodeId);
      if (discountCode && discountCode.isActive) {
        const originalAmount = finalAmount;
        let discountAmount = 0;
        
        if (discountCode.discountType === 'percentage') {
          discountAmount = Math.round((originalAmount * parseFloat(discountCode.discountValue)) / 100);
        } else if (discountCode.discountType === 'fixed') {
          discountAmount = parseFloat(discountCode.discountValue) * (currency === 'JPY' ? 1 : 100);
        }
        
        finalAmount = Math.max(0, originalAmount - discountAmount);
        
        // 準備使用記錄資料
        discountUsageData = {
          discountCodeId: discountCode.id,
          originalAmount: (currency === 'JPY' ? originalAmount.toString() : (originalAmount / 100).toString()),
          discountAmount: (currency === 'JPY' ? discountAmount.toString() : (discountAmount / 100).toString()),
          finalAmount: (currency === 'JPY' ? finalAmount.toString() : (finalAmount / 100).toString()),
          currency: currency
        };
      }
    }

    // 驗證金額
    const roundedAmount = Math.round(finalAmount);
    if (roundedAmount <= 0) {
      return res.status(400).json({ message: "折扣後金額不能為零或負數" });
    }

    // 創建 Stripe 付款意圖
    const paymentIntent = await stripe.paymentIntents.create({
      amount: roundedAmount,
      currency: currency.toLowerCase(),
      metadata: {
        userId: userId,
        originalAmount: amount.toString(),
        discountApplied: discountUsageData ? 'true' : 'false',
        discountCodeId: discountCodeId ? discountCodeId.toString() : '',
        locale: locale
      }
    });

    // 記錄購買
    const purchase = await storage.createPurchase({
      userId,
      amount: (currency === 'JPY' ? finalAmount.toString() : (finalAmount / 100).toString()),
      currency,
      paymentIntentId: paymentIntent.id,
      status: 'pending',
      discountUsageData
    });

    // 記錄折扣碼使用
    if (discountUsageData) {
      await storage.createDiscountUsage({
        discountCodeId: discountUsageData.discountCodeId,
        userId: userId,
        originalAmount: discountUsageData.originalAmount,
        discountAmount: discountUsageData.discountAmount,
        finalAmount: discountUsageData.finalAmount,
        currency: discountUsageData.currency
      });
    }

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error('Payment intent creation failed:', error);
    res.status(500).json({ message: "Error creating payment intent: " + error.message });
  }
});
```

## 前端實作

### 1. 折扣碼輸入組件
```typescript
// 檔案: components/DiscountCodeInput.tsx
import React, { useState } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X } from "lucide-react";

interface DiscountCodeInputProps {
  originalAmount: number;
  currency: string;
  onDiscountApplied: (discount: any) => void;
  onDiscountRemoved: () => void;
}

export function DiscountCodeInput({ 
  originalAmount, 
  currency, 
  onDiscountApplied, 
  onDiscountRemoved 
}: DiscountCodeInputProps) {
  const [code, setCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [appliedDiscount, setAppliedDiscount] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const validateCode = async () => {
    if (!code.trim()) return;
    
    setIsValidating(true);
    setError(null);
    
    try {
      const response = await fetch('/api/discount-codes/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          originalAmount,
          currency
        })
      });
      
      const result = await response.json();
      
      if (response.ok) {
        setAppliedDiscount(result);
        onDiscountApplied(result);
      } else {
        setError(result.message);
      }
    } catch (error) {
      setError('驗證失敗，請稍後再試');
    } finally {
      setIsValidating(false);
    }
  };

  const removeDiscount = () => {
    setAppliedDiscount(null);
    setCode('');
    setError(null);
    onDiscountRemoved();
  };

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">折扣碼</label>
      
      {appliedDiscount ? (
        <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center space-x-2">
            <Check className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-700">
              {appliedDiscount.discountCode.code} 已套用
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={removeDiscount}
            className="text-red-600 hover:text-red-800"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <div className="flex space-x-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="輸入折扣碼"
            className="flex-1"
            onKeyPress={(e) => e.key === 'Enter' && validateCode()}
          />
          <Button
            type="button"
            onClick={validateCode}
            disabled={isValidating || !code.trim()}
            variant="outline"
          >
            {isValidating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              '套用'
            )}
          </Button>
        </div>
      )}
      
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
      
      {appliedDiscount && (
        <div className="text-sm text-green-600">
          折扣 {appliedDiscount.discountCode.discountValue}
          {appliedDiscount.discountCode.discountType === 'percentage' ? '%' : ` ${currency}`}
        </div>
      )}
    </div>
  );
}
```

### 2. 結帳頁面整合
```typescript
// 在結帳頁面中的使用範例
const CheckoutPage = () => {
  const [appliedDiscount, setAppliedDiscount] = useState<any>(null);
  const originalAmount = 99900; // TWD 999.00
  
  const handleDiscountApplied = (discount: any) => {
    setAppliedDiscount(discount);
  };

  const handleDiscountRemoved = () => {
    setAppliedDiscount(null);
  };

  const finalAmount = appliedDiscount ? appliedDiscount.finalAmount : originalAmount;
  const savings = appliedDiscount ? appliedDiscount.discountAmount : 0;

  return (
    <div className="checkout-container">
      {/* 其他結帳欄位 */}
      
      <DiscountCodeInput
        originalAmount={originalAmount}
        currency="TWD"
        onDiscountApplied={handleDiscountApplied}
        onDiscountRemoved={handleDiscountRemoved}
      />
      
      {/* 價格摘要 */}
      <div className="price-summary">
        <div className="flex justify-between">
          <span>原價</span>
          <span>NT$ {(originalAmount / 100).toFixed(0)}</span>
        </div>
        
        {appliedDiscount && (
          <div className="flex justify-between text-green-600">
            <span>折扣</span>
            <span>-NT$ {(savings / 100).toFixed(0)}</span>
          </div>
        )}
        
        <div className="flex justify-between font-bold text-lg border-t pt-2">
          <span>總計</span>
          <span>NT$ {(finalAmount / 100).toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
};
```

## 資料庫操作層 (Storage)

### 折扣碼相關方法
```typescript
// 新增到 storage.ts 中的方法

async getDiscountCodeByCode(code: string) {
  const result = await this.db
    .select()
    .from(discountCodes)
    .where(eq(discountCodes.code, code))
    .limit(1);
  return result[0] || null;
}

async getDiscountCode(id: number) {
  const result = await this.db
    .select()
    .from(discountCodes)
    .where(eq(discountCodes.id, id))
    .limit(1);
  return result[0] || null;
}

async createDiscountCode(data: any) {
  const result = await this.db
    .insert(discountCodes)
    .values(data)
    .returning();
  return result[0];
}

async createDiscountUsage(data: any) {
  const result = await this.db
    .insert(discountUsages)
    .values(data)
    .returning();
  return result[0];
}

async incrementDiscountCodeUsage(discountCodeId: number) {
  await this.db
    .update(discountCodes)
    .set({ 
      usedCount: sql`${discountCodes.usedCount} + 1`,
      updatedAt: new Date()
    })
    .where(eq(discountCodes.id, discountCodeId));
}
```

## 關鍵實作要點

### 1. 錯誤處理
- 折扣碼不存在、已過期、已停用的情況
- 使用次數超限的檢查
- 幣別不符的驗證
- 金額計算的邊界情況（避免負數）

### 2. 安全考量
- 折扣碼輸入要轉大寫並去除空白
- 管理員權限驗證
- SQL 注入防護（使用 ORM 參數化查詢）
- 金額計算精度處理

### 3. 用戶體驗
- 即時驗證回饋
- 清楚的錯誤訊息
- 折扣效果即時顯示
- 一鍵移除已套用的折扣

### 4. 資料一致性
- 購買記錄與折扣使用記錄的關聯
- Stripe 付款元資料的完整記錄
- 折扣碼使用次數的準確更新

## 測試建議

### 1. 單元測試
- 折扣金額計算邏輯
- 有效期限驗證
- 使用次數限制檢查

### 2. 整合測試
- 完整的結帳流程
- Stripe 付款整合
- 資料庫交易一致性

### 3. 用戶測試案例
```javascript
// 測試用折扣碼範例
INSERT INTO discount_codes (code, discount_type, discount_value, currency, is_active, description) VALUES
('TEST10', 'percentage', '10.00', 'TWD', true, '測試用 10% 折扣'),
('SAVE50', 'fixed', '50.00', 'TWD', true, '測試用固定折扣 NT$50'),
('EXPIRED', 'percentage', '20.00', 'ALL', true, '已過期折扣碼');

-- 設定過期日期
UPDATE discount_codes SET valid_until = '2024-01-01' WHERE code = 'EXPIRED';
```

這份文件提供了完整的折扣券系統實作指南，eccal 的 agent 可以根據這些詳細步驟來實作相同的功能。