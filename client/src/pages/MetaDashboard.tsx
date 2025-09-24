import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Facebook, CheckCircle, Loader2, Target, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
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
  const hasFacebookTokenError = accountsError && 
    (accountsError as any)?.status === 500;


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
              {!isConnected ? (
                <div className="text-center py-8">
                  <p className="text-gray-600 mb-6">
                    請授權您的 Facebook 廣告帳戶存取權限
                  </p>
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
        {currentStep === 2 && isConnected && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                選擇廣告帳戶
              </CardTitle>
            </CardHeader>
            <CardContent>
              {hasFacebookTokenError ? (
                <div className="text-center py-8">
                  <AlertTriangle className="w-12 h-12 text-red-600 mx-auto mb-4" />
                  <p className="text-red-600 font-medium mb-4">Facebook 授權已過期</p>
                  <p className="text-gray-600 text-sm mb-6">
                    您的 Facebook 授權已失效，請重新連接以繼續使用
                  </p>
                  <FacebookLoginButton />
                </div>
              ) : accountsLoading ? (
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
                      <Button onClick={() => setCurrentStep(3)}>
                        進入儀表板
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
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>廣告帳戶儀表板</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <p className="text-gray-600 mb-4">
                  已選擇廣告帳戶: {selectedAccount}
                </p>
                <p className="text-green-600 font-medium">
                  Meta 廣告儀表板準備就緒！
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      <Footer />
    </div>
  );
}