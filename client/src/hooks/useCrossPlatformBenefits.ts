import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface EccalPurchase {
  id: string;
  userId: string;
  planType: 'monthly' | 'annual' | 'founders';
  purchaseAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  accessStartDate: string;
  accessEndDate?: string | null;
  fabeAccess: boolean;
  fabeAccessSynced: boolean;
  metadata: any;
  createdAt: string;
  updatedAt: string;
}

interface CrossPlatformBenefits {
  hasFabeAccess: boolean;
  foundersPlan?: {
    purchaseId: string;
    purchaseDate: string;
    fabeAccessSynced: boolean;
  };
}

interface CrossPlatformData {
  purchases: EccalPurchase[];
  crossPlatformBenefits: CrossPlatformBenefits;
}

export function useCrossPlatformBenefits(userId?: string) {
  return useQuery({
    queryKey: ['/api/eccal-purchase/user-purchases', userId],
    queryFn: async (): Promise<CrossPlatformData | null> => {
      if (!userId) return null;
      
      console.log('useCrossPlatformBenefits: Fetching data for userId:', userId);
      const response = await apiRequest(`/api/eccal-purchase/user-purchases/${userId}`);
      console.log('useCrossPlatformBenefits: API response:', response);
      return response.data;
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

export function useFabeAccess(userId?: string) {
  const { data, isLoading, error } = useCrossPlatformBenefits(userId);
  
  console.log('useFabeAccess: Processing data:', {
    userId,
    data,
    hasFabeAccess: data?.crossPlatformBenefits?.hasFabeAccess,
    isLoading,
    error
  });
  
  return {
    hasFabeAccess: data?.crossPlatformBenefits?.hasFabeAccess || false,
    foundersPlan: data?.crossPlatformBenefits?.foundersPlan,
    purchases: data?.purchases || [],
    isLoading,
    error,
  };
}