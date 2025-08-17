import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface AdminStats {
  totalUsers: number;
  proUsers: number;
  freeUsers: number;
  totalCredits: number;
  dailyActiveUsers: number;
  retention7Day: number;
  retention30Day: number;
}

export interface AdminUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  membershipLevel: string;
  membershipExpires: string | null;
  createdAt: string;
}

export function useAdminStats() {
  return useQuery<AdminStats>({
    queryKey: ['/api/bdmin/stats'],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useAdminUsers() {
  return useQuery<AdminUser[]>({
    queryKey: ['/api/bdmin/users'],
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

export function useBulkMembershipUpdate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ userIds, membershipLevel, duration }: {
      userIds: string[];
      membershipLevel: string;
      duration?: number;
    }) => {
      return await apiRequest('POST', '/api/bdmin/users/bulk-membership', {
        userIds,
        membershipLevel,
        duration
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bdmin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/bdmin/stats'] });
    },
  });
}

export function useBulkCreditsUpdate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ userIds, amount }: {
      userIds: string[];
      amount: number;
    }) => {
      return await apiRequest('POST', '/api/bdmin/users/bulk-credits', {
        userIds,
        amount
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bdmin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/bdmin/stats'] });
    },
  });
}

// 用戶活動監控相關的 hooks
export interface UserActivityData {
  dailyStats: Array<{
    login_date: string;
    unique_users: number;
    total_logins: number;
  }>;
  activityStats: {
    total_users: number;
    daily_active: number;
    weekly_active: number;
    monthly_active: number;
    daily_retention_rate: number;
    weekly_retention_rate: number;
  };
  membershipActivity: Array<{
    membership_level: string;
    total_users: number;
    weekly_active_users: number;
    activity_rate: number;
  }>;
  todayLogins: Array<{
    email: string;
    login_hour: number;
    last_login_at: string;
    membership_level: string;
  }>;
  generatedAt: string;
}

export function useUserActivity(period: string = '30') {
  return useQuery<UserActivityData>({
    queryKey: ['/api/bdmin/user-activity', period],
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}