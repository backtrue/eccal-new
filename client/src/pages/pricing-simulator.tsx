import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, TrendingUp, DollarSign, ArrowRight, ArrowLeft, Package, Truck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import NavigationBar from "@/components/NavigationBar";
import Footer from "@/components/Footer";

type Props = {
  locale?: string;
};

type PricingStrategy = "crowdfunding" | "new_customer" | "regular";

const strategies = {
  crowdfunding: { name: "群眾募資", cpaPercent: 30, description: "建議 CPA 抓毛額 30%" },
  new_customer: { name: "新客活動", cpaPercent: 20, description: "建議 CPA 抓毛額 20%" },
  regular: { name: "常態銷售", cpaPercent: 15, description: "建議 CPA 抓毛額 15%" },
};

const shippingOptions = {
  home_delivery: { name: "宅配", cost: 130, feePercent: 3 },
  convenience: { name: "超取", cost: 60, feePercent: 3 },
  custom: { name: "自訂", cost: 0, feePercent: 0 },
};

export default function PricingSimulator({ locale = "zh-TW" }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [strategy, setStrategy] = useState<PricingStrategy>("new_customer");
  
  // 表單數據
  const [productCost, setProductCost] = useState("");
  const [shippingMethod, setShippingMethod] = useState<keyof typeof shippingOptions>("home_delivery");
  const [customShippingCost, setCustomShippingCost] = useState("");
  const [customPaymentFee, setCustomPaymentFee] = useState("");
  
  // 滑桿值（建議售價的倍數）
  const [priceMultiplier, setPriceMultiplier] = useState([2.0]);
  
  // 計算結果
  const [results, setResults] = useState({
    recommendedPrice: 0,
    profitMarginPercent: 0,
    grossProfit: 0,
    recommendedCpa: 0,
    totalCost: 0,
  });
  
  // 即時計算
  useEffect(() => {
    if (step === 3 && productCost) {
      calculatePrice();
    }
  }, [priceMultiplier, productCost, shippingMethod, customShippingCost, customPaymentFee, step]);
  
  const calculatePrice = () => {
    const cost = parseFloat(productCost) || 0;
    const shipping = shippingMethod === "custom" 
      ? (parseFloat(customShippingCost) || 0)
      : shippingOptions[shippingMethod].cost;
    const paymentFeePercent = shippingMethod === "custom"
      ? (parseFloat(customPaymentFee) || 0)
      : shippingOptions[shippingMethod].feePercent;
    const taxPercent = 5; // 固定 5% 稅率
    
    // 新邏輯：用戶拖動建議售價，計算微利率
    // 建議售價 = 產品成本 × 倍數
    const recommendedPrice = Math.ceil(cost * priceMultiplier[0]);
    
    // 總成本 = 商品成本 + 運費 + (售價 × 金流%) + (售價 × 5% 稅)
    const paymentFeeCost = recommendedPrice * (paymentFeePercent / 100);
    const taxCost = recommendedPrice * (taxPercent / 100);
    const totalCost = cost + shipping + paymentFeeCost + taxCost;
    
    // 毛利 = 售價 - 總成本
    const grossProfit = recommendedPrice - totalCost;
    
    // 微利率 = (售價 - 總成本) / 售價 × 100%
    const profitMarginPercent = (grossProfit / recommendedPrice) * 100;
    
    // 建議 CPA = 毛利 × 策略百分比
    const strategyCpa = grossProfit * (strategies[strategy].cpaPercent / 100);
    
    setResults({
      recommendedPrice,
      profitMarginPercent: Math.max(0, profitMarginPercent),
      grossProfit: Math.max(0, grossProfit),
      recommendedCpa: Math.max(0, strategyCpa),
      totalCost,
    });
  };
  
  const progress = (step / 3) * 100;
  
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <NavigationBar locale={locale as "zh-TW" | "en" | "ja"} />
      
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white">
              商品定價模擬器
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              我們將引導您輸入成本、模擬利潤，並根據您的策略，找出「建議售價」與「廣告費 (CPA) 上限」。
            </p>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
              <span>進度</span>
              <span>步驟 {step} / 3</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
          
          {/* Step 1: 策略選擇 */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in duration-500">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl">步驟 1：選擇策略</CardTitle>
                  <CardDescription>您這次的計算情境是？</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {Object.entries(strategies).map(([key, value]) => (
                      <Card
                        key={key}
                        className={`cursor-pointer transition-all hover:shadow-lg ${
                          strategy === key 
                            ? "border-2 border-blue-500 bg-blue-50 dark:bg-blue-950" 
                            : "border hover:border-blue-300"
                        }`}
                        onClick={() => setStrategy(key as PricingStrategy)}
                        data-testid={`card-strategy-${key}`}
                      >
                        <CardHeader>
                          <CardTitle className="text-lg">{value.name}</CardTitle>
                          <CardDescription className="text-xs">{value.description}</CardDescription>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                  
                  <div className="flex justify-end pt-4">
                    <Button onClick={() => setStep(2)} size="lg" data-testid="button-next-step">
                      下一步：輸入成本
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          
          {/* Step 2: 輸入成本 */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in duration-500">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl">步驟 2：輸入成本</CardTitle>
                  <CardDescription>請輸入您的產品單位成本</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="productCost" className="text-base font-semibold">
                      <Package className="inline h-4 w-4 mr-1" />
                      產品總成本（包含進貨、包材、輔銷物等）
                    </Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                      <Input
                        id="productCost"
                        type="number"
                        placeholder="例如：500"
                        value={productCost}
                        onChange={(e) => setProductCost(e.target.value)}
                        className="pl-10 text-lg h-12"
                        data-testid="input-product-cost"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="shipping" className="text-base font-semibold">
                      <Truck className="inline h-4 w-4 mr-1" />
                      物流方式（將自動計算運費與金流%）
                    </Label>
                    <Select value={shippingMethod} onValueChange={(v) => setShippingMethod(v as keyof typeof shippingOptions)}>
                      <SelectTrigger id="shipping" data-testid="select-shipping">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(shippingOptions).map(([key, value]) => (
                          <SelectItem key={key} value={key}>
                            {value.name} {key !== "custom" && `(運費 $${value.cost} / 金流 ${value.feePercent}%)`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {shippingMethod === "custom" && (
                    <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-blue-300">
                      <div className="space-y-2">
                        <Label htmlFor="customShipping">自訂運費（元）</Label>
                        <Input
                          id="customShipping"
                          type="number"
                          placeholder="例如：80"
                          value={customShippingCost}
                          onChange={(e) => setCustomShippingCost(e.target.value)}
                          data-testid="input-custom-shipping"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="customPayment">自訂金流手續費（%）</Label>
                        <Input
                          id="customPayment"
                          type="number"
                          placeholder="例如：2.5"
                          value={customPaymentFee}
                          onChange={(e) => setCustomPaymentFee(e.target.value)}
                          data-testid="input-custom-payment"
                        />
                      </div>
                    </div>
                  )}
                  
                  <div className="flex gap-4 pt-4">
                    <Button variant="outline" onClick={() => setStep(1)} data-testid="button-previous">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      回上一步
                    </Button>
                    <Button 
                      onClick={() => {
                        calculatePrice();
                        setStep(3);
                      }}
                      className="flex-1"
                      disabled={!productCost}
                      data-testid="button-next-simulate"
                    >
                      下一步：模擬定價
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          
          {/* Step 3: 動態模擬器 */}
          {step === 3 && (
            <div className="space-y-6 animate-in fade-in duration-500">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl">步驟 3：找出最佳定價</CardTitle>
                  <CardDescription>
                    您選擇的策略是：<span className="font-bold text-blue-600 dark:text-blue-400">{strategies[strategy].name}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 gap-8">
                    {/* 左欄：互動區 */}
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <Label className="text-lg font-semibold">
                          拖動以設定您的「建議售價」
                        </Label>
                        
                        <div className="text-center">
                          <div className="text-5xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-recommended-price-slider">
                            NT$ {results.recommendedPrice.toLocaleString()}
                          </div>
                          <p className="text-sm text-gray-500 mt-2">
                            （產品成本的 {priceMultiplier[0].toFixed(1)} 倍）
                          </p>
                        </div>
                        
                        <div className="px-4">
                          <Slider
                            value={priceMultiplier}
                            onValueChange={setPriceMultiplier}
                            min={1.1}
                            max={20}
                            step={0.1}
                            className="w-full"
                            data-testid="slider-price-multiplier"
                          />
                          <div className="flex justify-between text-sm text-gray-500 mt-2">
                            <span>1.1x</span>
                            <span>20x</span>
                          </div>
                        </div>
                        
                        <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">計算出的微利率：</p>
                          <div className="text-4xl font-bold text-purple-600 dark:text-purple-400" data-testid="text-calculated-margin">
                            {results.profitMarginPercent.toFixed(1)}%
                          </div>
                          {results.profitMarginPercent < 25 && (
                            <Alert variant="destructive" className="mt-4">
                              <AlertCircle className="h-4 w-4" />
                              <AlertDescription>
                                警告：低於 25% 的微利率將難以負擔廣告支出！
                              </AlertDescription>
                            </Alert>
                          )}
                          {results.profitMarginPercent >= 25 && results.profitMarginPercent < 35 && (
                            <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
                              ⚠️ 微利率偏低，廣告費用較緊張
                            </p>
                          )}
                          {results.profitMarginPercent >= 35 && (
                            <p className="text-sm text-green-600 dark:text-green-400 mt-2">
                              ✅ 微利率健康，有充足的廣告預算空間
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* 右欄：結果區 */}
                    <div className="space-y-6">
                      <Card className="border-2 border-green-200 dark:border-green-800 bg-gradient-to-br from-green-50 to-white dark:from-green-950 dark:to-gray-900">
                        <CardContent className="pt-6 space-y-6">
                          <div className="space-y-2">
                            <p className="text-sm text-gray-600 dark:text-gray-400">成本明細</p>
                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-gray-400">產品成本</span>
                                <span>$ {parseFloat(productCost || "0").toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-gray-400">運費</span>
                                <span>$ {(shippingMethod === "custom" ? parseFloat(customShippingCost || "0") : shippingOptions[shippingMethod].cost).toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-gray-400">金流費用 ({shippingMethod === "custom" ? (parseFloat(customPaymentFee || "0")) : shippingOptions[shippingMethod].feePercent}%)</span>
                                <span>$ {Math.ceil(results.recommendedPrice * ((shippingMethod === "custom" ? (parseFloat(customPaymentFee || "0")) : shippingOptions[shippingMethod].feePercent) / 100)).toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-gray-400">稅費 (5%)</span>
                                <span>$ {Math.ceil(results.recommendedPrice * 0.05).toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between font-bold border-t pt-1 mt-1">
                                <span>總成本</span>
                                <span data-testid="text-total-cost">$ {Math.ceil(results.totalCost).toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="border-t pt-4 space-y-2">
                            <div className="flex items-center gap-2">
                              <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
                              <span className="text-sm text-gray-600 dark:text-gray-400">毛利</span>
                            </div>
                            <div className="text-3xl font-bold text-green-600 dark:text-green-400" data-testid="text-gross-profit">
                              NT$ {Math.ceil(results.grossProfit).toLocaleString()}
                            </div>
                            <p className="text-xs text-gray-500">
                              （售價 ${results.recommendedPrice.toLocaleString()} - 總成本 ${Math.ceil(results.totalCost).toLocaleString()}）
                            </p>
                          </div>
                          
                          <div className="border-t pt-4 space-y-2">
                            <div className="bg-yellow-50 dark:bg-yellow-950 p-4 rounded-lg space-y-2">
                              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                【{strategies[strategy].name}】建議 CPA 上限
                              </p>
                              <p className="text-xs text-gray-500">
                                （毛利的 {strategies[strategy].cpaPercent}%）
                              </p>
                              <div className="text-3xl font-bold text-yellow-700 dark:text-yellow-400" data-testid="text-recommended-cpa">
                                NT$ {Math.ceil(results.recommendedCpa).toLocaleString()}
                              </div>
                              <p className="text-xs text-gray-600 dark:text-gray-400">
                                每筆訂單的廣告費應控制在此金額以下
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                  
                  <div className="flex gap-4 pt-6 border-t">
                    <Button variant="outline" onClick={() => setStep(2)} data-testid="button-back-modify">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      回上一步修改成本
                    </Button>
                    <Button 
                      onClick={() => {
                        setStep(1);
                        setProductCost("");
                      }}
                      variant="outline"
                      className="flex-1"
                      data-testid="button-new-simulation"
                    >
                      開始新的模擬
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>
      
      <Footer />
    </div>
  );
}
