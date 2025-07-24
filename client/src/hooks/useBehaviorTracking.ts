import { useEffect } from 'react';
import { apiRequest } from '@/lib/queryClient';

interface TrackBehaviorParams {
  action: string;
  page: string;
  feature?: string;
  duration?: number;
  metadata?: Record<string, any>;
}

// 頁面停留時間追蹤
let pageStartTime = Date.now();

export const trackBehavior = async (params: TrackBehaviorParams) => {
  try {
    await apiRequest('POST', '/api/behavior/track', params);
  } catch (error) {
    // 靜默處理追蹤錯誤，不影響主要功能
    console.debug('Behavior tracking failed:', error);
  }
};

// Hook: 追蹤頁面瀏覽
export const usePageViewTracking = (page: string, feature?: string, metadata?: Record<string, any>) => {
  useEffect(() => {
    pageStartTime = Date.now();
    
    // 追蹤頁面進入
    trackBehavior({
      action: 'page_view',
      page,
      feature,
      metadata
    });

    // 頁面離開時追蹤停留時間
    return () => {
      const duration = Date.now() - pageStartTime;
      trackBehavior({
        action: 'page_exit',
        page,
        feature,
        duration,
        metadata
      });
    };
  }, [page, feature]);
};

// Hook: 追蹤功能使用
export const useFeatureTracking = () => {
  const trackFeatureUsage = (feature: string, action: string, page: string, metadata?: Record<string, any>) => {
    trackBehavior({
      action,
      page,
      feature,
      metadata
    });
  };

  return { trackFeatureUsage };
};

// Hook: 追蹤計算器使用
export const useCalculatorTracking = (page: string) => {
  const trackCalculation = (formData: any, results: any) => {
    trackBehavior({
      action: 'calculation',
      page,
      feature: 'calculator',
      metadata: {
        targetRevenue: formData.targetRevenue,
        averageOrderValue: formData.averageOrderValue,
        conversionRate: formData.conversionRate,
        dailyAdBudget: results.dailyAdBudget,
        targetRoas: results.targetRoas,
        dataSource: formData.selectedGaProperty ? 'google_analytics' : 'manual'
      }
    });
  };

  return { trackCalculation };
};

// Hook: 追蹤 FB 廣告健檢使用
export const useFbAuditTracking = (page: string) => {
  const trackAccountSelection = (accountId: string, accountName: string) => {
    trackBehavior({
      action: 'account_selection',
      page,
      feature: 'fbaudit',
      metadata: {
        accountId,
        accountName
      }
    });
  };

  const trackPlanSelection = (planId: string, planName: string) => {
    trackBehavior({
      action: 'plan_selection',
      page,
      feature: 'fbaudit',
      metadata: {
        planId,
        planName
      }
    });
  };

  const trackHealthCheck = (accountId: string, planId: string, industry: string) => {
    trackBehavior({
      action: 'health_check',
      page,
      feature: 'fbaudit',
      metadata: {
        accountId,
        planId,
        industry
      }
    });
  };

  const trackNPSRating = (healthCheckId: string, rating: number, comment?: string) => {
    trackBehavior({
      action: 'nps_rating',
      page,
      feature: 'fbaudit',
      metadata: {
        healthCheckId,
        rating,
        hasComment: Boolean(comment)
      }
    });
  };

  return { 
    trackAccountSelection, 
    trackPlanSelection, 
    trackHealthCheck, 
    trackNPSRating 
  };
};

// Hook: 追蹤活動規劃師使用
export const useCampaignPlannerTracking = (page: string) => {
  const trackPlanCreation = (formData: any, results: any) => {
    trackBehavior({
      action: 'plan_creation',
      page,
      feature: 'campaign_planner',
      metadata: {
        duration: formData.duration,
        totalBudget: formData.totalBudget,
        targetRevenue: formData.targetRevenue,
        periods: results.periods?.length || 0
      }
    });
  };

  const trackPlanSave = (planId: string, planName: string) => {
    trackBehavior({
      action: 'plan_save',
      page,
      feature: 'campaign_planner',
      metadata: {
        planId,
        planName
      }
    });
  };

  return { trackPlanCreation, trackPlanSave };
};