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
  home_delivery: { name: "宅配", cost: 100, feePercent: 3 },
  convenience: { name: "超商取貨", cost: 60, feePercent: 3 },
  convenience_cod: { name: "超商取貨付款", cost: 60, feePercent: 0 },
  custom: { name: "自訂", cost: 0, feePercent: 0 },
};

export default function PricingSimulator({ locale = "zh-TW" }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [strategy, setStrategy] = useState<PricingStrategy>("new_customer");
  
  // 表單數據
  const [productCost, setProductCost] = useState("");
  const [shippingMethod, setShippingMethod] = useState<keyof typeof shippingOptions>("convenience_cod");
  const [customShippingCost, setCustomShippingCost] = useState("");
  const [customPaymentFee, setCustomPaymentFee] = useState("");
  const [taxPercent, setTaxPercent] = useState("5");
  
  // 滑桿值（微利率）
  const [profitMarginPercent, setProfitMarginPercent] = useState([33]);
  
  // 計算結果
  const [results, setResults] = useState({
    recommendedPrice: 0,
    grossProfit: 0,
    recommendedCpa: 0,
    totalCost: 0,
  });
  
  // 即時計算
  useEffect(() => {
    if (step === 3 && productCost) {
      calculatePrice();
    }
  }, [profitMarginPercent, productCost, shippingMethod, customShippingCost, customPaymentFee, taxPercent, step]);
  
  const calculatePrice = () => {
    const cost = parseFloat(productCost) || 0;
    const shipping = shippingMethod === "custom" 
      ? (parseFloat(customShippingCost) || 0)
      : shippingOptions[shippingMethod].cost;
    const paymentFee = shippingMethod === "custom"
      ? (parseFloat(customPaymentFee) || 0)
      : shippingOptions[shippingMethod].feePercent;
    const tax = parseFloat(taxPercent) || 5;
    const targetMargin = profitMarginPercent[0] / 100;
    
    // 售價 = (成本 + 運費) / (1 - 微利率 - 稅率% - 金流%)
    // 這是一個簡化版本，實際上金流費用是基於售價的，需要反算
    // 使用迭代方式計算更準確
    
    // 簡化計算：假設金流和稅是基於售價的
    const otherCostRate = (tax / 100) + (paymentFee / 100);
    const basePrice = (cost + shipping) / (1 - targetMargin - otherCostRate);
    
    const recommendedPrice = Math.ceil(basePrice);
    const totalCost = cost + shipping + (recommendedPrice * (tax / 100)) + (recommendedPrice * (paymentFee / 100));
    const grossProfit = recommendedPrice - totalCost;
    const strategyCpa = grossProfit * (strategies[strategy].cpaPercent / 100);
    
    setResults({
      recommendedPrice,
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
                  
                  <div className="space-y-2">
                    <Label htmlFor="tax" className="text-base">稅率（預設 5%）</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="tax"
                        type="number"
                        value={taxPercent}
                        onChange={(e) => setTaxPercent(e.target.value)}
                        className="w-24"
                        data-testid="input-tax"
                      />
                      <span className="text-gray-600 dark:text-gray-400">%</span>
                    </div>
                  </div>
                  
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
                          拖動以設定您的「目標微利率」
                        </Label>
                        
                        <div className="text-center">
                          <div className="text-5xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-profit-margin-slider">
                            {profitMarginPercent[0]}%
                          </div>
                        </div>
                        
                        <div className="px-4">
                          <Slider
                            value={profitMarginPercent}
                            onValueChange={setProfitMarginPercent}
                            min={20}
                            max={50}
                            step={1}
                            className="w-full"
                            data-testid="slider-profit-margin"
                          />
                          <div className="flex justify-between text-sm text-gray-500 mt-2">
                            <span>20%</span>
                            <span>50%</span>
                          </div>
                        </div>
                        
                        {profitMarginPercent[0] < 25 && (
                          <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                              警告：低於 25% 的微利率將難以負擔廣告支出！
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    </div>
                    
                    {/* 右欄：結果區 */}
                    <div className="space-y-6">
                      <Card className="border-2 border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950 dark:to-gray-900">
                        <CardContent className="pt-6 space-y-6">
                          <div className="space-y-2">
                            <p className="text-sm text-gray-600 dark:text-gray-400">您的「建議售價」應為：</p>
                            <div className="flex items-center gap-2">
                              <TrendingUp className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                              <div className="text-4xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-recommended-price">
                                NT$ {results.recommendedPrice.toLocaleString()}
                              </div>
                            </div>
                          </div>
                          
                          <div className="border-t pt-4 space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600 dark:text-gray-400">毛額（元）</span>
                              <span className="font-semibold" data-testid="text-gross-profit">
                                $ {Math.ceil(results.grossProfit).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500">（售價 ${results.recommendedPrice.toLocaleString()} 扣除所有成本 ${Math.ceil(results.totalCost).toLocaleString()}）</p>
                          </div>
                          
                          <div className="border-t pt-4 space-y-2">
                            <div className="bg-yellow-50 dark:bg-yellow-950 p-4 rounded-lg space-y-2">
                              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                【{strategies[strategy].name}】建議 CPA 上限（毛額的 {strategies[strategy].cpaPercent}%）
                              </p>
                              <div className="text-3xl font-bold text-yellow-700 dark:text-yellow-400" data-testid="text-recommended-cpa">
                                NT$ {Math.ceil(results.recommendedCpa).toLocaleString()}
                              </div>
                              <p className="text-xs text-gray-600 dark:text-gray-400">
                                （您每筆訂單的廣告費應控制在此金額以下）
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
