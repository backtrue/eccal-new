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

  // 載入中狀態 - 當點擊查看儀表板後顯示
  if (showDashboard && dashboardLoading) {
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

  // 錯誤狀態 - 當點擊查看儀表板後但載入失敗
  if (showDashboard && dashboardError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <div className="p-6">
          <div className="max-w-4xl mx-auto">
            <Alert className="border-red-200 bg-red-50 dark:bg-red-900/20">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800 dark:text-red-300">
                載入 Meta 廣告數據時發生錯誤。請檢查您的網路連接或稍後再試。
                <div className="mt-4 space-x-4">
                  <Button 
                    onClick={() => window.location.reload()}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    重新載入
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => setShowDashboard(false)}
                  >
                    返回
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
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
                  onClick={() => {
                    console.log('🔵 查看儀表板按鈕被點擊了！');
                    console.log('🔵 當前 showDashboard 狀態:', showDashboard);
                    console.log('🔵 設置 showDashboard 為 true');
                    setShowDashboard(true);
                    console.log('🔵 按鈕點擊處理完成');
                  }}
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
}
