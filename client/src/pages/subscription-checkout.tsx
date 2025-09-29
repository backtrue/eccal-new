import { useState, useEffect } from "react";
import { useStripe, useElements, PaymentElement, Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, User, Calendar, CreditCard, Crown } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
// Removed usePricing import - using simple JPY pricing
import NavigationBar from "@/components/NavigationBar";
import Footer from "@/components/Footer";
import GoogleLoginButton from "@/components/GoogleLoginButton";
import { getTranslations, type Locale } from "@/lib/i18n";

// 🔧 延遲載入 Stripe - 只在需要時才初始化
let stripePromise: Promise<any> | null = null;

const getStripe = () => {
  if (!stripePromise) {
    if (!import.meta.env.VITE_STRIPE_PUBLIC_KEY) {
      throw new Error('Missing required Stripe key: VITE_STRIPE_PUBLIC_KEY');
    }
    stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);
  }
  return stripePromise;
};

interface SubscriptionCheckoutProps {
  locale: Locale;
}

interface CheckoutFormProps {
  locale: Locale;
  planType: 'monthly' | 'annual' | 'founders';
  priceId: string;
}

// Price IDs are now dynamically fetched based on user locale

const CheckoutForm = ({ locale, planType, priceId }: CheckoutFormProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // 安全的 toast 函數，防止生產環境錯誤
  const safeToast = (options: any) => {
    try {
      if (toast && typeof toast === 'function') {
        toast(options);
      } else {
        console.error('Toast function not available:', options);
      }
    } catch (error) {
      console.error('Toast error:', error, options);
    }
  };
  // 移除舊的日圓定價數據，統一使用 pricingData

  const t = getTranslations(locale);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/payment-success?plan=${planType}`,
        },
      });

      if (error) {
        console.error('Payment confirmation error:', error);
        setPaymentStatus('error');
        safeToast({
          title: "付款錯誤",
          description: error.message || "付款過程中發生錯誤，請重試",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Payment error:', error);
      setPaymentStatus('error');
      safeToast({
        title: "付款錯誤",
        description: "付款過程中發生錯誤，請重試",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />
      
      <Button 
        type="submit" 
        disabled={!stripe || isProcessing}
        className="w-full bg-blue-600 hover:bg-blue-700"
        size="lg"
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            處理中...
          </>
        ) : (
          <>
            <CreditCard className="mr-2 h-4 w-4" />
            {planType === 'monthly' ? '確認訂閱' : planType === 'annual' ? '確認年訂閱' : '確認購買'}
          </>
        )}
      </Button>

      <p className="text-xs text-gray-500 text-center">
        安全付款
      </p>
    </form>
  );
};

export default function SubscriptionCheckout({ locale }: SubscriptionCheckoutProps) {
  const { user, isAuthenticated, checkAuth } = useAuth();
  const { toast } = useToast();
  const [clientSecret, setClientSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planType, setPlanType] = useState<'monthly' | 'annual' | 'founders'>('monthly');
  const [priceId, setPriceId] = useState<string>('');

  // 進入結帳頁面時主動檢查認證狀態
  useEffect(() => {
    console.log('Subscription Checkout: Checking auth on page load');
    if (!isAuthenticated) {
      checkAuth();
    }
  }, [checkAuth, isAuthenticated]);

  // 安全的 toast 函數，防止生產環境錯誤
  const safeToast = (options: any) => {
    try {
      if (toast && typeof toast === 'function') {
        toast(options);
      } else {
        console.error('Toast function not available:', options);
      }
    } catch (error) {
      console.error('Toast error:', error, options);
    }
  };
  // 新的三方案定價結構（與 pricing 頁面同步）
  const pricingData = {
    monthly: {
      twdPrice: 1280,
      priceId: 'price_0Rnx9sYDQY3sAQESPdLwXcXF', // 實際 Stripe Monthly Price ID
      displayName: '月訂閱'
    },
    annual: {
      twdPrice: 12800,
      priceId: 'price_0Rnx9tYDQY3sAQESabS9Mox2', // 實際 Stripe Annual Price ID
      displayName: '年訂閱',
      savings: '現省 2 個月費用！'
    },
    founders: {
      twdPrice: 5990,
      priceId: 'price_0Rnx9tYDQY3sAQESumeM9k1g', // 實際 Stripe Lifetime Price ID  
      displayName: '創始會員方案',
      oneTime: true
    }
  };

  const t = getTranslations(locale);

  useEffect(() => {
    // Get plan type from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const plan = urlParams.get('plan') as 'monthly' | 'annual' | 'founders';
    const price = urlParams.get('priceId');
    
    if (plan) {
      setPlanType(plan);
    }
    
    if (price) {
      setPriceId(price);
    } else {
      setPriceId(pricingData[plan]?.priceId || pricingData.monthly.priceId);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !priceId) {
      setLoading(false);
      return;
    }

    // Handle different payment types
    const createPayment = async () => {
      try {
        setLoading(true);
        
        // Check if this is a founders plan (one-time payment)
        if (planType === 'founders') {
          // Use payment intent for one-time payment
          const response = await apiRequest("POST", "/api/stripe/create-payment-intent", {
            amount: pricingData.founders.twdPrice,
            paymentType: 'founders_membership',
            currency: 'twd'
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to create payment intent');
          }

          const data = await response.json();
          
          if (data.clientSecret) {
            setClientSecret(data.clientSecret);
          } else {
            throw new Error('No client secret received');
          }
        } else {
          // Use subscription for recurring payments
          const response = await apiRequest("POST", "/api/stripe/create-subscription", {
            priceId,
            planType
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to create subscription');
          }

          const data = await response.json();
          
          if (data.clientSecret) {
            setClientSecret(data.clientSecret);
          } else {
            throw new Error('No client secret received');
          }
        }
      } catch (err: any) {
        console.error('Error creating payment:', err);
        setError(err.message || 'Failed to create payment');
        safeToast({
          title: planType === 'founders' ? "付款建立失敗" : "訂閱建立失敗",
          description: err.message || "無法建立付款，請重試",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    createPayment();
  }, [isAuthenticated, priceId, planType, t]);

  // 新的三方案詳細資訊
  const planDetails = {
    monthly: {
      name: '月訂閱',
      price: `NT$${pricingData.monthly.twdPrice.toLocaleString()}`,
      period: '每月',
      icon: Calendar,
      features: [
        '預算計算機無限使用',
        'AI 驅動 Facebook 廣告健檢',
        '整合 Google Analytics 真實數據',
        '智慧活動優化建議',
        '專業分析報告產出'
      ]
    },
    annual: {
      name: '年訂閱',
      price: `NT$${pricingData.annual.twdPrice.toLocaleString()}`,
      period: '年費（自動續費）',
      icon: Crown,
      features: [
        '包含月訂閱所有功能，並升級：',
        '【Pro 限定】5 階段「活動預算規劃師」',
        '【Pro 限定】新功能優先體驗權',
        '【Pro 限定】專屬客服支援',
        '現省 2 個月費用！'
      ]
    },
    founders: {
      name: '創始會員方案',
      price: `NT$${pricingData.founders.twdPrice.toLocaleString()}`,
      period: '一次性費用，非訂閱制',
      icon: CreditCard,
      features: [
        '這不只是一個方案，這是一個完整的資格包：',
        '【軟體權限】「報數據」平台終身使用權',
        '【專家親授】2.5 小時直播實戰教學',
        '【完整知識庫】FB 廣告成效攻略完整線上課程',
        '【專屬身份】創始會員私密社群資格'
      ]
    }
  };

  // 簡化的加載狀態檢查
  if (!priceId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
            <p>Loading pricing information...</p>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const currentPlan = planDetails[planType];
  const IconComponent = currentPlan.icon;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-md mx-auto">
            <Card>
              <CardHeader className="text-center">
                <User className="w-12 h-12 mx-auto text-blue-600 mb-4" />
                <CardTitle>需要登入</CardTitle>
                <CardDescription>
                  請先登入 Google 帳號以繼續付款流程
                </CardDescription>
              </CardHeader>
              <CardContent>
                <GoogleLoginButton locale={locale} />
                <div className="mt-4 text-center">
                  <Link href={`${locale === 'zh-TW' ? '' : `/${locale === 'en' ? 'en' : 'jp'}`}/pricing`}>
                    <Button variant="ghost" size="sm">
                      返回價格方案
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-md mx-auto">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-center space-x-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>準備付款中...</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-md mx-auto">
            <Card>
              <CardHeader className="text-center">
                <XCircle className="w-12 h-12 mx-auto text-red-600 mb-4" />
                <CardTitle className="text-red-600">訂閱建立失敗</CardTitle>
                <CardDescription>{error}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center space-y-4">
                  <Link href={`${locale === 'zh-TW' ? '' : `/${locale === 'en' ? 'en' : 'jp'}`}/pricing`}>
                    <Button className="w-full">
                      返回價格方案
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-md mx-auto">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
                  <p>準備付款中...</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <NavigationBar locale={locale} />
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              訂閱確認
            </h1>
            <p className="text-gray-600 dark:text-gray-300">
              完成付款以開始使用 Pro 功能
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Plan Summary */}
            <Card>
              <CardHeader>
                <div className="flex items-center space-x-3">
                  <IconComponent className="w-8 h-8 text-blue-600" />
                  <div>
                    <CardTitle className="text-xl">{currentPlan.name}</CardTitle>
                    <CardDescription>
                      {currentPlan.price} {currentPlan.period}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">用戶:</span>
                    <span>{user?.email}</span>
                  </div>
                  
                  <div className="border-t pt-3">
                    <h4 className="font-medium mb-2">方案內容:</h4>
                    <ul className="space-y-1">
                      {currentPlan.features.map((feature, index) => (
                        <li key={index} className="flex items-center text-sm">
                          <CheckCircle className="w-4 h-4 text-green-600 mr-2 flex-shrink-0" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {planType === 'monthly' && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                      <p className="text-sm text-blue-800 dark:text-blue-200">
                        <Calendar className="w-4 h-4 inline mr-1" />
                        自動續費
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Payment Form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <CreditCard className="w-5 h-5 mr-2" />
                  付款方式
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Elements 
                  stripe={getStripe()} 
                  options={{ 
                    clientSecret,
                    appearance: {
                      theme: 'stripe',
                      variables: {
                        colorPrimary: '#2563eb',
                      }
                    }
                  }}
                >
                  <CheckoutForm 
                    locale={locale} 
                    planType={planType} 
                    priceId={priceId}
                  />
                </Elements>
              </CardContent>
            </Card>
          </div>

          <div className="mt-8 text-center">
            <Link href={`${locale === 'zh-TW' ? '' : `/${locale === 'en' ? 'en' : 'jp'}`}/pricing`}>
              <Button variant="ghost">
                返回價格方案
              </Button>
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}