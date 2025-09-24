import { useState, useEffect } from 'react';
import { useAuth } from "@/hooks/useAuth";
import NavigationBar from '@/components/NavigationBar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { 
  Loader2, 
  Shield, 
  Target, 
  TrendingUp, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Facebook,
  BarChart3,
  Lightbulb
} from 'lucide-react';
import { useFbAuditAccounts, useFbAuditPlans, useFbAuditIndustries, useFbAuditCheck } from '@/hooks/useFbAudit';
import { useFbAuditStream } from '@/hooks/useFbAuditStream';
import { NPSRating } from '@/components/NPSRating';
import FacebookAccountSelector from '@/components/FacebookAccountSelector';
import FacebookLoginButton from '@/components/FacebookLoginButton';
import type { Locale } from '@/lib/i18n';
import { getTranslations } from '@/lib/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { usePageViewTracking, useFbAuditTracking } from '@/hooks/useBehaviorTracking';

interface MetaDashboardProps {
  locale: Locale;
}

export default function MetaDashboard({ locale }: MetaDashboardProps) {
  const t = getTranslations(locale);
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const [selectedIndustry, setSelectedIndustry] = useState<string>("");
  const [showResults, setShowResults] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  // 追蹤頁面瀏覽和功能使用
  usePageViewTracking('/fbaudit', 'fbaudit', { locale, step: currentStep });
  const { trackAccountSelection, trackPlanSelection, trackHealthCheck, trackNPSRating } = useFbAuditTracking('/fbaudit');

  // 只有在用戶已認證且有 Facebook access token 時才載入帳戶
  const shouldLoadAccounts = Boolean(isAuthenticated && user?.hasFacebookAuth);
  const { data: accounts, isLoading: accountsLoading } = useFbAuditAccounts(shouldLoadAccounts);
  const { data: plans, isLoading: plansLoading, refetch: refetchPlans } = useFbAuditPlans(isAuthenticated, false);
  const { data: industries } = useFbAuditIndustries();
  const checkMutation = useFbAuditCheck();
  const streamAudit = useFbAuditStream();

  // 處理從計算機頁面返回的情況
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const step = urlParams.get('step');
    const account = urlParams.get('account');
    const industry = urlParams.get('industry');
    const newPlan = urlParams.get('newPlan');

    if (step === '3' && account && industry) {
      setSelectedAccount(account);
      setSelectedIndustry(industry);
      setCurrentStep(3);
      
      // 如果有新建立的計劃，強制重新載入計劃資料並選擇新計劃
      if (newPlan) {
        console.log('偵測到新建立的計劃，重新載入計劃資料:', newPlan);
        // 清除快取並重新載入計劃資料
        queryClient.invalidateQueries({ queryKey: ['/api/fbaudit/plans'] });
        queryClient.invalidateQueries({ queryKey: ['/api/plan-results'] });
        
        // 強制重新載入並等待完成
        setTimeout(() => {
          refetchPlans().then(() => {
            setSelectedPlan(newPlan);
            console.log('已選擇新建立的計劃:', newPlan);
          });
        }, 100); // 給一點時間讓快取清除生效
      }
    }
  }, [queryClient, refetchPlans]);

  const handleStartAudit = async () => {
    if (!selectedAccount || !selectedPlan || !selectedIndustry) {
      return;
    }

    try {
      console.log('開始載入儀表板...', {
        selectedAccount,
        selectedPlan,
        selectedIndustry
      });
      
      // 追蹤儀表板載入
      trackHealthCheck(selectedAccount, selectedPlan, selectedIndustry);
      
      const result = await checkMutation.mutateAsync({
        adAccountId: selectedAccount,
        planResultId: selectedPlan,
        industryType: selectedIndustry,
        locale
      });

      console.log('儀表板載入成功:', result);
      setShowResults(true);
    } catch (error) {
      console.error('載入儀表板失敗:', error);
      // 即使失敗也要有清楚的錯誤顯示
      alert('儀表板載入失敗');
    }
  };

  const isConnected = user?.hasFacebookAuth;
  const hasPlans = plans && plans.length > 0;
  const canStartAudit = selectedAccount && selectedPlan && selectedIndustry;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavigationBar locale={locale} />
        <div className="container mx-auto p-6 max-w-4xl">
          <div className="text-center py-20">
            <Facebook className="w-16 h-16 text-blue-600 mx-auto mb-6" />
            <h1 className="text-3xl font-bold mb-4">Meta 廣告儀表板</h1>
            <p className="text-gray-600 mb-8">請先登入以查看您的廣告數據</p>
            <Button size="lg" onClick={() => window.location.href = '/api/auth/google'}>
              Google 登入
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  // 調試前端狀態
  console.log('前端狀態檢查:', {
    showResults,
    hasData: !!checkMutation.data,
    mutationStatus: checkMutation.status,
    isLoading: checkMutation.isPending
  });

  if (showResults && checkMutation.data) {
    console.log('儀表板結果數據:', checkMutation.data);
    
    return (
      <div className="min-h-screen bg-gray-50">
        <NavigationBar locale={locale} />
        <div className="container mx-auto p-6 max-w-6xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Meta 廣告儀表板結果</h1>
            <p className="text-gray-600">基於您的廣告數據分析</p>
          </div>

          {/* 儀表板數據概覽 */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                廣告效果概覽
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <div className="text-sm text-gray-600 mb-1">日均花費</div>
                  <div className="text-2xl font-bold text-blue-600 mb-1">
                    {(checkMutation.data as any)?.actualMetrics?.dailySpend?.toLocaleString() || '0'}
                  </div>
                  <div className="text-xs text-gray-500">
                    目標: {(checkMutation.data as any)?.comparisons?.find((c: any) => c.metric === 'dailySpend')?.target?.toLocaleString() || '0'}
                  </div>
                </div>
                
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <div className="text-sm text-gray-600 mb-1">ROAS</div>
                  <div className="text-2xl font-bold text-green-600 mb-1">
                    {(checkMutation.data as any)?.actualMetrics?.roas?.toFixed(2) || '0.00'}x
                  </div>
                  <div className="text-xs text-gray-500">
                    目標: {((checkMutation.data as any)?.comparisons?.find((c: any) => c.metric === 'roas')?.target || 0).toFixed(2)}x
                  </div>
                </div>
                
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <div className="text-sm text-gray-600 mb-1">每日購買數</div>
                  <div className="text-2xl font-bold text-purple-600 mb-1">
                    {(checkMutation.data as any)?.actualMetrics?.purchases?.toFixed(0) || '0'}
                  </div>
                  <div className="text-xs text-gray-500">
                    目標: {((checkMutation.data as any)?.comparisons?.find((c: any) => c.metric === 'purchases')?.target || 0).toFixed(0)}
                  </div>
                </div>
                
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <div className="text-sm text-gray-600 mb-1">連結點擊率</div>
                  <div className="text-2xl font-bold text-orange-600 mb-1">
                    {(checkMutation.data as any)?.actualMetrics?.ctr?.toFixed(2) || '0.00'}%
                  </div>
                  <div className="text-xs text-gray-500">
                    目標: {((checkMutation.data as any)?.comparisons?.find((c: any) => c.metric === 'ctr')?.target || 0).toFixed(2)}%
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 操作按鈕 */}
          <div className="text-center">
            <Button 
              onClick={() => {
                setShowResults(false);
                setCurrentStep(1);
                setSelectedAccount("");
                setSelectedPlan("");
                setSelectedIndustry("");
              }}
              variant="outline"
              className="mr-4"
            >
              重新分析
            </Button>
            <Button onClick={() => window.location.href = '/dashboard'}>
              返回儀表板
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavigationBar locale={locale} />
      
      <div className="container mx-auto p-6 max-w-4xl">
        {/* 頁面標題 */}
        <div className="text-center mb-12">
          <Facebook className="w-16 h-16 text-blue-600 mx-auto mb-6" />
          <h1 className="text-4xl font-bold mb-4">Meta 廣告儀表板</h1>
          <p className="text-xl text-gray-600 mb-6">
            深度分析您的 Facebook 廣告數據，優化投資回報率
          </p>
          
          {/* 安全提示 */}
          <Alert className="max-w-2xl mx-auto mb-8">
            <Shield className="h-4 w-4" />
            <AlertDescription>
              我們使用官方 API 安全連接，您的數據完全保密
            </AlertDescription>
          </Alert>
        </div>

        {/* 步驟進度 */}
        <div className="mb-8">
          <div className="flex items-center justify-center space-x-4 mb-4">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${
                  currentStep >= step
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-gray-300 text-gray-400'
                }`}
              >
                {step}
              </div>
            ))}
          </div>
          <div className="text-center text-sm text-gray-600">
            {currentStep === 1 && 'Facebook 連接'}
            {currentStep === 2 && '選擇廣告帳戶'}
            {currentStep === 3 && '選擇分析計劃'}
            {currentStep === 4 && '選擇行業類型'}
          </div>
        </div>

        {/* 步驟 1: Facebook 連接 */}
        {currentStep === 1 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Facebook className="w-5 h-5" />
                Facebook 連接
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!isConnected ? (
                <div className="text-center py-8">
                  <p className="text-gray-600 mb-6">
                    請連接您的 Facebook 廣告帳戶以開始分析
                  </p>
                  <FacebookLoginButton />
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
                  <p className="text-green-600 font-medium mb-4">Facebook 已連接</p>
                  <Button onClick={() => setCurrentStep(2)}>
                    下一步：選擇廣告帳戶
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 步驟 2: 選擇廣告帳戶 */}
        {currentStep === 2 && isConnected && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                選擇廣告帳戶
              </CardTitle>
            </CardHeader>
            <CardContent>
              {accountsLoading ? (
                <div className="text-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  <p className="text-gray-600">載入廣告帳戶中...</p>
                </div>
              ) : accounts && accounts.length > 0 ? (
                <div className="space-y-4">
                  <FacebookAccountSelector 
                    onAccountSelected={(accountId) => {
                      setSelectedAccount(accountId);
                      const account = accounts.find((a: any) => a.id === accountId);
                      trackAccountSelection(accountId, account?.name || 'Unknown');
                    }}
                    accounts={accounts}
                    isLoading={accountsLoading}
                    useExternalData={true}
                  />
                  
                  {selectedAccount && (
                    <div className="text-center pt-4">
                      <Button onClick={() => setCurrentStep(3)}>
                        下一步：選擇分析計劃
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <AlertTriangle className="w-12 h-12 text-yellow-600 mx-auto mb-4" />
                  <p className="text-yellow-600 font-medium">未找到廣告帳戶</p>
                  <p className="text-gray-600 text-sm">請確保您的 Facebook 帳戶有廣告帳戶存取權限</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 步驟 3: 選擇分析計劃 */}
        {currentStep === 3 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                選擇分析計劃
              </CardTitle>
            </CardHeader>
            <CardContent>
              {plansLoading ? (
                <div className="text-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  <p className="text-gray-600">載入預算計劃中...</p>
                </div>
              ) : hasPlans ? (
                <div className="space-y-4">
                  <Select value={selectedPlan} onValueChange={(value) => {
                    if (value === 'create_new_plan') {
                      // 跳轉到計算機頁面，並帶上返回參數
                      const returnUrl = `/fbaudit?step=3&account=${selectedAccount}&industry=${selectedIndustry}`;
                      window.location.href = `/calculator?returnTo=${encodeURIComponent(returnUrl)}`;
                    } else {
                      setSelectedPlan(value);
                      const plan = plans.find((p: any) => p.id === value);
                      trackPlanSelection(value, plan?.planName || 'Unknown');
                    }
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder="選擇一個計劃" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.map((plan: any) => (
                        <SelectItem key={plan.id} value={plan.id}>
                          {plan.planName} (目標 ROAS: {plan.targetRoas}x)
                        </SelectItem>
                      ))}
                      <SelectItem value="create_new_plan" className="text-blue-600 font-medium">
                        {locale === 'zh-TW' ? '+ 新增計劃' : locale === 'en' ? '+ Create New Plan' : '+ 新しいプランを作成'}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  
                  {selectedPlan && (
                    <div className="text-center pt-4">
                      <Button onClick={() => setCurrentStep(4)}>
                        下一步：選擇行業類型
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <AlertTriangle className="w-12 h-12 text-blue-600 mx-auto mb-4" />
                  <p className="text-blue-600 font-medium mb-4">尚未建立預算計劃</p>
                  <p className="text-gray-600 mb-6">
                    需要先建立預算計劃才能進行儀表板分析
                  </p>
                  <Button onClick={() => {
                    const returnUrl = `/fbaudit?step=3&account=${selectedAccount}&industry=${selectedIndustry}`;
                    window.location.href = `/calculator?returnTo=${encodeURIComponent(returnUrl)}`;
                  }}>
                    {locale === 'zh-TW' ? '前往建立預算計劃' : locale === 'en' ? 'Go to Create Campaign Plan' : 'キャンペーンプラン作成へ'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 步驟 4: 選擇行業類型 */}
        {currentStep === 4 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                選擇行業類型
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Select value={selectedIndustry} onValueChange={setSelectedIndustry}>
                  <SelectTrigger>
                    <SelectValue placeholder="選擇您的行業" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.isArray(industries) && industries.map((industry: any) => {
                      // 根據語言顯示產業名稱
                      const getIndustryName = (industry: any, locale: string) => {
                        if (locale === 'en') {
                          return industry.nameEn || industry.name;
                        } else if (locale === 'ja') {
                          // 日文產業類型翻譯
                          const jaTranslations: Record<string, string> = {
                            '藝文娛樂': 'アート・エンターテイメント',
                            '餐飲食品': '飲食・食品',
                            '寵物用品': 'ペット用品',
                            '購物、收藏品與禮品': 'ショッピング・コレクション・ギフト',
                            '健康與健身': 'ヘルス・フィットネス',
                            '美妝保養': '美容・スキンケア',
                            '家居與園藝': 'ホーム・ガーデン',
                            '家具': '家具',
                            '服飾／時尚與珠寶': 'ファッション・ジュエリー',
                            '工業與商業用品': '産業・商業用品',
                            '其他': 'その他'
                          };
                          return jaTranslations[industry.name] || industry.name;
                        } else {
                          return industry.name;
                        }
                      };

                      const displayName = getIndustryName(industry, locale);
                      
                      return (
                        <SelectItem key={industry.id} value={industry.id}>
                          {displayName}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                
                {selectedIndustry && (
                  <div className="text-center pt-4">
                    <Button 
                      onClick={handleStartAudit}
                      disabled={!canStartAudit || checkMutation.isPending}
                      size="lg"
                      className="px-8"
                    >
                      {checkMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          分析中...
                        </>
                      ) : (
                        <>
                          <BarChart3 className="w-4 h-4 mr-2" />
                          {t.startHealthCheck || '開始分析'}
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 載入狀態 */}
        {checkMutation.isPending && (
          <Card>
            <CardContent className="text-center py-12">
              <div className="mb-6">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              </div>
              <h3 className="text-lg font-medium mb-2">{t.analyzingYourData || '正在分析您的廣告數據'}</h3>
              <p className="text-gray-600 mb-6">{t.analyzingDescription || '這可能需要幾分鐘時間，請稍候...'}</p>
              
              <div className="max-w-md mx-auto">
                <Progress value={75} className="mb-2" />
                <p className="text-sm text-gray-500">
                  {t.tipTitle || '提示'}：{t.tipMessage || '分析期間請保持頁面開啟'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      
      <Footer />
    </div>
  );
}