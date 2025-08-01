import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface MembershipStatus {
  level: "free" | "pro";
  isActive: boolean;
  expiresAt?: string;
}

export function useMembershipStatus() {
  return useQuery({
    queryKey: ["/api/membership/status"],
    staleTime: 0, // Force fresh data
    gcTime: 1 * 60 * 1000, // 1分鐘快取
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    retry: false, // 不重試，認證失敗時立即返回
    queryFn: async () => {
      try {
        const response = await fetch('/api/membership/status', {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (response.status === 401) {
          // 未認證，返回 free 會員狀態
          return {
            level: "free" as const,
            isActive: true,
            expiresAt: undefined
          };
        }
        
        if (!response.ok) {
          throw new Error('Failed to fetch membership status');
        }
        
        return await response.json();
      } catch (error) {
        console.log('Membership status check failed, defaulting to free:', error);
        return {
          level: "free" as const,
          isActive: true,
          expiresAt: undefined
        };
      }
    },
  });
}

export function useUpgradeToPro() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (durationDays: number = 30) => {
      return await apiRequest('POST', '/api/membership/upgrade-to-pro', { durationDays });
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/membership/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });
}

// Utility function to check if user has required membership level
export function checkMembershipAccess(
  userLevel: "free" | "pro", 
  requiredLevel: "free" | "pro"
): boolean {
  if (requiredLevel === "free") return true;
  if (requiredLevel === "pro" && userLevel === "pro") return true;
  return false;
}

// Custom hook for protected features
export function useProtectedFeature(requiredLevel: "free" | "pro" = "pro") {
  const { data: membership, isLoading } = useMembershipStatus();
  
  const membershipData = membership as MembershipStatus | undefined;
  
  // 如果還在載入中，則沒有權限
  if (isLoading) {
    return {
      hasAccess: false,
      membershipLevel: undefined,
      isActive: false,
      expiresAt: undefined,
      isLoading: true,
      requiresUpgrade: false,
    };
  }

  // 如果沒有會員資料（未登入或查詢失敗），視為需要升級
  if (!membershipData) {
    return {
      hasAccess: false,
      membershipLevel: 'free' as const,
      isActive: false,
      expiresAt: undefined,
      isLoading: false,
      requiresUpgrade: true,
    };
  }

  const hasAccess = checkMembershipAccess(membershipData.level, requiredLevel) && membershipData.isActive;
  
  return {
    hasAccess,
    membershipLevel: membershipData.level,
    isActive: membershipData.isActive,
    expiresAt: membershipData.expiresAt,
    isLoading: false,
    requiresUpgrade: !hasAccess,
  };
}