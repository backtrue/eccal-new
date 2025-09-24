import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Facebook, CheckCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import NavigationBar from '@/components/NavigationBar';
import Footer from '@/components/Footer';
import type { Locale } from '@/lib/i18n';
import { getTranslations } from '@/lib/i18n';

interface MetaDashboardProps {
  locale: Locale;
}

export default function MetaDashboard({ locale }: MetaDashboardProps) {
  const t = getTranslations(locale);
  const { user, isAuthenticated } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);

  // 檢查是否已連接 Facebook
  const isConnected = user?.metaAccessToken;

  const handleFacebookConnect = () => {
    setIsConnecting(true);
    // 直接重定向到 fbaudit 的 Facebook Auth URL 端點
    window.location.href = '/api/diagnosis/facebook-auth-url';
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

        {/* Facebook 連接卡片 */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Facebook className="w-5 h-5" />
              Facebook 廣告帳戶授權
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!isConnected ? (
              <div className="text-center py-8">
                <Facebook className="w-12 h-12 text-blue-600 mx-auto mb-4" />
                <p className="text-gray-600 mb-6">
                  請授權您的 Facebook 廣告帳戶存取權限
                </p>
                <Button 
                  onClick={handleFacebookConnect}
                  disabled={isConnecting}
                  className="bg-[#1877F2] hover:bg-[#166FE5] text-white"
                >
                  {isConnecting ? (
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
            ) : (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
                <p className="text-green-600 font-medium mb-4">Facebook 廣告帳戶已連接</p>
                <p className="text-gray-600 text-sm">已取得廣告帳戶存取權限</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}