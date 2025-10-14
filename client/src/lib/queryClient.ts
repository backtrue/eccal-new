import { QueryClient, QueryFunction } from "@tanstack/react-query";

const SCOPED_TOKEN_KEY = 'eccal_auth_scoped_token';
const TOKEN_EXPIRY_KEY = 'eccal_auth_scoped_token_expiry';

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

/**
 * 取得短效 scoped token
 * 自動管理快取和過期時間
 */
async function getScopedToken(): Promise<string | null> {
  try {
    // 檢查快取的 token 是否還有效
    const cachedToken = localStorage.getItem(SCOPED_TOKEN_KEY);
    const expiryTime = localStorage.getItem(TOKEN_EXPIRY_KEY);
    
    if (cachedToken && expiryTime) {
      const now = Date.now();
      const expiry = parseInt(expiryTime);
      
      // 如果 token 還有效（提前 1 分鐘更新避免邊界問題）
      if (expiry > now + 60000) {
        return cachedToken;
      }
    }
    
    // 快取失效或不存在，重新取得
    const res = await fetch('/api/auth/get-token', {
      credentials: 'include'
    });
    
    if (!res.ok) {
      // 如果取得失敗（例如未登入），清除快取並返回 null
      localStorage.removeItem(SCOPED_TOKEN_KEY);
      localStorage.removeItem(TOKEN_EXPIRY_KEY);
      return null;
    }
    
    const data = await res.json();
    
    if (data.success && data.token) {
      // 儲存 token 和過期時間
      localStorage.setItem(SCOPED_TOKEN_KEY, data.token);
      const expiryTime = Date.now() + (data.expiresIn * 1000); // expiresIn 是秒數
      localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());
      
      return data.token;
    }
    
    return null;
  } catch (error) {
    console.error('Failed to get scoped token:', error);
    return null;
  }
}

/**
 * 清除快取的 scoped token
 * 登出時應該呼叫此函數
 */
export function clearScopedToken() {
  localStorage.removeItem(SCOPED_TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // 取得 scoped token（如果有的話）
  const scopedToken = await getScopedToken();
  
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
  
  // 如果有 scoped token，加入 Authorization header
  if (scopedToken) {
    headers["Authorization"] = `Bearer ${scopedToken}`;
  }
  
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // 取得 scoped token（如果有的話）
    const scopedToken = await getScopedToken();
    
    const headers: Record<string, string> = {};
    
    // 如果有 scoped token，加入 Authorization header
    if (scopedToken) {
      headers["Authorization"] = `Bearer ${scopedToken}`;
    }
    
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false, // 減少掛載時的自動請求
      refetchOnReconnect: false, // 減少重連時的自動請求
      staleTime: 30 * 60 * 1000, // 延長到30分鐘減少API請求
      gcTime: 45 * 60 * 1000, // 45分鐘後清除快取
      retry: false,
      retryOnMount: false, // 停用掛載重試
    },
    mutations: {
      retry: false,
    },
  },
});
