import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, TrendingUp, DollarSign, ArrowRight, Calculator } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import NavigationBar from "@/components/NavigationBar";
import Footer from "@/components/Footer";

type Props = {
  locale?: string;
};

export default function ProfitMarginCalculator({ locale = "zh-TW" }: Props) {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<"landing" | "wizard" | "result">("landing");
  const [wizardStep, setWizardStep] = useState(1);
  
  // 表單數據
  const [formData, setFormData] = useState({
    revenue: "",
    rentUtilities: "",
    salaries: "",
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
  });
  
  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };
  
  const calculateResults = () => {
    const revenue = parseFloat(formData.revenue) || 0;
    const totalFixed = (parseFloat(formData.rentUtilities) || 0) + (parseFloat(formData.salaries) || 0);
    const totalVariable = (parseFloat(formData.marketing) || 0) + (parseFloat(formData.materials) || 0) + (parseFloat(formData.others) || 0);
    
    const totalCosts = totalFixed + totalVariable;
    const profit = revenue - totalCosts;
    const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
    
    // 損益平衡點 = 固定成本 / (1 - 變動成本率)
    const variableCostRate = revenue > 0 ? totalVariable / revenue : 0;
    const breakEvenRevenue = variableCostRate < 1 ? totalFixed / (1 - variableCostRate) : 0;
    
    setResults({
      totalFixedCosts: totalFixed,
      totalVariableCosts: totalVariable,
      profitMargin: profitMargin,
      breakEvenRevenue: breakEvenRevenue,
    });
  };
  
  const handleNext = () => {
    if (wizardStep === 1 && formData.revenue) {
      setWizardStep(2);
    } else if (wizardStep === 2 && (formData.rentUtilities || formData.salaries)) {
      setWizardStep(3);
    } else if (wizardStep === 3) {
      calculateResults();
      setStep("result");
    }
  };
  
  const handleGoToCalculator = () => {
    // 自動帶入損益平衡點營收到預算計算機
    setLocation(`/calculator?targetRevenue=${Math.ceil(results.breakEvenRevenue)}`);
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
                    <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">1,500+</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">位老闆已完成健檢</div>
                  </div>
                  <div className="hidden md:block h-16 w-px bg-gray-300 dark:bg-gray-600"></div>
                  <div className="space-y-2">
                    <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">3 分鐘</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">平均完成時間</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <div className="flex justify-center">
              <Button
                size="lg"
                onClick={() => setStep("wizard")}
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
                  </div>
                )}
                
                {wizardStep === 3 && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="marketing" className="text-base">行銷成本（廣告費、KOL等）</Label>
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
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="materials" className="text-base">材料成本（進貨、包裝等）</Label>
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
            <div className="text-center space-y-4">
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                您的「最低生存門檻」出爐了
              </h2>
            </div>
            
            <Card className="border-2 border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950 dark:to-gray-900">
              <CardContent className="pt-8 pb-8 text-center">
                <div className="space-y-2 mb-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400">您下個月的「最低營收目標」是：</p>
                  <div className="flex items-center justify-center gap-2">
                    <TrendingUp className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                    <div className="text-5xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-break-even-revenue">
                      NT$ {Math.ceil(results.breakEvenRevenue).toLocaleString()}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-500">（這就是您的「損益平衡點銷售額」）</p>
                </div>
                
                <Button
                  size="lg"
                  onClick={handleGoToCalculator}
                  className="mt-6 text-lg px-8"
                  data-testid="button-go-to-calculator"
                >
                  <Calculator className="mr-2 h-5 w-5" />
                  用這個數字規劃廣告預算
                </Button>
              </CardContent>
            </Card>
            
            {results.profitMargin < 15 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  警告：您的微利率僅 {results.profitMargin.toFixed(1)}%，低於健康標準（15%）。建議優先降低成本或提升營收。
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
          </div>
        )}
      </main>
      
      <Footer />
    </div>
  );
}
