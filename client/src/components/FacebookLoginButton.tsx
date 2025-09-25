import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { Facebook, Loader2, AlertTriangle } from 'lucide-react';
import { useLocale } from '@/hooks/useLocale';
import { useAuth } from '@/hooks/useAuth';

interface FacebookLoginButtonProps {
  className?: string;
}

export default function FacebookLoginButton({ className }: FacebookLoginButtonProps) {
  const { t } = useLocale();
  const [isLoading, setIsLoading] = useState(false);
  const { isAuthenticated } = useAuth();

  const handleFacebookLogin = () => {
    if (!isAuthenticated) {
      // 防禦性檢查：如果用戶未認證，不執行操作
      console.log('Facebook login blocked: user not authenticated');
      return;
    }
    
    setIsLoading(true);
    // 直接重定向到 Facebook Auth URL 端點（現在有認證保護）
    window.location.href = '/api/diagnosis/facebook-auth-url';
  };

  // 如果認證狀態未確定，顯示提示信息
  if (isAuthenticated === null || isAuthenticated === undefined) {
    return (
      <div className="space-y-2">
        <Button
          disabled
          className={`bg-gray-400 text-white ${className}`}
        >
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          檢查登入狀態...
        </Button>
        <p className="text-xs text-gray-500">
          正在確認您的登入狀態，請稍候...
        </p>
      </div>
    );
  }

  // 如果用戶未認證，顯示需要先登入的提示
  if (!isAuthenticated) {
    return (
      <div className="space-y-2">
        <Button
          disabled
          className={`bg-gray-400 text-white ${className}`}
        >
          <AlertTriangle className="mr-2 h-4 w-4" />
          需要先登入
        </Button>
        <p className="text-xs text-gray-500">
          請先使用 Google 帳號登入，再連接 Facebook 廣告帳戶
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={handleFacebookLogin}
        disabled={isLoading}
        className={`bg-[#1877F2] hover:bg-[#166FE5] text-white ${className}`}
      >
        {isLoading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Facebook className="mr-2 h-4 w-4" />
        )}
        {isLoading ? '連接中...' : '連接 Facebook'}
      </Button>
      <p className="text-xs text-gray-600 max-w-sm">
        {t.privacyTermsNotice.split('隱私政策').length > 1 ? (
          <>
            {t.privacyTermsNotice.split('隱私政策')[0]}
            <a 
              href="/privacy-policy" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 underline"
            >
              {t.privacyPolicy}
            </a>
            {t.privacyTermsNotice.split('隱私政策')[1].split('使用條款')[0]}
            <a 
              href="/terms-of-service" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 underline"
            >
              {t.termsOfService}
            </a>
            {t.privacyTermsNotice.split('使用條款')[1]}
          </>
        ) : t.privacyTermsNotice.includes('Privacy Policy') ? (
          <>
            {t.privacyTermsNotice.split('Privacy Policy')[0]}
            <a 
              href="/en/privacy-policy" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 underline"
            >
              {t.privacyPolicy}
            </a>
            {t.privacyTermsNotice.split('Privacy Policy')[1].split('Terms of Service')[0]}
            <a 
              href="/en/terms-of-service" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 underline"
            >
              {t.termsOfService}
            </a>
            {t.privacyTermsNotice.split('Terms of Service')[1]}
          </>
        ) : (
          <>
            {t.privacyTermsNotice.split('プライバシーポリシー')[0]}
            <a 
              href="/jp/privacy-policy" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 underline"
            >
              {t.privacyPolicy}
            </a>
            {t.privacyTermsNotice.split('プライバシーポリシー')[1].split('利用規約')[0]}
            <a 
              href="/jp/terms-of-service" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 underline"
            >
              {t.termsOfService}
            </a>
            {t.privacyTermsNotice.split('利用規約')[1]}
          </>
        )}
      </p>
    </div>
  );
}