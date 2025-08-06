import { useState } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, Tag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface DiscountCodeInputProps {
  originalAmount: number; // Amount in cents
  currency: string;
  serviceName?: string;
  userEmail?: string;
  onDiscountApplied: (discount: any) => void;
  onDiscountRemoved: () => void;
}

export function DiscountCodeInput({ 
  originalAmount, 
  currency, 
  serviceName = 'eccal',
  userEmail,
  onDiscountApplied, 
  onDiscountRemoved 
}: DiscountCodeInputProps) {
  const [code, setCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [appliedDiscount, setAppliedDiscount] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const validateCode = async () => {
    if (!code.trim()) return;
    
    setIsValidating(true);
    setError(null);
    
    try {
      // Convert amount to main currency units for API
      const amountInMainUnits = currency === 'JPY' ? originalAmount : originalAmount / 100;
      
      const response = await fetch('/api/discount-codes/validate-cross-platform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          amount: amountInMainUnits,
          currency,
          service_name: serviceName,
          user_email: userEmail
        })
      });
      
      const result = await response.json();
      
      if (response.ok && result.valid) {
        setAppliedDiscount(result);
        onDiscountApplied(result);
        toast({
          title: "折扣碼已套用",
          description: `已套用 ${result.discount_code.code} 折扣碼`,
        });
      } else {
        setError(result.message || '折扣碼無效');
        toast({
          title: "折扣碼無效",
          description: result.message || '請檢查折扣碼是否正確',
          variant: "destructive",
        });
      }
    } catch (error) {
      const errorMessage = '驗證失敗，請稍後再試';
      setError(errorMessage);
      toast({
        title: "驗證失敗",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const removeDiscount = () => {
    setAppliedDiscount(null);
    setCode('');
    setError(null);
    onDiscountRemoved();
    toast({
      title: "已移除折扣",
      description: "折扣碼已移除，金額已恢復原價",
    });
  };

  const formatAmount = (amount: number) => {
    if (currency === 'JPY') {
      return `¥${amount.toLocaleString()}`;
    } else if (currency === 'TWD') {
      return `NT$${(amount / 100).toLocaleString()}`;
    } else {
      return `$${(amount / 100).toFixed(2)}`;
    }
  };

  const getDiscountDisplay = () => {
    if (!appliedDiscount) return null;
    
    const { discount_code } = appliedDiscount;
    if (discount_code.discount_type === 'percentage') {
      return `${discount_code.discount_value}% 折扣`;
    } else {
      const value = currency === 'JPY' 
        ? discount_code.discount_value 
        : discount_code.discount_value;
      return `${currency === 'TWD' ? 'NT$' : currency === 'JPY' ? '¥' : '$'}${value} 折扣`;
    }
  };

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium flex items-center gap-2">
        <Tag className="w-4 h-4" />
        折扣碼
      </label>
      
      {appliedDiscount ? (
        <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center space-x-2">
            <Check className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-700 font-medium">
              {appliedDiscount.discount_code.code}
            </span>
            <span className="text-sm text-green-600">
              {getDiscountDisplay()}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={removeDiscount}
            className="text-red-600 hover:text-red-800 hover:bg-red-50"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex space-x-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="輸入折扣碼"
              className="flex-1"
              onKeyPress={(e) => e.key === 'Enter' && validateCode()}
              disabled={isValidating}
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
          
          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1">
              <X className="w-3 h-3" />
              {error}
            </p>
          )}
        </div>
      )}
      
      {appliedDiscount && (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
            <span className="text-gray-600">原價</span>
            <span>{formatAmount(originalAmount)}</span>
          </div>
          <div className="flex justify-between items-center p-2 bg-green-50 rounded">
            <span className="text-green-600">折扣</span>
            <span className="text-green-600">
              -{formatAmount(appliedDiscount.calculation.discount_amount)}
            </span>
          </div>
          <div className="flex justify-between items-center p-2 bg-blue-50 rounded font-medium">
            <span className="text-blue-900">總計</span>
            <span className="text-blue-900">
              {formatAmount(appliedDiscount.calculation.final_amount)}
            </span>
          </div>
          
          {appliedDiscount.discount_code.description && (
            <p className="text-xs text-gray-500 italic">
              {appliedDiscount.discount_code.description}
            </p>
          )}
        </div>
      )}
    </div>
  );
}