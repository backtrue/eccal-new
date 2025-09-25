import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Facebook, CheckCircle, Loader2, Target, AlertTriangle, TrendingUp, DollarSign, Users, BarChart3 } from 'lucide-react';
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
      return await apiRequest(`/api/diagnosis/set-ad-account`, {
        method: 'POST',
        body: { adAccountId }
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

  // 載入 Meta 廣告儀表板數據
  const { 
    data: dashboardStats, 
    isLoading: statsLoading, 
    error: statsError 
  } = useQuery({
    queryKey: ['/api/meta/dashboard-stats'],
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

        {/* 步驟 3: 儀表板 */}
        {currentStep === 3 && selectedAccount && (
          <div className="space-y-6">
            {/* 帳戶資訊 */}
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-gray-600">已選擇廣告帳戶</p>
                  <p className="font-medium text-lg">{selectedAccount}</p>
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

            {/* 廣告數據儀表板 */}
            {dashboardStats && (
              <>
                {/* 關鍵指標卡片 */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">總花費</CardTitle>
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        NT$ {(dashboardStats as any).totalSpend?.toLocaleString() || '0'}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        過去 30 天
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">曝光次數</CardTitle>
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {(dashboardStats as any).impressions?.toLocaleString() || '0'}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        過去 30 天
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">點擊次數</CardTitle>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {(dashboardStats as any).clicks?.toLocaleString() || '0'}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        過去 30 天
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">點擊率</CardTitle>
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {(dashboardStats as any).ctr ? `${((dashboardStats as any).ctr * 100).toFixed(2)}%` : '0%'}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        點擊率
                      </p>
                    </CardContent>
                  </Card>
                </div>

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
                          <p className="font-medium">{(dashboardStats as any).accountName || '載入中...'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">帳戶狀態</p>
                          <p className="font-medium">{(dashboardStats as any).accountStatus || '載入中...'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">平均每日花費</p>
                          <p className="font-medium">NT$ {(dashboardStats as any).avgDailySpend?.toLocaleString() || '0'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">平均點擊成本</p>
                          <p className="font-medium">NT$ {(dashboardStats as any).avgCpc?.toFixed(2) || '0'}</p>
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