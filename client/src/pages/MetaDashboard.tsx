import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  TrendingUp, 
  DollarSign, 
  Eye, 
  MousePointer, 
  ShoppingCart, 
  Users, 
  Target,
  AlertCircle,
  BarChart3,
  PieChart,
  Facebook,
  Loader2,
  CheckCircle
} from 'lucide-react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import FacebookLoginButton from '@/components/FacebookLoginButton';
import type { Locale } from '@/lib/i18n';

interface MetaDashboardData {
  account: {
    id: string;
    name: string;
    currency: string;
  };
  period: {
    start: string;
    end: string;
    days: number;
  };
  overview: {
    totalSpend: number;
    totalImpressions: number;
    totalClicks: number;
    totalPurchases: number;
    totalRevenue: number;
  };
  metrics: {
    ctr: number;
    cpc: number;
    roas: number;
    atcRate: number;
    pfRate: number;
  };
  funnel: {
    impressions: number;
    clicks: number;
    viewContent: number;
    addToCart: number;
    purchases: number;
  };
}

interface BusinessMetrics {
  type: string;
  metrics: Record<string, number>;
  breakdown: Record<string, number>;
}

// 登入界面組件
function LoginInterface() {
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isFacebookLoading, setIsFacebookLoading] = useState(false);

  const handleGoogleLogin = () => {
    setIsGoogleLoading(true);
    // Google 登入重定向
    window.location.href = '/api/auth/google';
  };

  const handleFacebookConnect = () => {
    setIsFacebookLoading(true);
    // Facebook 連接重定向
    window.location.href = '/api/diagnosis/facebook-auth-url';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-lg mx-auto">
        <div className="text-center space-y-6">
          {/* Logo/Icon */}
          <div className="mx-auto w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
            <Target className="w-10 h-10 text-white" />
          </div>
          
          {/* Title */}
          <div className="space-y-3">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
              Meta 廣告儀表板
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              分析您的 Facebook 廣告數據，優化投資回報率
            </p>
          </div>

          {/* Login Steps */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              開始使用 - 兩步驟設置
            </h2>
            
            {/* Step 1: Google Login */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">1</span>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Google 登入</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">使用您的 Google 帳戶登入系統</p>
                </div>
              </div>
              
              <Button
                onClick={handleGoogleLogin}
                disabled={isGoogleLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                size="lg"
                data-testid="google-login-button"
              >
                {isGoogleLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    登入中...
                  </>
                ) : (
                  <>
                    使用 Google 登入
                  </>
                )}
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-gray-800 text-gray-500">然後</span>
              </div>
            </div>

            {/* Step 2: Facebook Connect */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">2</span>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white">連接 Facebook 廣告</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">授權存取您的 Facebook 廣告帳戶數據</p>
                </div>
              </div>
              
              <Button
                onClick={handleFacebookConnect}
                disabled={isFacebookLoading}
                className="w-full bg-[#1877F2] hover:bg-[#166FE5] text-white"
                size="lg"
                data-testid="facebook-connect-button"
              >
                {isFacebookLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    連接中...
                  </>
                ) : (
                  <>
                    <Facebook className="mr-2 h-4 w-4" />
                    連接 Facebook 廣告帳戶
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Features Preview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div className="space-y-2">
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white">即時數據</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">查看最新的廣告表現數據</p>
            </div>
            
            <div className="space-y-2">
              <div className="mx-auto w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white">趨勢分析</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">了解廣告成效變化趨勢</p>
            </div>
            
            <div className="space-y-2">
              <div className="mx-auto w-12 h-12 bg-orange-100 dark:bg-orange-900 rounded-lg flex items-center justify-center">
                <Target className="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white">優化建議</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">AI 驅動的廣告優化建議</p>
            </div>
          </div>

          {/* Privacy Notice */}
          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p>
              點擊上述按鈕表示您同意我們的{' '}
              <a href="/privacy-policy" className="text-blue-600 hover:text-blue-700 underline">
                隱私政策
              </a>
              {' '}和{' '}
              <a href="/terms-of-service" className="text-blue-600 hover:text-blue-700 underline">
                使用條款
              </a>
            </p>
            <p>我們只會存取您授權的廣告數據，不會進行任何未經授權的操作。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MetaDashboardProps {
  locale: Locale;
}

export default function MetaDashboard({ locale }: MetaDashboardProps) {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, checkAuth } = useAuth();
  const [businessType, setBusinessType] = useState<string>('ecommerce');
  const [showDashboard, setShowDashboard] = useState(false);

  // 只有在用戶明確要求查看儀表板時才載入數據
  const { 
    data: dashboardData, 
    isLoading: dashboardLoading, 
    error: dashboardError,
    refetch: refetchDashboard
  } = useQuery<{ success: boolean; data: MetaDashboardData }>({ 
    queryKey: ['/api/meta/dashboard'],
    enabled: showDashboard && isAuthenticated && user?.hasFacebookAuth,
    retry: false
  });

  // 檢查 URL 參數中的認證成功標記
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('facebook_auth_success')) {
      // Facebook 認證成功，清除 URL 參數
      window.history.replaceState({}, '', '/meta-dashboard');
      // 顯示儀表板
      setShowDashboard(true);
    }
  }, []);

  // 獲取業務指標 - 只有在儀表板模式時才載入
  const { 
    data: businessData, 
    isLoading: businessLoading
  } = useQuery<{ success: boolean; data: BusinessMetrics }>({ 
    queryKey: ['/api/meta/business-metrics', businessType],
    enabled: showDashboard && !!dashboardData?.success && isAuthenticated && user?.hasFacebookAuth
  });


  // 獲取認證狀態 (照抄 fbaudit 的做法)
  const isConnected = user?.hasFacebookAuth;

  // 如果用戶未登入，顯示登入界面
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <LoginInterface />
        <Footer />
      </div>
    );
  }

  // 檢查是否在儀表板模式且有結果數據 (照抄 fbaudit 的條件邏輯)
  if (showDashboard && dashboardData?.success) {
    const data = dashboardData.data;
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <div className="p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Meta 廣告儀表板
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {data.account.name} • {data.period.start} 至 {data.period.end} ({data.period.days} 天)
            </p>
            {/* TODO: 這裡會放入完整的儀表板內容 */}
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  // 主要邏輯 - 步驟化認證流程 (完全照抄 fbaudit 的邏輯)
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <NavigationBar locale={locale} />
      <div className="container mx-auto p-6 max-w-4xl">
        {/* 頁面標題 */}
        <div className="text-center mb-12">
          <Target className="w-16 h-16 text-blue-600 mx-auto mb-6" />
          <h1 className="text-4xl font-bold mb-4">Meta 廣告儀表板</h1>
          <p className="text-xl text-gray-600 mb-6">
            分析您的 Facebook 廣告數據，優化投資回報率
          </p>
        </div>

        {/* Facebook 連接步驟 */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Facebook className="w-5 h-5" />
              連接 Facebook 廣告帳戶
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!isConnected ? (
              <div className="text-center py-8">
                <p className="text-gray-600 mb-6">
                  請先連接您的 Facebook 廣告帳戶以開始使用儀表板功能
                </p>
                <FacebookLoginButton />
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
                <p className="text-green-600 font-medium mb-4">Facebook 已連接成功！</p>
                <Button 
                  onClick={() => setShowDashboard(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  查看儀表板
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );

  // 載入中狀態
  if (dashboardLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <div className="p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-96" />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-8 w-24" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-4 w-16" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const data = dashboardData?.data;
  
  // 錯誤狀態 - 根據不同錯誤類型處理
  if (dashboardError || (!dashboardLoading && !data)) {
    const status = (dashboardError as any)?.response?.status;
    const errorMessage = (dashboardError as any)?.message;
    const responseData = (dashboardError as any)?.response?.data;
    
    // 開發環境下記錄錯誤詳情以便調試
    if (process.env.NODE_ENV === 'development') {
      console.log('Dashboard Error Debug:', {
        hasError: !!dashboardError,
        status,
        errorMessage,
        responseData
      });
    }
    
    // 檢查多種 401 未認證的可能情況
    if (status === 401 || errorMessage?.includes('Unauthorized') || errorMessage?.includes('Authentication required')) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
          <NavigationBar locale={locale} />
          <LoginInterface />
          <Footer />
        </div>
      );
    }
    
    // 其他錯誤：顯示一般錯誤信息
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <div className="p-6">
          <div className="max-w-4xl mx-auto">
            <Alert className="border-red-200 bg-red-50 dark:bg-red-900/20">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800 dark:text-red-300">
                載入 Meta 廣告數據時發生錯誤。請檢查您的網路連接或稍後再試。
                {dashboardError && (
                  <div className="mt-2 text-sm">
                    錯誤詳情：{(dashboardError as any)?.message || '未知錯誤'}
                  </div>
                )}
              </AlertDescription>
            </Alert>
            
            <div className="mt-6 text-center">
              <Button onClick={() => refetchDashboard()}>重新載入</Button>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  // 如果沒有數據且沒有錯誤，則返回空白（正在加載）
  if (!data) return null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: data.account.currency || 'TWD'
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('zh-TW').format(num);
  };

  const formatPercentage = (num: number) => {
    return `${num.toFixed(2)}%`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <NavigationBar locale={locale} />
      <div className="p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* 頁面標題 */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Meta 廣告儀表板
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {data.account.name} • {data.period.start} 至 {data.period.end} ({data.period.days} 天)
            </p>
          </div>
          
          <div className="flex items-center space-x-4">
            <Select value={businessType} onValueChange={setBusinessType}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ecommerce">電商銷售</SelectItem>
                <SelectItem value="consultation">線上諮詢</SelectItem>
                <SelectItem value="lead_generation">潛客開發</SelectItem>
              </SelectContent>
            </Select>
            
            <Button onClick={() => refetchDashboard()} variant="outline">
              重新載入
            </Button>
          </div>
        </div>

        {/* 核心指標卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">總花費</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="total-spend">
                {formatCurrency(data.overview.totalSpend)}
              </div>
              <p className="text-xs text-muted-foreground">
                過去 {data.period.days} 天
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">曝光次數</CardTitle>
              <Eye className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="total-impressions">
                {formatNumber(data.overview.totalImpressions)}
              </div>
              <p className="text-xs text-muted-foreground">
                CTR: {formatPercentage(data.metrics.ctr)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">點擊次數</CardTitle>
              <MousePointer className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="total-clicks">
                {formatNumber(data.overview.totalClicks)}
              </div>
              <p className="text-xs text-muted-foreground">
                CPC: {formatCurrency(data.metrics.cpc)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">廣告投資報酬率</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="roas">
                {data.metrics.roas.toFixed(2)}x
              </div>
              <p className="text-xs text-muted-foreground">
                收入: {formatCurrency(data.overview.totalRevenue)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 詳細分析區塊 */}
        <Tabs defaultValue="funnel" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="funnel">轉換漏斗</TabsTrigger>
            <TabsTrigger value="business">業務指標</TabsTrigger>
            <TabsTrigger value="performance">效果分析</TabsTrigger>
          </TabsList>

          {/* 轉換漏斗 */}
          <TabsContent value="funnel" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <BarChart3 className="h-5 w-5" />
                  <span>廣告轉換漏斗</span>
                </CardTitle>
                <CardDescription>
                  從曝光到購買的完整轉換流程
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { label: '曝光', value: data.funnel.impressions, icon: Eye },
                    { label: '點擊', value: data.funnel.clicks, icon: MousePointer },
                    { label: '瀏覽商品', value: data.funnel.viewContent, icon: Users },
                    { label: '加入購物車', value: data.funnel.addToCart, icon: ShoppingCart },
                    { label: '完成購買', value: data.funnel.purchases, icon: Target }
                  ].map((step, index) => {
                    const Icon = step.icon;
                    const prevStep = index > 0 ? [
                      data.funnel.impressions,
                      data.funnel.clicks,
                      data.funnel.viewContent,
                      data.funnel.addToCart,
                      data.funnel.purchases
                    ][index - 1] : null;
                    const conversionRate = prevStep ? (step.value / prevStep * 100) : 100;
                    
                    return (
                      <div key={step.label} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center space-x-3">
                          <Icon className="h-5 w-5 text-blue-600" />
                          <span className="font-medium">{step.label}</span>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{formatNumber(step.value)}</div>
                          {index > 0 && (
                            <div className="text-sm text-muted-foreground">
                              {formatPercentage(conversionRate)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 業務指標 */}
          <TabsContent value="business" className="space-y-6">
            {businessLoading ? (
              <Card>
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </CardContent>
              </Card>
            ) : businessData?.data ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <PieChart className="h-5 w-5" />
                    <span>
                      {businessType === 'ecommerce' ? '電商' : 
                       businessType === 'consultation' ? '諮詢' : '潛客開發'}
                      專用指標
                    </span>
                  </CardTitle>
                  <CardDescription>
                    針對 {businessType === 'ecommerce' ? '電商業務' : 
                           businessType === 'consultation' ? '諮詢服務' : '潛客開發'} 的關鍵指標分析
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(businessData.data.metrics).map(([key, value]) => {
                      const metricLabels: Record<string, string> = {
                        atcRate: '加購率 (ATC%)',
                        pfRate: '結帳率 (PF%)',
                        aov: '平均訂單價值',
                        costPerPurchase: '每次購買成本',
                        roas: '廣告投資報酬率',
                        costPerMessaging: '每次對話成本',
                        messagingRate: '對話轉換率',
                        estimatedConversations: '預估對話數',
                        costPerLead: '每個潛客成本',
                        leadRate: '潛客轉換率',
                        estimatedLeads: '預估潛客數'
                      };
                      
                      return (
                        <div key={key} className="p-4 border rounded-lg" data-testid={`metric-${key}`}>
                          <div className="text-sm text-muted-foreground">
                            {metricLabels[key] || key}
                          </div>
                          <div className="text-2xl font-bold">
                            {key.includes('Rate') || key.includes('率') ? 
                              formatPercentage(value as number) :
                              key.includes('cost') || key.includes('成本') || key === 'aov' ?
                                formatCurrency(value as number) :
                                key === 'roas' ?
                                  `${(value as number).toFixed(2)}x` :
                                  formatNumber(value as number)
                            }
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  無法載入業務指標數據，請稍後再試。
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          {/* 效果分析 */}
          <TabsContent value="performance" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>關鍵指標表現</CardTitle>
                  <CardDescription>
                    廣告效果核心指標分析
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span>點擊率 (CTR)</span>
                      <Badge variant={data.metrics.ctr > 1 ? "default" : "secondary"}>
                        {formatPercentage(data.metrics.ctr)}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>單次點擊成本 (CPC)</span>
                      <Badge variant={data.metrics.cpc < 10 ? "default" : "secondary"}>
                        {formatCurrency(data.metrics.cpc)}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>廣告投資報酬率 (ROAS)</span>
                      <Badge variant={data.metrics.roas > 2 ? "default" : "secondary"}>
                        {data.metrics.roas.toFixed(2)}x
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>優化建議</CardTitle>
                  <CardDescription>
                    基於當前數據的改善建議
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Alert className="border-green-200 bg-green-50 dark:bg-green-900/20">
                      <TrendingUp className="h-4 w-4 text-green-600" />
                      <AlertDescription className="text-green-800 dark:text-green-300">
                        Meta 儀表板已成功連接！可以開始分析您的廣告數據了。
                      </AlertDescription>
                    </Alert>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      </div>
      <Footer />
    </div>
  );
}