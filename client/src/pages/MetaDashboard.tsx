import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  PieChart
} from 'lucide-react';
import { useLocation } from 'wouter';

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

export default function MetaDashboard({ locale = 'zh-TW' }: { locale?: string }) {
  const [, setLocation] = useLocation();
  const [businessType, setBusinessType] = useState<string>('ecommerce');
  const [needsAuth, setNeedsAuth] = useState(false);

  // 獲取 Meta 儀表板統計數據 - 使用自定義 queryFn 來正確處理 401 錯誤
  const { 
    data: dashboardData, 
    isLoading: dashboardLoading, 
    error: dashboardError,
    refetch: refetchDashboard
  } = useQuery<{ success: boolean; data: MetaDashboardData }>({ 
    queryKey: ['/api/meta/dashboard-stats'],
    queryFn: async () => {
      const res = await fetch('/api/meta/dashboard-stats', {
        credentials: 'include'
      });
      
      // 對於 401 錯誤，創建一個特殊的錯誤對象來保持狀態信息
      if (res.status === 401) {
        const errorObj = new Error('Authentication required');
        (errorObj as any).response = {
          status: 401,
          data: await res.json().catch(() => ({ error: 'Authentication required' }))
        };
        throw errorObj;
      }
      
      if (!res.ok) {
        const text = await res.text() || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      
      return await res.json();
    },
    retry: false
  });

  // 獲取業務指標
  const { 
    data: businessData, 
    isLoading: businessLoading
  } = useQuery<{ success: boolean; data: BusinessMetrics }>({ 
    queryKey: ['/api/meta/business-metrics', businessType],
    enabled: !!dashboardData?.success && !needsAuth
  });

  // 處理認證錯誤
  useEffect(() => {
    if (dashboardError) {
      const status = (dashboardError as any)?.response?.status;
      const errorData = (dashboardError as any)?.response?.data;
      
      // 處理 401 未認證錯誤
      if (status === 401) {
        // 重定向到登入頁面
        window.location.href = '/fbaudit';
        return;
      }
      
      // 處理 400 需要 Facebook 認證
      if (status === 400 && errorData?.needsFacebookAuth) {
        setNeedsAuth(true);
      }
    }
  }, [dashboardError]);

  // 連接 Facebook 廣告帳戶
  const handleConnectFacebook = () => {
    setLocation('/fbaudit');
  };

  // 如果需要 Facebook 認證
  if (needsAuth || (dashboardError && (dashboardError as any)?.response?.data?.needsFacebookAuth)) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center space-y-6">
            <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
              <Target className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                Meta 廣告儀表板
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                連接您的 Facebook 廣告帳戶以查看詳細的廣告數據分析
              </p>
            </div>
            
            <Alert className="max-w-md mx-auto">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                請先連接您的 Facebook 廣告帳戶以開始使用儀表板功能
              </AlertDescription>
            </Alert>
            
            <Button 
              onClick={handleConnectFacebook}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              size="lg"
              data-testid="connect-facebook-button"
            >
              連接 Facebook 廣告帳戶
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 載入中狀態
  if (dashboardLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
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
    );
  }

  const data = dashboardData?.data;
  
  // 錯誤狀態 - 根據不同錯誤類型處理
  if (dashboardError || (!dashboardLoading && !data)) {
    const status = (dashboardError as any)?.response?.status;
    const errorMessage = (dashboardError as any)?.message;
    const responseData = (dashboardError as any)?.response?.data;
    
    // 調試信息 - 在開發環境下打印錯誤詳情
    console.log('Dashboard Error Debug:', {
      hasError: !!dashboardError,
      status,
      errorMessage,
      responseData,
      fullError: dashboardError
    });
    
    // 檢查多種 401 未認證的可能情況
    if (status === 401 || errorMessage?.includes('Unauthorized') || errorMessage?.includes('Authentication required')) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
          <div className="max-w-4xl mx-auto">
            <div className="text-center space-y-6">
              <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                <Target className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>
              
              <div className="space-y-2">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                  Meta 廣告儀表板
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  請先登入以查看您的廣告數據分析
                </p>
              </div>
              
              <Alert className="max-w-md mx-auto">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  您需要先登入並連接 Facebook 廣告帳戶才能使用儀表板功能
                </AlertDescription>
              </Alert>
              
              <Button 
                onClick={() => setLocation('/fbaudit')}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                size="lg"
                data-testid="login-button"
              >
                前往登入並連接 Facebook
              </Button>
            </div>
          </div>
        </div>
      );
    }
    
    // 其他錯誤：顯示一般錯誤信息
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
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
  );
}