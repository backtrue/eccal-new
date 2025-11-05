import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, TrendingUp, DollarSign, ArrowRight, Calculator } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import NavigationBar from "@/components/NavigationBar";
import Footer from "@/components/Footer";
import { apiRequest, queryClient } from "@/lib/queryClient";
import teacher1 from "@assets/1_1762321340844.png";
import teacher2 from "@assets/2_1762321340845.png";
import teacher3 from "@assets/3_1762321340845.png";
import teacher4 from "@assets/4_1762321340845.png";

type Props = {
  locale?: string;
};

export default function ProfitMarginCalculator({ locale = "zh-TW" }: Props) {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<"landing" | "wizard" | "result">("landing");
  const [wizardStep, setWizardStep] = useState(1);
  const [startTime, setStartTime] = useState<number | null>(null);
  
  // Fetch calculator analytics from API
  const { data: analytics } = useQuery<{ completedCount: number; averageCompletionTime: number }>({
    queryKey: ['/api/calculator-analytics'],
  });
  
  // 表單數據
  const [formData, setFormData] = useState({
    revenue: "",
    rentUtilities: "",
    salaries: "",
    depreciation: "",
    insurance: "",
    accountingFees: "",
    kolFees: "",
    customItemName: "",
    customItemAmount: "",
    marketing: "",
    materials: "",
    others: "",
  });
  
  // 計算結果
  const [results, setResults] = useState({
    totalFixedCosts: 0,
    totalVariableCosts: 0,
    profitMargin: 0,
    breakEvenRevenue: 0,
    requiredRevenue: 0,
  });
  
  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };
  
  const calculateResults = () => {
    const revenue = parseFloat(formData.revenue) || 0;
    const totalFixed = (parseFloat(formData.rentUtilities) || 0) + 
                       (parseFloat(formData.salaries) || 0) +
                       (parseFloat(formData.depreciation) || 0) +
                       (parseFloat(formData.insurance) || 0) +
                       (parseFloat(formData.accountingFees) || 0) +
                       (parseFloat(formData.kolFees) || 0) +
                       (parseFloat(formData.customItemAmount) || 0);
    const totalVariable = (parseFloat(formData.marketing) || 0) + (parseFloat(formData.materials) || 0) + (parseFloat(formData.others) || 0);
    
    const totalCosts = totalFixed + totalVariable;
    const profit = revenue - totalCosts;
    const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
    
    // 公式：最低營收目標 = 總固定成本 / 微利率
    // 將百分比轉為小數（例如：15% -> 0.15）
    const profitMarginDecimal = profitMargin / 100;
    const breakEvenRevenue = profitMarginDecimal > 0 ? totalFixed / profitMarginDecimal : 0;
    
    // 公式：推薦營收目標 = (總變動成本 × 1.1) / 微利率
    const requiredRevenue = profitMarginDecimal > 0 ? (totalVariable * 1.1) / profitMarginDecimal : 0;
    
    setResults({
      totalFixedCosts: totalFixed,
      totalVariableCosts: totalVariable,
      profitMargin: profitMargin,
      breakEvenRevenue: breakEvenRevenue,
      requiredRevenue: requiredRevenue,
    });
  };
  
  const handleNext = async () => {
    if (wizardStep === 1 && formData.revenue) {
      setWizardStep(2);
    } else if (wizardStep === 2 && (formData.rentUtilities || formData.salaries)) {
      setWizardStep(3);
    } else if (wizardStep === 3) {
      calculateResults();
      setStep("result");
      
      // Record completion time if startTime is set
      if (startTime) {
        const completionTime = Math.floor((Date.now() - startTime) / 1000);
        try {
          await apiRequest('POST', '/api/calculator-analytics/record', {
            completionTimeSeconds: completionTime
          });
          // Invalidate analytics cache to refresh statistics
          queryClient.invalidateQueries({ queryKey: ['/api/calculator-analytics'] });
        } catch (error) {
          console.error('Failed to record completion time:', error);
        }
      }
    }
  };
  
  const handleGoToCalculator = () => {
    // 自動帶入推薦營收目標到預算計算機
    setLocation(`/calculator?targetRevenue=${Math.ceil(results.requiredRevenue)}`);
  };
  
  const progress = (wizardStep / 3) * 100;
  
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <NavigationBar locale={locale as "zh-TW" | "en" | "ja"} />
      
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl">
        {/* Landing Page */}
        {step === "landing" && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="text-center space-y-4">
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white">
                算對了，才開始
              </h1>
              <h2 className="text-2xl md:text-3xl font-semibold text-gray-700 dark:text-gray-300">
                公司整體損益計算機
              </h2>
              <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                別再憑感覺訂目標！我們引導您算出真實的「損益平衡點」，
                找出您公司「必須活下去」的最低營收門檻。
              </p>
            </div>
            
            <Card className="border-2 border-blue-200 dark:border-blue-800">
              <CardContent className="pt-6">
                <div className="flex flex-col md:flex-row items-center justify-center gap-8 text-center">
                  <div className="space-y-2">
                    <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                      {analytics ? analytics.completedCount.toLocaleString() : '1,024'}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">位老闆已完成健檢</div>
                  </div>
                  <div className="hidden md:block h-16 w-px bg-gray-300 dark:bg-gray-600"></div>
                  <div className="space-y-2">
                    <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                      {analytics ? `${Math.floor(analytics.averageCompletionTime / 60)} 分鐘` : '3 分鐘'}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">平均完成時間</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <div className="flex justify-center">
              <Button
                size="lg"
                onClick={() => {
                  setStartTime(Date.now());
                  setStep("wizard");
                }}
                className="text-lg px-8 py-6"
                data-testid="button-start-calculation"
              >
                開始計算
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </div>
        )}
        
        {/* Wizard */}
        {step === "wizard" && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                <span>進度</span>
                <span>{wizardStep} / 3</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">
                  {wizardStep === 1 && "首先，請告訴我們您上個月的「總營業額」大概是多少？"}
                  {wizardStep === 2 && "好的。接下來我們算「固定成本」。"}
                  {wizardStep === 3 && "最後，我們算「變動成本」。"}
                </CardTitle>
                <CardDescription>
                  {wizardStep === 1 && "輸入大概的數字即可，不需要太精確"}
                  {wizardStep === 2 && "包含房租、水電、人事等固定支出"}
                  {wizardStep === 3 && "包含廣告、材料等隨營收變動的成本"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {wizardStep === 1 && (
                  <div className="space-y-2">
                    <Label htmlFor="revenue" className="text-lg">總營業額（元）</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                      <Input
                        id="revenue"
                        type="number"
                        placeholder="例如：1000000"
                        value={formData.revenue}
                        onChange={(e) => handleInputChange("revenue", e.target.value)}
                        className="pl-10 text-lg h-12"
                        data-testid="input-revenue"
                      />
                    </div>
                  </div>
                )}
                
                {wizardStep === 2 && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="rentUtilities" className="text-base">營運成本（房租、水電等）</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                        <Input
                          id="rentUtilities"
                          type="number"
                          placeholder="例如：50000"
                          value={formData.rentUtilities}
                          onChange={(e) => handleInputChange("rentUtilities", e.target.value)}
                          className="pl-10"
                          data-testid="input-rent-utilities"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="salaries" className="text-base">人事成本（薪水、勞健保等）</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                        <Input
                          id="salaries"
                          type="number"
                          placeholder="例如：100000"
                          value={formData.salaries}
                          onChange={(e) => handleInputChange("salaries", e.target.value)}
                          className="pl-10"
                          data-testid="input-salaries"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="depreciation" className="text-base">折舊（選填）</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                        <Input
                          id="depreciation"
                          type="number"
                          placeholder="例如：20000"
                          value={formData.depreciation}
                          onChange={(e) => handleInputChange("depreciation", e.target.value)}
                          className="pl-10"
                          data-testid="input-depreciation"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="insurance" className="text-base">保險費（選填）</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                        <Input
                          id="insurance"
                          type="number"
                          placeholder="例如：15000"
                          value={formData.insurance}
                          onChange={(e) => handleInputChange("insurance", e.target.value)}
                          className="pl-10"
                          data-testid="input-insurance"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="accountingFees" className="text-base">會計/顧問費（選填）</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                        <Input
                          id="accountingFees"
                          type="number"
                          placeholder="例如：10000"
                          value={formData.accountingFees}
                          onChange={(e) => handleInputChange("accountingFees", e.target.value)}
                          className="pl-10"
                          data-testid="input-accounting-fees"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="kolFees" className="text-base">KOL/網紅費用（選填）</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                        <Input
                          id="kolFees"
                          type="number"
                          placeholder="例如：30000"
                          value={formData.kolFees}
                          onChange={(e) => handleInputChange("kolFees", e.target.value)}
                          className="pl-10"
                          data-testid="input-kol-fees"
                        />
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">長期合作網紅、業配費用</p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="customItemName" className="text-base">自訂項目（選填）</Label>
                      <Input
                        id="customItemName"
                        type="text"
                        placeholder="例如：其他固定成本"
                        value={formData.customItemName}
                        onChange={(e) => handleInputChange("customItemName", e.target.value)}
                        className="mb-2"
                        data-testid="input-custom-item-name"
                      />
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                        <Input
                          id="customItemAmount"
                          type="number"
                          placeholder="例如：5000"
                          value={formData.customItemAmount}
                          onChange={(e) => handleInputChange("customItemAmount", e.target.value)}
                          className="pl-10"
                          data-testid="input-custom-item-amount"
                        />
                      </div>
                    </div>
                  </div>
                )}
                
                {wizardStep === 3 && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="marketing" className="text-base">網路廣告</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                        <Input
                          id="marketing"
                          type="number"
                          placeholder="例如：80000"
                          value={formData.marketing}
                          onChange={(e) => handleInputChange("marketing", e.target.value)}
                          className="pl-10"
                          data-testid="input-marketing"
                        />
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Meta廣告、Google廣告、網紅分潤等</p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="materials" className="text-base">生產/進貨成本</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                        <Input
                          id="materials"
                          type="number"
                          placeholder="例如：120000"
                          value={formData.materials}
                          onChange={(e) => handleInputChange("materials", e.target.value)}
                          className="pl-10"
                          data-testid="input-materials"
                        />
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">原料、進貨、包裝材料等</p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="others" className="text-base">其他變動成本（選填）</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                        <Input
                          id="others"
                          type="number"
                          placeholder="例如：20000"
                          value={formData.others}
                          onChange={(e) => handleInputChange("others", e.target.value)}
                          className="pl-10"
                          data-testid="input-others"
                        />
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="flex gap-4 pt-4">
                  {wizardStep > 1 && (
                    <Button
                      variant="outline"
                      onClick={() => setWizardStep(wizardStep - 1)}
                      data-testid="button-previous"
                    >
                      上一步
                    </Button>
                  )}
                  <Button
                    onClick={handleNext}
                    className="flex-1"
                    disabled={
                      (wizardStep === 1 && !formData.revenue) ||
                      (wizardStep === 2 && !formData.rentUtilities && !formData.salaries)
                    }
                    data-testid="button-next"
                  >
                    {wizardStep === 3 ? "查看健檢結果" : "下一步"}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* Result Page */}
        {step === "result" && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {results.profitMargin <= 0 ? (
              <div className="space-y-6">
                <div className="text-center space-y-4">
                  <h2 className="text-3xl font-bold text-red-600 dark:text-red-400">
                    無法計算
                  </h2>
                  <p className="text-lg text-gray-600 dark:text-gray-400">
                    您的微利率為負數，表示公司目前處於虧損狀態
                  </p>
                </div>
                
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    您的微利率為 {results.profitMargin.toFixed(1)}%，這表示您的總成本（固定成本 + 變動成本）已經超過營業額。
                    在這種情況下，無法計算健康的營收目標。建議您：
                    <ul className="mt-2 ml-4 list-disc space-y-1">
                      <li>檢查並降低固定成本（租金、人事等）</li>
                      <li>優化變動成本（廣告、材料等）</li>
                      <li>提升營業額</li>
                    </ul>
                  </AlertDescription>
                </Alert>
                
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calculator className="h-5 w-5" />
                      您的成本結構
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <p className="text-sm text-gray-600 dark:text-gray-400">總固定成本</p>
                        <p className="text-2xl font-bold">
                          NT$ {results.totalFixedCosts.toLocaleString()}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-gray-600 dark:text-gray-400">總變動成本</p>
                        <p className="text-2xl font-bold">
                          NT$ {results.totalVariableCosts.toLocaleString()}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-gray-600 dark:text-gray-400">上個月營業額</p>
                        <p className="text-2xl font-bold">
                          NT$ {parseFloat(formData.revenue).toLocaleString()}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-gray-600 dark:text-gray-400">您的微利率</p>
                        <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                          {results.profitMargin.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                    
                    <div className="pt-4 border-t">
                      <Button
                        onClick={() => {
                          setStep("wizard");
                          setWizardStep(1);
                        }}
                        className="w-full"
                        data-testid="button-recalculate"
                      >
                        重新填寫數據
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <>
                <div className="text-center space-y-4">
                  <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                    您的「最低生存門檻」出爐了
                  </h2>
                </div>
            
            {(() => {
              const revenue = parseFloat(formData.revenue) || 0;
              const revenueRatio = revenue / results.breakEvenRevenue;
              
              if (revenueRatio >= 1.5) {
                return (
                  <Alert className="border-green-500 bg-green-50 dark:bg-green-950 dark:border-green-800">
                    <AlertDescription className="text-gray-900 dark:text-gray-100">
                      <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-shrink-0">
                          <img 
                            src={teacher1} 
                            alt="小黑老師" 
                            className="w-20 h-20 rounded-full object-cover"
                          />
                        </div>
                        <div className="flex-1 space-y-3">
                          <p className="font-semibold text-sm text-green-700 dark:text-green-400">
                            💬 小黑老師說
                          </p>
                          <p className="font-bold text-lg text-green-700 dark:text-green-400">
                            太棒了！你上個月營收達生存門檻的 {revenueRatio.toFixed(1)} 倍 🎉
                          </p>
                          <p className="text-sm leading-relaxed">
                            你上個月的營收表現非常亮眼，已經遠遠超過生存門檻。能做到這樣的成績，代表你這段時間的努力和決策都是對的——這值得好好慶祝一下！
                          </p>
                          <p className="text-sm leading-relaxed">
                            當公司進入這樣的健康階段，恭喜你，你已經有資格開始思考「第二曲線」了。可以試著投入新產品線、探索新市場，或者強化品牌與人才的基礎建設。這時候也建議你建立一筆策略性儲備金，這樣未來遇到好機會或市場變化時，你會有更充裕的彈性去抓住機會。
                          </p>
                          <p className="text-sm leading-relaxed font-medium text-green-700 dark:text-green-400">
                            你做得很好，繼續保持！
                          </p>
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                );
              } else if (revenueRatio >= 1.1) {
                return (
                  <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
                    <AlertDescription className="text-gray-900 dark:text-gray-100">
                      <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-shrink-0">
                          <img 
                            src={teacher2} 
                            alt="小黑老師" 
                            className="w-20 h-20 rounded-full object-cover"
                          />
                        </div>
                        <div className="flex-1 space-y-3">
                          <p className="font-semibold text-sm text-blue-700 dark:text-blue-400">
                            💬 小黑老師說
                          </p>
                          <p className="font-bold text-lg text-blue-700 dark:text-blue-400">
                            做得不錯！你的營收達生存門檻的 {revenueRatio.toFixed(1)} 倍 ✅
                          </p>
                          <p className="text-sm leading-relaxed">
                            上個月的營收表現穩健，已經超過生存門檻了。這代表你目前的經營節奏、產品結構都是健康的，這份穩定是你一步步累積出來的成果。
                          </p>
                          <p className="text-sm leading-relaxed">
                            接下來的重點不是急著擴張，而是「優化」。建議你持續打磨現有流程、建立 3 到 6 個月的安全緩衝金，把現金流穩穩抓住。記住，穩健的成長，永遠比盲目追求速度更能讓企業走得長遠。
                          </p>
                          <p className="text-sm leading-relaxed font-medium text-blue-700 dark:text-blue-400">
                            你現在走的方向是對的，繼續往前走吧！
                          </p>
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                );
              } else if (revenueRatio >= 0.9) {
                return (
                  <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-800">
                    <AlertDescription className="text-gray-900 dark:text-gray-100">
                      <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-shrink-0">
                          <img 
                            src={teacher3} 
                            alt="小黑老師" 
                            className="w-20 h-20 rounded-full object-cover"
                          />
                        </div>
                        <div className="flex-1 space-y-3">
                          <p className="font-semibold text-sm text-yellow-700 dark:text-yellow-400">
                            💬 小黑老師說
                          </p>
                          <p className="font-bold text-lg text-yellow-700 dark:text-yellow-400">
                            注意！你的營收達生存門檻的 {(revenueRatio * 100).toFixed(0)}% ⚠️
                          </p>
                          <p className="text-sm leading-relaxed">
                            要特別留意，上個月的營收已經很接近生存門檻，代表目前的經營狀況還不算穩定。這時候千萬不要急著衝量，而是要先確保「每一筆收入都有利可圖」。
                          </p>
                          <p className="text-sm leading-relaxed">
                            建議你優先檢視變動成本，看看有沒有可以微調或重新談價的空間，同時也要關注一下廣告效益跟生產、進貨成本。只要能守住微利區間，你就能避免掉到門檻以下。
                          </p>
                          <p className="text-sm leading-relaxed font-medium text-yellow-700 dark:text-yellow-400">
                            這個階段需要冷靜和精準，調整好了就能再往上走。
                          </p>
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                );
              } else {
                return (
                  <Alert variant="destructive">
                    <AlertDescription>
                      <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-shrink-0">
                          <img 
                            src={teacher4} 
                            alt="小黑老師" 
                            className="w-20 h-20 rounded-full object-cover"
                          />
                        </div>
                        <div className="flex-1 space-y-3">
                          <p className="font-semibold text-sm">
                            💬 小黑老師說
                          </p>
                          <p className="font-bold text-lg">
                            警告！你的營收僅達生存門檻的 {(revenueRatio * 100).toFixed(0)}% 🚨
                          </p>
                          <p className="text-sm leading-relaxed">
                            目前的營收已經低於生存門檻，這是一個需要立刻處理的警訊。但別慌，問題被看見了，就有機會解決。
                          </p>
                          <p className="text-sm leading-relaxed">
                            請先全面檢視所有變動成本，特別是網路廣告的 ROI，以及生產或進貨成本是否還有優化空間。如果這些部分已經壓到極限，也要開始評估固定成本能不能調整。短期內的重點是「止血」——先讓現金流回到正向，穩住了再談成長。
                          </p>
                          <p className="text-sm leading-relaxed font-medium">
                            這個階段會辛苦一點，但只要方向對了，就能翻轉局面。
                          </p>
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                );
              }
            })()}
            
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="border-2 border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950 dark:to-gray-900">
                <CardContent className="pt-8 pb-8 text-center">
                  <div className="space-y-2 mb-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">最低營收目標（損益平衡）</p>
                    <div className="flex items-center justify-center gap-2">
                      <TrendingUp className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                      <div className="text-4xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-break-even-revenue">
                        NT$ {Math.ceil(results.breakEvenRevenue).toLocaleString()}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-500">（不賺不賠的基準線）</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="border-2 border-green-200 dark:border-green-800 bg-gradient-to-br from-green-50 to-white dark:from-green-950 dark:to-gray-900">
                <CardContent className="pt-8 pb-8 text-center">
                  <div className="space-y-2 mb-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">推薦營收目標</p>
                    <div className="flex items-center justify-center gap-2">
                      <TrendingUp className="h-6 w-6 text-green-600 dark:text-green-400" />
                      <div className="text-4xl font-bold text-green-600 dark:text-green-400" data-testid="text-required-revenue">
                        NT$ {Math.ceil(results.requiredRevenue).toLocaleString()}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-500">（建議達成的營收目標）</p>
                  </div>
                </CardContent>
              </Card>
            </div>
            
            <Card className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 border-2 border-purple-200 dark:border-purple-800">
              <CardContent className="pt-6 text-center">
                <Button
                  size="lg"
                  onClick={handleGoToCalculator}
                  className="text-lg px-8"
                  data-testid="button-go-to-calculator"
                >
                  <Calculator className="mr-2 h-5 w-5" />
                  用推薦營收目標規劃廣告預算
                </Button>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">
                  一鍵將 NT$ {Math.ceil(results.requiredRevenue).toLocaleString()} 帶入預算計算機
                </p>
              </CardContent>
            </Card>
            
            {results.profitMargin < 15 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  警告：您的微利率僅 {results.profitMargin.toFixed(1)}%，偏低。建議優先降低成本或提升營收。
                </AlertDescription>
              </Alert>
            )}
            
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  詳細計算
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-sm text-gray-600 dark:text-gray-400">您的微利率</p>
                    <p className="text-2xl font-bold" data-testid="text-profit-margin">
                      {results.profitMargin.toFixed(1)}%
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-gray-600 dark:text-gray-400">總固定成本</p>
                    <p className="text-2xl font-bold">
                      NT$ {results.totalFixedCosts.toLocaleString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-gray-600 dark:text-gray-400">總變動成本</p>
                    <p className="text-2xl font-bold">
                      NT$ {results.totalVariableCosts.toLocaleString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-gray-600 dark:text-gray-400">上個月營業額</p>
                    <p className="text-2xl font-bold">
                      NT$ {parseFloat(formData.revenue).toLocaleString()}
                    </p>
                  </div>
                </div>
                
                <div className="pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setStep("landing");
                      setWizardStep(1);
                      setFormData({
                        revenue: "",
                        rentUtilities: "",
                        salaries: "",
                        marketing: "",
                        materials: "",
                        others: "",
                      });
                    }}
                    className="w-full"
                    data-testid="button-recalculate"
                  >
                    重新計算
                  </Button>
                </div>
              </CardContent>
            </Card>
              </>
            )}
          </div>
        )}
      </main>
      
      <Footer />
    </div>
  );
}
