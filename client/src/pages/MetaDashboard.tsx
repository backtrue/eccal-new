import { useState } from 'react';
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
  
  // 載入 Meta 廣告儀表板數據
  const { 
    data: dashboardStats, 
    isLoading: statsLoading, 
    error: statsError 
  } = useQuery({
    queryKey: [`/api/meta/dashboard?businessType=${businessType}&level=${level}`],
    enabled: currentStep === 3 && !!selectedAccount
  });

  // 處理進入儀表板
  const handleEnterDashboard = () => {
    if (selectedAccount) {
      saveAdAccountMutation.mutate(selectedAccount);
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
                  <FacebookLoginButton />
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
                  <p className="text-green-600 font-medium mb-4">Facebook 已成功連接</p>
                  <Button onClick={() => setCurrentStep(2)}>
                    下一步：選擇廣告帳戶
                  </Button>
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
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                  {/* 業務類型選擇 */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-600">業務類型</label>
                    <Select value={businessType} onValueChange={(value: 'ecommerce' | 'consultation' | 'lead_generation') => setBusinessType(value)}>
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

                  {/* 帳戶資訊 */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-600">已選擇帳戶</label>
                    <div className="p-2 bg-gray-50 rounded-md text-sm">
                      {selectedAccount}
                    </div>
                  </div>

                  {/* GPT 分析按鈕 */}
                  <Button className="h-10" variant="outline">
                    <Sparkles className="w-4 h-4 mr-2" />
                    GPT 分析
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 載入狀態 */}
            {statsLoading && (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                    <p className="text-gray-600">正在載入廣告數據...</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 錯誤狀態 */}
            {statsError && (
              <Card className="border-red-200">
                <CardContent className="pt-6">
                  <div className="text-center py-8">
                    <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-4" />
                    <p className="text-red-600 font-medium mb-2">載入廣告數據失敗</p>
                    <p className="text-gray-600 text-sm">請稍後再試或檢查您的 Facebook 權限</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 完整分類指標儀表板 */}
            {dashboardStats && (
              <>
                {/* 共同核心指標 */}
                <Card>
                  <CardHeader>
                    <CardTitle>核心廣告指標</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
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
                        <div className="text-2xl font-bold text-green-600">
                          {(dashboardStats as any)?.data?.overview?.totalReach?.toLocaleString() || '0'}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">觸及數</p>
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
                      <div className="text-center">
                        <div className="text-2xl font-bold text-gray-600">
                          {((dashboardStats as any)?.data?.overview?.totalSpend / 30)?.toFixed(0) || '0'}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">每日預算</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

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
            )}

            {/* 如果沒有數據且沒有載入錯誤，顯示準備就緒狀態 */}
            {!statsLoading && !statsError && !dashboardStats && (
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
            )}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}