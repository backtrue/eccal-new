import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Facebook, CheckCircle, Loader2, Target, AlertTriangle, TrendingUp, DollarSign, Users, BarChart3, ShoppingCart, MessageSquare, UserPlus, Calendar, Filter, Sparkles } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import NavigationBar from '@/components/NavigationBar';
import Footer from '@/components/Footer';
import FacebookLoginButton from '@/components/FacebookLoginButton';
import FacebookAccountSelector from '@/components/FacebookAccountSelector';
import { useFbAuditAccounts } from '@/hooks/useFbAudit';
import type { Locale } from '@/lib/i18n';
import { getTranslations } from '@/lib/i18n';

interface MetaDashboardProps {
  locale: Locale;
}

export default function MetaDashboard({ locale }: MetaDashboardProps) {
  const t = getTranslations(locale);
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [isRefreshingAuth, setIsRefreshingAuth] = useState(false);

  // 完全按照 fbaudit 的做法檢查連接狀態
  const isConnected = Boolean(isAuthenticated && user?.hasFacebookAuth);
  
  // 完全按照 fbaudit 的做法載入帳戶
  const shouldLoadAccounts = Boolean(isAuthenticated && user?.hasFacebookAuth);
  const { 
    data: accounts, 
    isLoading: accountsLoading, 
    error: accountsError 
  } = useFbAuditAccounts(shouldLoadAccounts);

  // 檢測 Facebook token 失效錯誤
  const hasFacebookTokenError = Boolean(accountsError && 
    ((accountsError as any)?.message?.includes('500') || 
     (accountsError as any)?.message?.includes('401') ||
     (accountsError as any)?.message?.includes('TOKEN_EXPIRED')));

  // 當檢測到 Facebook 帳戶載入錯誤且用戶有認證時，強制回到步驟 1 重新授權
  if (hasFacebookTokenError && isAuthenticated && currentStep === 2) {
    console.log('Facebook token expired - redirecting to step 1 for re-authorization');
  }

  // 保存廣告帳戶選擇到資料庫
  const saveAdAccountMutation = useMutation({
    mutationFn: async (adAccountId: string) => {
      return await apiRequest('POST', '/api/diagnosis/set-ad-account', { 
        adAccountId 
      });
    },
    onSuccess: () => {
      // 使認證狀態失效，強制重新載入用戶資料
      queryClient.invalidateQueries({ queryKey: ['/api/auth/check'] });
      // 進入儀表板
      setCurrentStep(3);
    },
    onError: (error) => {
      console.error('保存廣告帳戶失敗:', error);
    }
  });

  // 儀表板配置狀態
  const [businessType, setBusinessType] = useState<'ecommerce' | 'consultation' | 'lead_generation'>('ecommerce');
  const [level, setLevel] = useState<'account' | 'campaign' | 'adset' | 'ad'>('account');
  const [dateRange, setDateRange] = useState({
    since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    until: new Date().toISOString().split('T')[0]
  });

  // GPT 分析狀態
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  // 強制刷新認證狀態
  const refreshAuthStatus = async () => {
    setIsRefreshingAuth(true);
    try {
      console.log('🔄 強制刷新認證狀態中...');
      
      // 清除所有認證相關的查詢緩存
      await queryClient.invalidateQueries({ queryKey: ['/api/auth/check'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/fbaudit/accounts'] });
      
      // 等待一段時間讓查詢重新執行
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('✅ 認證狀態已刷新');
    } catch (error) {
      console.error('❌ 刷新認證狀態失敗:', error);
    } finally {
      setIsRefreshingAuth(false);
    }
  };

  // 保存業務類型的mutation
  const saveBusinessTypeMutation = useMutation({
    mutationFn: (newBusinessType: string) => apiRequest('POST', '/api/meta/business-type', { businessType: newBusinessType }),
    onSuccess: () => {
      // 成功保存後重新獲取dashboard數據
      queryClient.invalidateQueries({
        queryKey: ['/api/meta/dashboard']
      });
    },
    onError: (error) => {
      console.error('保存業務類型失敗:', error);
    }
  });
  
  // 載入用戶保存的業務類型
  const { 
    data: savedBusinessType, 
    isLoading: businessTypeLoading 
  } = useQuery({
    queryKey: ['/api/meta/business-type'],
    enabled: currentStep === 3 && !!selectedAccount,
    staleTime: 5 * 60 * 1000 // 5分鐘緩存
  });

  // 載入 Meta 廣告儀表板數據
  const { 
    data: dashboardStats, 
    isLoading: statsLoading, 
    error: statsError 
  } = useQuery<any>({
    queryKey: [`/api/meta/dashboard?businessType=${businessType}&level=${level}&since=${dateRange.since}&until=${dateRange.until}`],
    enabled: currentStep === 3 && !!selectedAccount
  });

  // 處理進入儀表板
  const handleEnterDashboard = () => {
    if (selectedAccount) {
      saveAdAccountMutation.mutate(selectedAccount);
    }
  };

  // 當載入保存的業務類型時，自動設置到狀態
  useEffect(() => {
    if ((savedBusinessType as any)?.businessType && (savedBusinessType as any).businessType !== businessType) {
      setBusinessType((savedBusinessType as any).businessType as 'ecommerce' | 'consultation' | 'lead_generation');
    }
  }, [savedBusinessType]);

  // 處理 Facebook OAuth 回調成功
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const hasFacebookAuthSuccess = urlParams.has('facebook_auth_success');
    
    if (hasFacebookAuthSuccess) {
      console.log('檢測到 facebook_auth_success 參數，刷新認證狀態');
      
      // 清除 URL 參數
      window.history.replaceState({}, '', window.location.pathname);
      
      // 刷新認證狀態
      setTimeout(() => {
        refreshAuthStatus();
      }, 500);
    }
  }, []);

  // 處理業務類型變更
  const handleBusinessTypeChange = (newBusinessType: 'ecommerce' | 'consultation' | 'lead_generation') => {
    setBusinessType(newBusinessType);
    // 自動保存到後端
    saveBusinessTypeMutation.mutate(newBusinessType);
  };


  // 處理GPT分析
  const handleGptAnalysis = async () => {
    if (!(dashboardStats as any)?.data) return;

    setIsAnalyzing(true);
    try {
      const response = await apiRequest('POST', '/api/meta/ai-analysis', {
        dashboardData: (dashboardStats as any).data,
        businessType,
        level,
        dateRange
      });
      
      const result = await response.json();
      setAnalysisResult(result.data);
      setShowAnalysis(true);
    } catch (error) {
      console.error('AI 分析失敗:', error);
      // 可以添加錯誤提示
    } finally {
      setIsAnalyzing(false);
    }
  };


  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavigationBar locale={locale} />
        <div className="container mx-auto p-6 max-w-4xl">
          <div className="text-center py-20">
            <Facebook className="w-16 h-16 text-blue-600 mx-auto mb-6" />
            <h1 className="text-3xl font-bold mb-4">Meta 廣告儀表板</h1>
            <p className="text-gray-600 mb-8">請先登入以使用儀表板功能</p>
            <Button size="lg" onClick={() => window.location.href = '/api/auth/google'}>
              使用 Google 登入
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
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Meta 廣告儀表板</h1>
          <p className="text-gray-600">連接您的 Facebook 廣告帳戶以開始分析</p>
        </div>

        {/* 步驟指示器 */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-8 mb-4">
            {[1, 2, 3].map((step) => (
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
            {currentStep === 1 && "連接 Facebook 廣告帳戶"}
            {currentStep === 2 && "選擇廣告帳戶"}
            {currentStep === 3 && "檢視儀表板"}
          </div>
        </div>

        {/* 步驟 1: Facebook 連接 */}
        {currentStep === 1 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Facebook className="w-5 h-5" />
                連接 Facebook 廣告帳戶
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!isConnected || hasFacebookTokenError ? (
                <div className="text-center py-8">
                  {hasFacebookTokenError ? (
                    <>
                      <AlertTriangle className="w-12 h-12 text-red-600 mx-auto mb-4" />
                      <p className="text-red-600 font-medium mb-4">Facebook 授權已過期</p>
                      <p className="text-gray-600 text-sm mb-6">
                        您的 Facebook 授權已失效，請重新連接以繼續使用
                      </p>
                    </>
                  ) : (
                    <p className="text-gray-600 mb-6">
                      請授權您的 Facebook 廣告帳戶存取權限
                    </p>
                  )}
                  <div className="flex flex-col items-center">
                    <FacebookLoginButton />
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
                  <p className="text-green-600 font-medium mb-4">Facebook 已成功連接</p>
                  <div className="space-y-3">
                    <Button onClick={() => setCurrentStep(2)}>
                      下一步：選擇廣告帳戶
                    </Button>
                    <div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={refreshAuthStatus}
                        disabled={isRefreshingAuth}
                        className="text-xs"
                      >
                        {isRefreshingAuth ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            檢查中...
                          </>
                        ) : (
                          '🔄 重新檢查連接狀態'
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      如果連接有問題，請點擊「重新檢查連接狀態」
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 步驟 2: 廣告帳戶選擇 */}
        {currentStep === 2 && isConnected && !hasFacebookTokenError && (
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
                  <p className="text-gray-600">載入廣告帳號中...</p>
                </div>
              ) : accounts && accounts.length > 0 ? (
                <div className="space-y-4">
                  <FacebookAccountSelector 
                    onAccountSelected={(accountId) => {
                      setSelectedAccount(accountId);
                    }}
                    accounts={accounts}
                    isLoading={accountsLoading}
                    useExternalData={true}
                  />
                  
                  {selectedAccount && (
                    <div className="text-center pt-4">
                      <Button 
                        onClick={handleEnterDashboard}
                        disabled={saveAdAccountMutation.isPending}
                      >
                        {saveAdAccountMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            保存中...
                          </>
                        ) : (
                          '進入儀表板'
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <AlertTriangle className="w-12 h-12 text-yellow-600 mx-auto mb-4" />
                  <p className="text-yellow-600 font-medium">未找到廣告帳戶</p>
                  <p className="text-gray-600 text-sm">請確認您的 Facebook 權限設定</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 步驟 3: 完整分類儀表板 */}
        {currentStep === 3 && selectedAccount && (
          <div className="space-y-6">
            {/* 儀表板控制面板 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5" />
                  Meta 廣告分析儀表板
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
                  {/* 業務類型選擇 */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-600 flex items-center gap-2">
                      業務類型
                      {saveBusinessTypeMutation.isPending && (
                        <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                      )}
                    </label>
                    <Select 
                      value={businessType} 
                      onValueChange={handleBusinessTypeChange}
                      disabled={businessTypeLoading || saveBusinessTypeMutation.isPending}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ecommerce">
                          <div className="flex items-center gap-2">
                            <ShoppingCart className="w-4 h-4" />
                            電商
                          </div>
                        </SelectItem>
                        <SelectItem value="consultation">
                          <div className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4" />
                            線上諮詢
                          </div>
                        </SelectItem>
                        <SelectItem value="lead_generation">
                          <div className="flex items-center gap-2">
                            <UserPlus className="w-4 h-4" />
                            名單收集
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 數據維度選擇 */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-600">維度</label>
                    <Select value={level} onValueChange={(value: 'account' | 'campaign' | 'adset' | 'ad') => setLevel(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="account">廣告帳戶</SelectItem>
                        <SelectItem value="campaign">行銷活動</SelectItem>
                        <SelectItem value="adset">廣告組合</SelectItem>
                        <SelectItem value="ad">廣告</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 開始日期 */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-600">開始日期</label>
                    <input 
                      type="date" 
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" 
                      value={dateRange.since}
                      onChange={(e) => setDateRange(prev => ({ ...prev, since: e.target.value }))}
                    />
                  </div>

                  {/* 結束日期 */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-600">結束日期</label>
                    <input 
                      type="date" 
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" 
                      value={dateRange.until}
                      onChange={(e) => setDateRange(prev => ({ ...prev, until: e.target.value }))}
                    />
                  </div>

                  {/* 帳戶切換 */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-600">已選擇帳戶</label>
                    <Select 
                      value={selectedAccount} 
                      onValueChange={(value) => {
                        setSelectedAccount(value);
                        // 自動保存新的廣告帳戶選擇
                        saveAdAccountMutation.mutate(value);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="選擇廣告帳戶" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts?.map((account: any) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name || account.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* GPT 分析按鈕 */}
                  <Button 
                    className="h-10" 
                    variant="outline"
                    onClick={handleGptAnalysis}
                    disabled={isAnalyzing || !dashboardStats}
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        分析中...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        ＡＩ成效分析
                      </>
                    )}
                  </Button>
                </div>

                {/* 時間範圍快捷選項 */}
                <div className="flex gap-2 mt-4 pt-4 border-t">
                  <span className="text-sm text-gray-600 mr-2">快捷時間：</span>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setDateRange({
                      since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                      until: new Date().toISOString().split('T')[0]
                    })}
                  >
                    近 7 天
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setDateRange({
                      since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                      until: new Date().toISOString().split('T')[0]
                    })}
                  >
                    近 30 天
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setDateRange({
                      since: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                      until: new Date().toISOString().split('T')[0]
                    })}
                  >
                    近 90 天
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 載入狀態 */}
            {statsLoading ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                    <p className="text-gray-600">正在載入廣告數據...</p>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* 錯誤狀態 */}
            {Boolean(statsError) ? (
              <Card className="border-red-200">
                <CardContent className="pt-6">
                  <div className="text-center py-8">
                    <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-4" />
                    <p className="text-red-600 font-medium mb-2">載入廣告數據失敗</p>
                    <p className="text-gray-600 text-sm">請稍後再試或檢查您的 Facebook 權限</p>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* 完整分類指標儀表板 */}
            {Boolean(dashboardStats) ? (
              <>
                {/* 共同核心指標 */}
                <Card>
                  <CardHeader>
                    <CardTitle>核心廣告指標</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 justify-items-center max-w-4xl mx-auto">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">
                          ${(dashboardStats as any)?.data?.overview?.totalSpend?.toLocaleString() || '0'}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">花費金額</p>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">
                          {(dashboardStats as any)?.data?.overview?.totalImpressions?.toLocaleString() || '0'}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">曝光數</p>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-orange-600">
                          {(dashboardStats as any)?.data?.overview?.totalClicks?.toLocaleString() || '0'}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">連結點擊</p>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-600">
                          {(dashboardStats as any)?.data?.metrics?.ctr?.toFixed(2) || '0'}%
                        </div>
                        <p className="text-sm text-gray-600 mt-1">連結 CTR</p>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-indigo-600">
                          ${(dashboardStats as any)?.data?.metrics?.cpc?.toFixed(2) || '0'}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">連結點擊成本</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 🎯 新增：維度切換數據表格 */}
                {level !== 'account' && Boolean(dashboardStats?.data?.detailData) && dashboardStats.data.detailData.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="w-5 h-5" />
                        {level === 'campaign' ? '行銷活動' : level === 'adset' ? '廣告組合' : '廣告'}明細數據 
                        <span className="text-sm font-normal text-gray-500">
                          ({dashboardStats?.data?.totalItems || 0} 筆)
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left p-2 font-medium">名稱</th>
                              <th className="text-right p-2 font-medium">花費</th>
                              <th className="text-right p-2 font-medium">曝光</th>
                              <th className="text-right p-2 font-medium">點擊</th>
                              <th className="text-right p-2 font-medium">CTR</th>
                              <th className="text-right p-2 font-medium">CPC</th>
                              
                              {/* 電商專用列 */}
                              {businessType === 'ecommerce' && (
                                <>
                                  <th className="text-right p-2 font-medium">瀏覽</th>
                                  <th className="text-right p-2 font-medium">加購</th>
                                  <th className="text-right p-2 font-medium">購買</th>
                                  <th className="text-right p-2 font-medium">ROAS</th>
                                  <th className="text-right p-2 font-medium">ATC%</th>
                                  <th className="text-right p-2 font-medium">PF%</th>
                                </>
                              )}
                              
                              {/* 諮詢專用列 */}
                              {businessType === 'consultation' && (
                                <>
                                  <th className="text-right p-2 font-medium">對話</th>
                                  <th className="text-right p-2 font-medium">對話成本</th>
                                </>
                              )}
                              
                              {/* 名單收集專用列 */}
                              {businessType === 'lead_generation' && (
                                <>
                                  <th className="text-right p-2 font-medium">潛客</th>
                                  <th className="text-right p-2 font-medium">潛客成本</th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {(dashboardStats?.data?.detailData || []).map((item: any, index: number) => (
                              <tr 
                                key={item.id || index} 
                                className="border-b hover:bg-gray-50"
                                data-testid={`row-${level}-${index}`}
                              >
                                <td className="p-2 max-w-[200px] truncate" title={item.name}>
                                  {item.name}
                                </td>
                                <td className="text-right p-2 font-medium text-blue-600">
                                  ${item.spend?.toFixed(2) || '0.00'}
                                </td>
                                <td className="text-right p-2">
                                  {item.impressions?.toLocaleString() || '0'}
                                </td>
                                <td className="text-right p-2">
                                  {item.linkClicks?.toLocaleString() || '0'}
                                </td>
                                <td className="text-right p-2">
                                  {item.ctr?.toFixed(2) || '0.00'}%
                                </td>
                                <td className="text-right p-2">
                                  ${item.cpc?.toFixed(2) || '0.00'}
                                </td>
                                
                                {/* 電商專用數據 */}
                                {businessType === 'ecommerce' && (
                                  <>
                                    <td className="text-right p-2">
                                      {item.viewContent?.toLocaleString() || '0'}
                                    </td>
                                    <td className="text-right p-2">
                                      {item.addToCart?.toLocaleString() || '0'}
                                    </td>
                                    <td className="text-right p-2">
                                      {item.purchase?.toLocaleString() || '0'}
                                    </td>
                                    <td className="text-right p-2 font-medium text-green-600">
                                      {item.roas?.toFixed(2) || '0.00'}
                                    </td>
                                    <td className="text-right p-2">
                                      {item.atcRate?.toFixed(1) || '0.0'}%
                                    </td>
                                    <td className="text-right p-2">
                                      {item.pfRate?.toFixed(1) || '0.0'}%
                                    </td>
                                  </>
                                )}
                                
                                {/* 諮詢專用數據 */}
                                {businessType === 'consultation' && (
                                  <>
                                    <td className="text-right p-2">
                                      {item.messaging?.toLocaleString() || '0'}
                                    </td>
                                    <td className="text-right p-2">
                                      ${item.costPerMessaging?.toFixed(2) || '0.00'}
                                    </td>
                                  </>
                                )}
                                
                                {/* 名單收集專用數據 */}
                                {businessType === 'lead_generation' && (
                                  <>
                                    <td className="text-right p-2">
                                      {item.leads?.toLocaleString() || '0'}
                                    </td>
                                    <td className="text-right p-2">
                                      ${item.costPerLead?.toFixed(2) || '0.00'}
                                    </td>
                                  </>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      
                      {/* 表格說明 */}
                      <div className="mt-4 text-xs text-gray-500 flex items-center gap-4">
                        <span>💡 提示：數據按花費降序排列</span>
                        <span>🎯 切換「維度」可查看不同層級的詳細數據</span>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                {/* 業務類型專用指標 */}
                <Tabs value={businessType} className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="ecommerce" className="flex items-center gap-2">
                      <ShoppingCart className="w-4 h-4" />
                      電商指標
                    </TabsTrigger>
                    <TabsTrigger value="consultation" className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      諮詢指標
                    </TabsTrigger>
                    <TabsTrigger value="lead_generation" className="flex items-center gap-2">
                      <UserPlus className="w-4 h-4" />
                      名單指標
                    </TabsTrigger>
                  </TabsList>

                  {/* 電商專用指標 */}
                  <TabsContent value="ecommerce" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <ShoppingCart className="w-5 h-5" />
                          電商轉換漏斗
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                          <div className="text-center">
                            <div className="text-3xl font-bold text-blue-600">
                              {(dashboardStats as any)?.data?.overview?.totalViewContent?.toLocaleString() || '0'}
                            </div>
                            <p className="text-sm text-gray-600 mt-1">ViewContent</p>
                            <p className="text-xs text-gray-500">瀏覽商品</p>
                          </div>
                          <div className="text-center">
                            <div className="text-3xl font-bold text-green-600">
                              {(dashboardStats as any)?.data?.overview?.totalAddToCart?.toLocaleString() || '0'}
                            </div>
                            <p className="text-sm text-gray-600 mt-1">AddToCart</p>
                            <p className="text-xs text-gray-500">加入購物車</p>
                          </div>
                          <div className="text-center">
                            <div className="text-3xl font-bold text-purple-600">
                              {(dashboardStats as any)?.data?.overview?.totalPurchase?.toLocaleString() || '0'}
                            </div>
                            <p className="text-sm text-gray-600 mt-1">Purchase</p>
                            <p className="text-xs text-gray-500">完成購買</p>
                          </div>
                          <div className="text-center">
                            <div className="text-3xl font-bold text-orange-600">
                              {(dashboardStats as any)?.data?.metrics?.atcRate?.toFixed(1) || '0'}%
                            </div>
                            <p className="text-sm text-gray-600 mt-1">ATC%</p>
                            <p className="text-xs text-gray-500">加購率</p>
                          </div>
                          <div className="text-center">
                            <div className="text-3xl font-bold text-red-600">
                              {(dashboardStats as any)?.data?.metrics?.pfRate?.toFixed(1) || '0'}%
                            </div>
                            <p className="text-sm text-gray-600 mt-1">PF%</p>
                            <p className="text-xs text-gray-500">完成率</p>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-6 border-t">
                          <div className="text-center">
                            <div className="text-2xl font-bold text-indigo-600">
                              ${(dashboardStats as any)?.data?.metrics?.costPerPurchase?.toFixed(2) || '0'}
                            </div>
                            <p className="text-sm text-gray-600 mt-1">購買成本</p>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-teal-600">
                              ${(dashboardStats as any)?.data?.overview?.totalPurchaseValue?.toLocaleString() || '0'}
                            </div>
                            <p className="text-sm text-gray-600 mt-1">購買價值</p>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-pink-600">
                              {(dashboardStats as any)?.data?.metrics?.roas?.toFixed(2) || '0'}
                            </div>
                            <p className="text-sm text-gray-600 mt-1">ROAS</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* 線上諮詢專用指標 */}
                  <TabsContent value="consultation" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <MessageSquare className="w-5 h-5" />
                          諮詢互動指標
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          <div className="text-center">
                            <div className="text-4xl font-bold text-blue-600">
                              {(dashboardStats as any)?.data?.overview?.totalMessaging?.toLocaleString() || '0'}
                            </div>
                            <p className="text-lg font-medium text-gray-700 mt-2">訊息對話開始次數</p>
                            <p className="text-sm text-gray-500 mt-1">用戶主動發起對話</p>
                          </div>
                          <div className="text-center">
                            <div className="text-4xl font-bold text-green-600">
                              ${(dashboardStats as any)?.data?.metrics?.costPerMessaging?.toFixed(2) || '0'}
                            </div>
                            <p className="text-lg font-medium text-gray-700 mt-2">每次對話成本</p>
                            <p className="text-sm text-gray-500 mt-1">平均獲客成本</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* 名單收集專用指標 */}
                  <TabsContent value="lead_generation" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <UserPlus className="w-5 h-5" />
                          潛在顧客指標
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          <div className="text-center">
                            <div className="text-4xl font-bold text-purple-600">
                              {(dashboardStats as any)?.data?.overview?.totalLeads?.toLocaleString() || '0'}
                            </div>
                            <p className="text-lg font-medium text-gray-700 mt-2">潛在顧客數</p>
                            <p className="text-sm text-gray-500 mt-1">成功收集名單數量</p>
                          </div>
                          <div className="text-center">
                            <div className="text-4xl font-bold text-orange-600">
                              ${(dashboardStats as any)?.data?.metrics?.costPerLead?.toFixed(2) || '0'}
                            </div>
                            <p className="text-lg font-medium text-gray-700 mt-2">潛在顧客取得成本</p>
                            <p className="text-sm text-gray-500 mt-1">每個名單平均成本</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>

                {/* GPT 智能分析結果 */}
                {showAnalysis && analysisResult && (
                  <Card className="border-blue-200 bg-blue-50/50">
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-5 h-5 text-blue-600" />
                          成效攻略AI三步驟智慧分析
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => setShowAnalysis(false)}
                        >
                          ✕
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-8">
                      {/* 第一步：數據解讀 */}
                      {analysisResult.dataInterpretation && (
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6 border border-blue-200">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full text-sm font-bold">1</div>
                            <h4 className="text-lg font-semibold text-blue-900">📊 數據解讀</h4>
                          </div>
                          
                          {/* 整體總結 */}
                          <div className="mb-6">
                            <div 
                              className="text-gray-700 bg-white rounded-lg p-4 border border-blue-100"
                              dangerouslySetInnerHTML={{ __html: analysisResult.dataInterpretation.summary }}
                            />
                          </div>

                          {/* 關鍵指標 */}
                          {analysisResult.dataInterpretation.keyMetrics && analysisResult.dataInterpretation.keyMetrics.length > 0 && (
                            <div className="mb-6">
                              <h5 className="font-medium text-gray-800 mb-3">📈 關鍵指標解讀</h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {analysisResult.dataInterpretation.keyMetrics.map((metric: any, index: number) => (
                                  <div key={index} className="bg-white rounded-lg p-4 border border-blue-100">
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="font-medium text-gray-800">{metric.metric}</span>
                                      <span className="text-blue-600 font-bold">{metric.value}</span>
                                    </div>
                                    <p className="text-gray-600 text-sm mb-1">{metric.interpretation}</p>
                                    <p className="text-gray-500 text-xs">{metric.comparison}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 表現排名 */}
                          {analysisResult.dataInterpretation.performanceRanking && analysisResult.dataInterpretation.performanceRanking.length > 0 && (
                            <div>
                              <h5 className="font-medium text-gray-800 mb-3">🏆 表現排名</h5>
                              <div className="space-y-2">
                                {analysisResult.dataInterpretation.performanceRanking.map((item: any, index: number) => (
                                  <div key={index} className="bg-white rounded-lg p-3 border border-blue-100 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <span className={`w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold ${
                                        item.rank === 1 ? 'bg-yellow-500' : item.rank === 2 ? 'bg-gray-400' : item.rank === 3 ? 'bg-orange-400' : 'bg-gray-300'
                                      }`}>
                                        {item.rank}
                                      </span>
                                      <div>
                                        <p className="font-medium text-gray-800">{item.name}</p>
                                        <p className="text-gray-500 text-xs">{item.reason}</p>
                                      </div>
                                    </div>
                                    <span className="text-blue-600 text-sm font-medium">{item.score}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 第二步：洞察發現 */}
                      {analysisResult.insights && (
                        <div className="bg-gradient-to-r from-emerald-50 to-green-50 rounded-lg p-6 border border-emerald-200">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-8 h-8 bg-emerald-600 text-white rounded-full text-sm font-bold">2</div>
                            <h4 className="text-lg font-semibold text-emerald-900">💡 洞察發現</h4>
                          </div>

                          {/* 核心發現 */}
                          {analysisResult.insights.discoveries && analysisResult.insights.discoveries.length > 0 && (
                            <div className="mb-6">
                              <h5 className="font-medium text-gray-800 mb-3">🔍 核心發現</h5>
                              <div className="space-y-4">
                                {analysisResult.insights.discoveries.map((discovery: any, index: number) => (
                                  <div key={index} className="bg-white rounded-lg p-4 border border-emerald-100">
                                    <h6 className="font-medium text-emerald-800 mb-2">{discovery.insight}</h6>
                                    <p className="text-gray-700 text-sm mb-2">{discovery.finding}</p>
                                    <div className="flex flex-wrap gap-2">
                                      <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs rounded-full">
                                        影響：{discovery.impact}
                                      </span>
                                      <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                                        證據：{discovery.evidence}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 機會與風險 */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* 機會點 */}
                            {analysisResult.insights.opportunities && analysisResult.insights.opportunities.length > 0 && (
                              <div>
                                <h5 className="font-medium text-gray-800 mb-3">🚀 機會點</h5>
                                <div className="space-y-3">
                                  {analysisResult.insights.opportunities.map((opp: any, index: number) => (
                                    <div key={index} className="bg-white rounded-lg p-3 border border-green-200">
                                      <h6 className="font-medium text-green-800 text-sm mb-1">{opp.opportunity}</h6>
                                      <p className="text-gray-600 text-xs mb-2">{opp.potential}</p>
                                      <p className="text-gray-500 text-xs">{opp.reasoning}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 風險點 */}
                            {analysisResult.insights.risks && analysisResult.insights.risks.length > 0 && (
                              <div>
                                <h5 className="font-medium text-gray-800 mb-3">⚠️ 風險點</h5>
                                <div className="space-y-3">
                                  {analysisResult.insights.risks.map((risk: any, index: number) => (
                                    <div key={index} className="bg-white rounded-lg p-3 border border-orange-200">
                                      <div className="flex items-center justify-between mb-1">
                                        <h6 className="font-medium text-orange-800 text-sm">{risk.risk}</h6>
                                        <span className={`px-2 py-1 text-xs rounded-full ${
                                          risk.severity === 'high' ? 'bg-red-100 text-red-700' :
                                          risk.severity === 'medium' ? 'bg-orange-100 text-orange-700' :
                                          'bg-yellow-100 text-yellow-700'
                                        }`}>
                                          {risk.severity === 'high' ? '高' : risk.severity === 'medium' ? '中' : '低'}
                                        </span>
                                      </div>
                                      <p className="text-gray-500 text-xs">{risk.mitigation}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 第三步：行動計劃 */}
                      {analysisResult.actionPlan && (
                        <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-6 border border-purple-200">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-8 h-8 bg-purple-600 text-white rounded-full text-sm font-bold">3</div>
                            <h4 className="text-lg font-semibold text-purple-900">🎯 行動計劃</h4>
                          </div>

                          {/* 立即行動 */}
                          {analysisResult.actionPlan.immediateActions && analysisResult.actionPlan.immediateActions.length > 0 && (
                            <div className="mb-6">
                              <h5 className="font-medium text-gray-800 mb-3">⚡ 立即行動</h5>
                              <div className="space-y-3">
                                {analysisResult.actionPlan.immediateActions.map((action: any, index: number) => (
                                  <div key={index} className="bg-white rounded-lg p-4 border border-purple-100">
                                    <div className="flex items-start justify-between mb-2">
                                      <h6 className="font-medium text-purple-800">{action.action}</h6>
                                      <span className={`px-2 py-1 text-xs rounded-full ${
                                        action.priority === 'high' ? 'bg-red-100 text-red-700' :
                                        action.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                        'bg-green-100 text-green-700'
                                      }`}>
                                        {action.priority === 'high' ? '高優先級' : action.priority === 'medium' ? '中優先級' : '低優先級'}
                                      </span>
                                    </div>
                                    <p className="text-gray-600 text-sm mb-2">{action.description}</p>
                                    <div className="flex flex-wrap gap-2 text-xs">
                                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">目標：{action.target}</span>
                                      <span className="px-2 py-1 bg-green-100 text-green-700 rounded">預期：{action.expectedImpact}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 短期與中期策略 */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* 短期策略 */}
                            {analysisResult.actionPlan.shortTermStrategy && analysisResult.actionPlan.shortTermStrategy.length > 0 && (
                              <div>
                                <h5 className="font-medium text-gray-800 mb-3">📅 短期策略 (1-4週)</h5>
                                <div className="space-y-3">
                                  {analysisResult.actionPlan.shortTermStrategy.map((strategy: any, index: number) => (
                                    <div key={index} className="bg-white rounded-lg p-3 border border-purple-100">
                                      <h6 className="font-medium text-purple-800 text-sm mb-1">{strategy.strategy}</h6>
                                      <p className="text-gray-600 text-xs mb-2">{strategy.description}</p>
                                      {strategy.steps && strategy.steps.length > 0 && (
                                        <div className="mb-2">
                                          <p className="text-gray-500 text-xs mb-1">執行步驟：</p>
                                          <ul className="text-xs text-gray-500 list-disc list-inside space-y-1">
                                            {strategy.steps.map((step: string, stepIndex: number) => (
                                              <li key={stepIndex}>{step}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                      <span className="inline-block px-2 py-1 bg-indigo-100 text-indigo-700 text-xs rounded">
                                        KPI：{strategy.kpi}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 中期策略 */}
                            {analysisResult.actionPlan.mediumTermStrategy && analysisResult.actionPlan.mediumTermStrategy.length > 0 && (
                              <div>
                                <h5 className="font-medium text-gray-800 mb-3">🗓️ 中期策略 (1-3個月)</h5>
                                <div className="space-y-3">
                                  {analysisResult.actionPlan.mediumTermStrategy.map((strategy: any, index: number) => (
                                    <div key={index} className="bg-white rounded-lg p-3 border border-purple-100">
                                      <h6 className="font-medium text-purple-800 text-sm mb-1">{strategy.strategy}</h6>
                                      <p className="text-gray-600 text-xs mb-2">{strategy.description}</p>
                                      <div className="flex flex-wrap gap-2 text-xs">
                                        <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded">
                                          投入：{strategy.investment}
                                        </span>
                                        <span className="px-2 py-1 bg-green-100 text-green-700 rounded">
                                          預期ROI：{strategy.roi}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 生成時間 */}
                      <div className="text-xs text-gray-500 text-center pt-4 border-t">
                        分析生成時間：{new Date(analysisResult.generatedAt || Date.now()).toLocaleString('zh-TW')}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* 廣告帳戶詳細資訊 */}
                <Card>
                  <CardHeader>
                    <CardTitle>廣告帳戶詳細資訊</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-gray-600">帳戶名稱</p>
                          <p className="font-medium">{(dashboardStats as any)?.data?.account?.name || '載入中...'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">帳戶狀態</p>
                          <p className="font-medium">正常</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">平均每日花費</p>
                          <p className="font-medium">NT$ {((dashboardStats as any)?.data?.overview?.totalSpend / 30)?.toFixed(0) || '0'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">平均點擊成本</p>
                          <p className="font-medium">NT$ {(dashboardStats as any)?.data?.metrics?.cpc?.toFixed(2) || '0'}</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : null}

            {/* 如果沒有數據且沒有載入錯誤，顯示準備就緒狀態 */}
            {!statsLoading && !statsError && !dashboardStats ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-8">
                    <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
                    <p className="text-green-600 font-medium">
                      Meta 廣告儀表板準備就緒！
                    </p>
                    <p className="text-gray-600 text-sm mt-2">
                      正在連接您的廣告數據...
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}