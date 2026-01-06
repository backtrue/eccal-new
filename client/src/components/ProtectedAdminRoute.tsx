import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLocation } from 'wouter';

interface ProtectedAdminRouteProps {
  children: React.ReactNode;
}

const ADMIN_EMAILS = ['backtrue@gmail.com', 'backtrue@seo-tw.org', 'service@achange.com.tw'];

export default function ProtectedAdminRoute({ children }: ProtectedAdminRouteProps) {
  const { user, isLoading, isAuthenticated, checkAuth } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    // Debug information
    console.log('Admin Route Debug:', {
      isLoading,
      isAuthenticated,
      user,
      userEmail: user?.email,
      isAdmin: user ? ADMIN_EMAILS.includes(user.email || '') : false
    });

    // 避免無限重定向 - 只在首次載入時檢查認證
    if (!isLoading && !isAuthenticated && !user) {
      console.log('Admin route: User not authenticated, will show login UI');
      // 不自動重定向，讓用戶手動點擊登入按鈕
      return;
    }

    if (!isLoading && isAuthenticated && user && !ADMIN_EMAILS.includes(user.email || '')) {
      console.log('Redirecting to home - not admin:', user.email);
      setLocation('/');
      return;
    }
  }, [isAuthenticated, isLoading, user, setLocation, checkAuth]);

  // 載入中顯示載入畫面
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">驗證管理員權限中...</p>
        </div>
      </div>
    );
  }

  // 未登入時顯示登入選項，非管理員時顯示錯誤訊息
  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🔐</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">需要登入</h1>
          <p className="text-gray-600 mb-4">請先登入您的管理員帳號</p>
          <button
            onClick={() => window.location.href = '/api/auth/google?returnTo=/bdmin'}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 mr-4"
          >
            Google 登入
          </button>
          {process.env.NODE_ENV === 'development' && (
            <button
              onClick={async () => {
                try {
                  const response = await fetch('/api/auth/test-login', {
                    method: 'POST',
                    credentials: 'include'
                  });
                  if (response.ok) {
                    window.location.reload();
                  }
                } catch (error) {
                  console.error('Test login failed:', error);
                }
              }}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 mr-4"
            >
              測試登入
            </button>
          )}
          <button
            onClick={() => setLocation('/')}
            className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
          >
            返回首頁
          </button>
        </div>
      </div>
    );
  }

  // 已登入但非管理員，顯示錯誤訊息
  if (!ADMIN_EMAILS.includes(user.email || '')) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🚫</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">存取被拒絕</h1>
          <p className="text-gray-600 mb-4">您沒有權限訪問此管理頁面</p>
          <p className="text-sm text-gray-500 mb-4">當前登入帳號：{user.email}</p>
          <button
            onClick={() => setLocation('/')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            返回首頁
          </button>
        </div>
      </div>
    );
  }

  // 管理員權限驗證通過，顯示內容
  return <>{children}</>;
}