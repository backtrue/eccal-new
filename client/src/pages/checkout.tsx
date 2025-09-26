import { useState, useEffect } from "react";
import { useStripe, useElements, PaymentElement, Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, User } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
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

interface CheckoutProps {
  locale: Locale;
}

interface CheckoutFormProps {
  locale: Locale;
  planType: 'monthly' | 'lifetime';
  amount: number;
}

const CheckoutForm = ({ locale, planType, amount }: CheckoutFormProps) => {
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

  const t = getTranslations(locale);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/payment-success`,
      },
    });

    if (error) {
      console.error('Payment failed:', error);
      setPaymentStatus('error');
      safeToast({
        title: locale === 'zh-TW' ? "付款失敗" : locale === 'en' ? "Payment Failed" : "支払い失敗",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setPaymentStatus('success');
      safeToast({
        title: locale === 'zh-TW' ? "付款成功" : locale === 'en' ? "Payment Successful" : "支払い成功",
        description: locale === 'zh-TW' ? "感謝您的購買！" : locale === 'en' ? "Thank you for your purchase!" : "ご購入ありがとうございます！",
      });
    }

    setIsProcessing(false);
  };

  if (paymentStatus === 'success') {
    return (
      <div className="text-center py-8">
        <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-green-600 mb-2">
          {locale === 'zh-TW' ? '付款成功！' : locale === 'en' ? 'Payment Successful!' : '支払い成功！'}
        </h2>
        <p className="text-gray-600">
          {locale === 'zh-TW' 
            ? '您的會員已升級為 Pro 方案，享受完整功能！'
            : locale === 'en'
            ? 'Your membership has been upgraded to Pro. Enjoy full features!'
            : 'メンバーシップがProにアップグレードされました。全機能をお楽しみください！'}
        </p>
      </div>
    );
  }

  if (paymentStatus === 'error') {
    return (
      <div className="text-center py-8">
        <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-red-600 mb-2">
          {locale === 'zh-TW' ? '付款失敗' : locale === 'en' ? 'Payment Failed' : '支払い失敗'}
        </h2>
        <p className="text-gray-600 mb-4">
          {locale === 'zh-TW' 
            ? '付款過程中發生錯誤，請重試或聯絡客服。'
            : locale === 'en'
            ? 'An error occurred during payment. Please try again or contact support.'
            : '支払い中にエラーが発生しました。再試行するかサポートにお問い合わせください。'}
        </p>
        <Button onClick={() => setPaymentStatus('idle')}>
          {locale === 'zh-TW' ? '重試' : locale === 'en' ? 'Retry' : '再試行'}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
        <h3 className="font-semibold mb-2">
          {locale === 'zh-TW' ? '訂單摘要' : locale === 'en' ? 'Order Summary' : '注文概要'}
        </h3>
        <div className="flex justify-between items-center">
          <span>
            {planType === 'monthly' 
              ? (locale === 'zh-TW' ? '月訂閱方案' : locale === 'en' ? 'Monthly Plan' : '月間プラン')
              : (locale === 'zh-TW' ? '終身方案' : locale === 'en' ? 'Lifetime Plan' : '生涯プラン')
            }
          </span>
          <span className="font-bold">${amount}</span>
        </div>
      </div>
      
      <PaymentElement />
      
      <Button 
        type="submit" 
        disabled={!stripe || isProcessing} 
        className="w-full"
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {locale === 'zh-TW' ? '處理中...' : locale === 'en' ? 'Processing...' : '処理中...'}
          </>
        ) : (
          <>
            {locale === 'zh-TW' ? '立即付款' : locale === 'en' ? 'Pay Now' : '今すぐ支払う'} ${amount}
          </>
        )}
      </Button>
    </form>
  );
};

export default function Checkout({ locale }: CheckoutProps) {
  const [clientSecret, setClientSecret] = useState("");
  const [planType, setPlanType] = useState<'monthly' | 'lifetime'>('monthly');
  const [amount, setAmount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();

  const t = getTranslations(locale);

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

  useEffect(() => {
    // Check if user is authenticated first
    if (!isAuthenticated) {
      setIsLoading(false);
      return;
    }

    // Get plan type and amount from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const plan = urlParams.get('plan') as 'monthly' | 'lifetime';
    const planAmount = urlParams.get('amount');

    if (!plan || !planAmount) {
      safeToast({
        title: locale === 'zh-TW' ? "錯誤" : locale === 'en' ? "Error" : "エラー",
        description: locale === 'zh-TW' ? "缺少付款資訊" : locale === 'en' ? "Missing payment information" : "支払い情報が不足しています",
        variant: "destructive",
      });
      setIsLoading(false);
      return;
    }

    setPlanType(plan);
    setAmount(parseInt(planAmount));

    // Create payment intent
    apiRequest("POST", "/api/stripe/create-payment-intent", {
      amount: parseInt(planAmount),
      paymentType: plan,
      currency: 'jpy'
    })
      .then((res) => res.json())
      .then((data) => {
        setClientSecret(data.clientSecret);
        setIsLoading(false);
      })
      .catch((error) => {
        console.error('Error creating payment intent:', error);
        safeToast({
          title: locale === 'zh-TW' ? "錯誤" : locale === 'en' ? "Error" : "エラー",
          description: locale === 'zh-TW' ? "無法初始化付款" : locale === 'en' ? "Failed to initialize payment" : "支払いの初期化に失敗しました",
          variant: "destructive",
        });
        setIsLoading(false);
      });
  }, [locale, toast, isAuthenticated]);

  // Show loading screen
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-md mx-auto">
            <Card>
              <CardContent className="p-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
                <p>{locale === 'zh-TW' ? '正在準備付款...' : locale === 'en' ? 'Preparing payment...' : '支払いを準備中...'}</p>
              </CardContent>
            </Card>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  // Show login requirement if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-md mx-auto">
            <Card>
              <CardHeader className="text-center">
                <User className="h-16 w-16 text-blue-500 mx-auto mb-4" />
                <CardTitle className="text-2xl">
                  {locale === 'zh-TW' ? '需要登入' : locale === 'en' ? 'Login Required' : 'ログインが必要'}
                </CardTitle>
                <CardDescription>
                  {locale === 'zh-TW' 
                    ? '請先登入您的 Google 帳戶以繼續付款流程'
                    : locale === 'en'
                    ? 'Please login with your Google account to continue with payment'
                    : 'お支払いを続行するには、Googleアカウントでログインしてください'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <GoogleLoginButton 
                  locale={locale} 
                  returnTo={window.location.pathname + window.location.search}
                />
                <Link href={locale === 'zh-TW' ? '/pricing' : `/${locale === 'en' ? 'en' : 'jp'}/pricing`}>
                  <Button variant="outline" className="w-full">
                    {locale === 'zh-TW' ? '返回定價頁面' : locale === 'en' ? 'Back to Pricing' : '料金ページに戻る'}
                  </Button>
                </Link>
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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <NavigationBar locale={locale} />
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-md mx-auto">
            <Card>
              <CardContent className="p-8 text-center">
                <XCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
                <p className="text-red-600">
                  {locale === 'zh-TW' ? '付款初始化失敗' : locale === 'en' ? 'Payment initialization failed' : '支払いの初期化に失敗'}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <NavigationBar locale={locale} />
      
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-md mx-auto">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">
                {locale === 'zh-TW' ? '升級至 Pro 方案' : locale === 'en' ? 'Upgrade to Pro' : 'Proにアップグレード'}
              </CardTitle>
              <CardDescription>
                {locale === 'zh-TW' 
                  ? '解鎖所有功能，享受完整的廣告分析體驗'
                  : locale === 'en'
                  ? 'Unlock all features and enjoy the complete advertising analytics experience'
                  : 'すべての機能を解除し、完全な広告分析体験をお楽しみください'}
              </CardDescription>
              {planType === 'lifetime' && (
                <Badge variant="secondary" className="w-fit mx-auto mt-2">
                  {locale === 'zh-TW' ? '終身方案' : locale === 'en' ? 'Lifetime Deal' : '生涯プラン'}
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              <Elements stripe={getStripe()} options={{ clientSecret }}>
                <CheckoutForm locale={locale} planType={planType} amount={amount} />
              </Elements>
            </CardContent>
          </Card>
        </div>
      </div>

      <Footer />
    </div>
  );
}