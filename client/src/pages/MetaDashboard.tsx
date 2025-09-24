import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import NavigationBar from '@/components/NavigationBar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
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
  Lightbulb,
  DollarSign, 
  Eye, 
  MousePointer, 
  ShoppingCart, 
  Users, 
  PieChart
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
  usePageViewTracking('/meta-dashboard', 'meta-dashboard', { locale, step: currentStep });
  const { trackAccountSelection, trackPlanSelection, trackHealthCheck, trackNPSRating } = useFbAuditTracking('/meta-dashboard');

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

  const handleStartDashboard = async () => {
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

      if (result.success) {
        setShowResults(true);
        console.log('儀表板載入成功');
      } else {
        console.error('儀表板載入失敗:', result.error);
      }
    } catch (error) {
      console.error('載入儀表板時發生錯誤:', error);
    }
  };

  const isConnected = user?.hasFacebookAuth;

  // 如果用戶未登入，顯示登入提示
  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <NavigationBar locale={locale} />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-md mx-auto text-center space-y-6">
            <div className="mx-auto w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <BarChart3 className="w-10 h-10 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
                Meta 廣告儀表板
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                請先登入以查看您的廣告數據
              </p>
            </div>
            <Button 
              onClick={() => window.location.href = '/api/auth/google'}
              className="w-full"
            >
              <Users className="w-4 h-4 mr-2" />
              Google 登入
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  // 如果用戶已登入但未連接 Facebook，顯示連接提示
  if (isAuthenticated && !user?.hasFacebookAuth) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <NavigationBar locale={locale} />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <div className="text-center space-y-6">
              <div className="mx-auto w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                <Facebook className="w-10 h-10 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
                  連接您的 Facebook 廣告帳戶
                </h1>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  請連接您的 Facebook 廣告帳戶以查看廣告數據和儀表板
                </p>
              </div>
              
              {/* 步驟指示器 */}
              <div className="flex justify-center items-center space-x-4 my-8">
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-4 h-4 text-white" />
                  </div>
                  <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Google 登入</span>
                </div>
                <div className="w-8 h-0.5 bg-gray-300 dark:bg-gray-600"></div>
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                    <span className="text-sm font-bold text-white">2</span>
                  </div>
                  <span className="ml-2 text-sm text-blue-600 dark:text-blue-400 font-medium">Facebook 連接</span>
                </div>
                <div className="w-8 h-0.5 bg-gray-300 dark:bg-gray-600"></div>
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-gray-300 dark:bg-gray-600 rounded-full flex items-center justify-center">
                    <span className="text-sm font-bold text-gray-500">3</span>
                  </div>
                  <span className="ml-2 text-sm text-gray-500">查看儀表板</span>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg">
                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <Shield className="w-5 h-5 text-green-500 mt-0.5" />
                    <div className="text-left">
                      <h3 className="font-semibold text-gray-900 dark:text-white">安全連接</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        我們使用 Facebook 官方 API，確保您的資料安全
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <BarChart3 className="w-5 h-5 text-blue-500 mt-0.5" />
                    <div className="text-left">
                      <h3 className="font-semibold text-gray-900 dark:text-white">即時數據</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        獲取最新的廣告數據和效果分析
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <Lightbulb className="w-5 h-5 text-yellow-500 mt-0.5" />
                    <div className="text-left">
                      <h3 className="font-semibold text-gray-900 dark:text-white">智能洞察</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        AI 驅動的建議幫您優化廣告效果
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  <FacebookLoginButton />
                </div>
              </div>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  // 如果已連接 Facebook 但沒有可用帳戶
  if (isAuthenticated && user?.hasFacebookAuth && !accountsLoading && (!accounts || accounts.length === 0)) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <NavigationBar locale={locale} />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <div className="mx-auto w-20 h-20 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center">
              <XCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
                未找到廣告帳戶
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                我們無法找到與您的 Facebook 帳戶關聯的廣告帳戶
              </p>
            </div>
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                請確保您的 Facebook 帳戶有廣告帳戶存取權限，或聯繫廣告帳戶管理員為您添加權限。
              </AlertDescription>
            </Alert>
            <Button 
              onClick={() => window.location.reload()}
              variant="outline"
            >
              重新檢查
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  // 如果正在載入帳戶或顯示結果
  if (accountsLoading || showResults) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <NavigationBar locale={locale} />
        <div className="container mx-auto px-4 py-8">
          {accountsLoading ? (
            <div className="max-w-2xl mx-auto text-center space-y-6">
              <Loader2 className="w-12 h-12 animate-spin mx-auto text-blue-500" />
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  載入您的廣告帳戶
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  正在從 Facebook 獲取您的廣告帳戶資訊...
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                  Meta 廣告儀表板
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  廣告帳戶: {accounts?.find((acc: any) => acc.id === selectedAccount)?.name}
                </p>
              </div>
              
              {/* 這裡會顯示實際的儀表板數據 */}
              <Card>
                <CardHeader>
                  <CardTitle>儀表板數據載入中...</CardTitle>
                  <CardDescription>正在分析您的廣告數據</CardDescription>
                </CardHeader>
                <CardContent>
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500" />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
        <Footer />
      </div>
    );
  }

  // 主要的選擇介面（步驟 2 和 3）
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <NavigationBar locale={locale} />
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* 標題和進度 */}
          <div className="text-center space-y-6 mb-8">
            <div className="mx-auto w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <BarChart3 className="w-10 h-10 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3">
                Meta 廣告儀表板
              </h1>
              <p className="text-xl text-gray-600 dark:text-gray-400">
                深度分析您的 Facebook 廣告數據，優化投資回報率
              </p>
            </div>

            {/* 步驟指示器 */}
            <div className="flex justify-center items-center space-x-4 my-8">
              <div className="flex items-center">
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-4 h-4 text-white" />
                </div>
                <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Google 登入</span>
              </div>
              <div className="w-8 h-0.5 bg-gray-300 dark:bg-gray-600"></div>
              <div className="flex items-center">
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-4 h-4 text-white" />
                </div>
                <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Facebook 連接</span>
              </div>
              <div className="w-8 h-0.5 bg-gray-300 dark:bg-gray-600"></div>
              <div className="flex items-center">
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-white">3</span>
                </div>
                <span className="ml-2 text-sm text-blue-600 dark:text-blue-400 font-medium">設置儀表板</span>
              </div>
            </div>
          </div>

          {/* 設置表單 */}
          <div className="space-y-6">
            {/* 帳戶選擇 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Target className="w-5 h-5" />
                  <span>選擇廣告帳戶</span>
                </CardTitle>
                <CardDescription>
                  選擇您要分析的 Facebook 廣告帳戶
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FacebookAccountSelector
                  accounts={accounts || []}
                  onAccountSelected={(accountId: string) => {
                    setSelectedAccount(accountId);
                    trackAccountSelection(accountId, selectedPlan);
                  }}
                  isLoading={accountsLoading}
                />
              </CardContent>
            </Card>

            {/* 計劃選擇 */}
            {selectedAccount && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <BarChart3 className="w-5 h-5" />
                    <span>選擇分析計劃</span>
                  </CardTitle>
                  <CardDescription>
                    選擇已儲存的計劃結果進行對比分析
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {plansLoading ? (
                    <div className="flex items-center space-x-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>載入計劃中...</span>
                    </div>
                  ) : plans && plans.length > 0 ? (
                    <Select
                      value={selectedPlan}
                      onValueChange={(value: string) => {
                        setSelectedPlan(value);
                        trackPlanSelection(value, selectedAccount);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="選擇一個計劃" />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((plan: any) => (
                          <SelectItem key={plan.id} value={plan.id}>
                            <div className="flex items-center justify-between w-full">
                              <span>{plan.name}</span>
                              <Badge variant="outline" className="ml-2">
                                {plan.period}天
                              </Badge>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        您還沒有任何已儲存的計劃。請先使用預算計算機建立計劃。
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 行業選擇 */}
            {selectedAccount && selectedPlan && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Lightbulb className="w-5 h-5" />
                    <span>選擇行業類型</span>
                  </CardTitle>
                  <CardDescription>
                    選擇您的行業以獲得更精確的分析和建議
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {industries ? (
                    <Select
                      value={selectedIndustry}
                      onValueChange={setSelectedIndustry}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="選擇您的行業" />
                      </SelectTrigger>
                      <SelectContent>
                        {industries.map((industry: any) => (
                          <SelectItem key={industry.id} value={industry.id}>
                            {industry.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Skeleton className="h-10 w-full" />
                  )}
                </CardContent>
              </Card>
            )}

            {/* 開始按鈕 */}
            {selectedAccount && selectedPlan && selectedIndustry && (
              <div className="text-center">
                <Button
                  onClick={handleStartDashboard}
                  disabled={checkMutation.isPending}
                  size="lg"
                  className="px-8 py-3"
                >
                  {checkMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      載入儀表板中...
                    </>
                  ) : (
                    <>
                      <BarChart3 className="w-4 h-4 mr-2" />
                      查看儀表板
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}