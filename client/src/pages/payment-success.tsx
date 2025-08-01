import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2 } from "lucide-react";
import { Link } from "wouter";
import NavigationBar from "@/components/NavigationBar";
import Footer from "@/components/Footer";
import { getTranslations, type Locale } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";

interface PaymentSuccessProps {
  locale: Locale;
}

export default function PaymentSuccess({ locale }: PaymentSuccessProps) {
  const [isVerifying, setIsVerifying] = useState(true);
  const [paymentVerified, setPaymentVerified] = useState(false);
  const { checkAuth, user } = useAuth();
  const t = getTranslations(locale);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentIntentId = urlParams.get('payment_intent');
    const redirectStatus = urlParams.get('redirect_status');

    if (paymentIntentId && redirectStatus === 'succeeded') {
      console.log('Payment Success: Verifying payment and restoring auth', paymentIntentId);
      
      // 先嘗試新的驗證端點
      fetch('/api/stripe/verify-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ paymentIntentId })
      })
      .then(async (response) => {
        // 檢查是否返回 HTML（生產環境問題）
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
          console.log('Payment Success: Fallback to auth check due to HTML response');
          // Fallback：直接觸發認證檢查
          await checkAuth();
          setPaymentVerified(true);
          setIsVerifying(false);
          return;
        }
        
        return response.json();
      })
      .then(data => {
        if (data) {
          setPaymentVerified(data.success);
          setIsVerifying(false);
        }
      })
      .catch(async (error) => {
        console.error('Payment verification failed, trying auth check:', error);
        // 如果驗證失敗，至少嘗試恢復認證狀態
        try {
          await checkAuth();
          setPaymentVerified(true);
        } catch (authError) {
          console.error('Auth check also failed:', authError);
          setPaymentVerified(false);
        }
        setIsVerifying(false);
      });
    } else {
      // No payment intent, just show success and check auth
      checkAuth().finally(() => {
        setIsVerifying(false);
      });
    }
  }, [checkAuth]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 dark:from-gray-900 dark:to-gray-800">
      <NavigationBar locale={locale} />
      
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-md mx-auto">
          <Card>
            <CardContent className="p-8 text-center">
              {isVerifying ? (
                <>
                  <Loader2 className="h-16 w-16 text-blue-500 mx-auto mb-6 animate-spin" />
                  <h1 className="text-2xl font-bold mb-4">
                    {locale === 'zh-TW' ? '驗證付款中...' : locale === 'en' ? 'Verifying Payment...' : '支払いを確認中...'}
                  </h1>
                  <p className="text-gray-600">
                    {locale === 'zh-TW' 
                      ? '請稍候，我們正在處理您的付款'
                      : locale === 'en'
                      ? 'Please wait while we process your payment'
                      : 'お支払いを処理していますのでお待ちください'}
                  </p>
                </>
              ) : (
                <>
                  <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-6" />
                  <h1 className="text-3xl font-bold text-green-600 mb-4">
                    {locale === 'zh-TW' ? '付款成功！' : locale === 'en' ? 'Payment Successful!' : 'お支払い完了！'}
                  </h1>
                  <p className="text-gray-600 mb-6">
                    {locale === 'zh-TW' 
                      ? '感謝您的訂閱！您現在可以使用所有高級功能。'
                      : locale === 'en'
                      ? 'Thank you for your subscription! You now have access to all premium features.'
                      : 'ご購読いただきありがとうございます！すべてのプレミアム機能をご利用いただけます。'}
                  </p>
                  
                  {user && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                      <p className="text-sm text-green-700">
                        {locale === 'zh-TW' 
                          ? `歡迎回來，${user.email}！您的帳戶已升級為 ${user.membership_level?.toUpperCase() || 'PRO'} 會員。`
                          : locale === 'en'
                          ? `Welcome back, ${user.email}! Your account has been upgraded to ${user.membership_level?.toUpperCase() || 'PRO'} membership.`
                          : `${user.email}さん、おかえりなさい！アカウントが${user.membership_level?.toUpperCase() || 'PRO'}メンバーシップにアップグレードされました。`}
                      </p>
                    </div>
                  )}
                  
                  <div className="space-y-3">
                    <Button asChild className="w-full">
                      <Link href="/dashboard">
                        {locale === 'zh-TW' ? '前往控制台' : locale === 'en' ? 'Go to Dashboard' : 'ダッシュボードへ'}
                      </Link>
                    </Button>
                    
                    <Button asChild variant="outline" className="w-full">
                      <Link href="/calculator-simple">
                        {locale === 'zh-TW' ? '開始使用計算器' : locale === 'en' ? 'Start Using Calculator' : '計算機を使い始める'}
                      </Link>
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Footer />
    </div>
  );
}