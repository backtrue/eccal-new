import type {
  Company,
  CompanyAdAccount,
  CompanyFinancialProfile,
  DecisionRuleSet,
  PlanResult,
  ProductProfile,
} from "@shared/schema";

export type CompanyContext = {
  company: Company;
  financialProfile: CompanyFinancialProfile | null;
  adAccounts: CompanyAdAccount[];
  products: ProductProfile[];
  activeDecisionRuleSet: DecisionRuleSet | null;
};

export type MetaActualMetrics = {
  adAccountId: string;
  dateRange: {
    since: string;
    until: string;
  };
  spend: number;
  dailySpend: number;
  purchases: number;
  dailyPurchases: number;
  roas: number;
  ctr: number;
  impressions?: number;
  clicks?: number;
  cpc?: number;
  cpm?: number;
  cpa: number | null;
  spendRate?: number;
  raw?: unknown;
};

export type DecisionRuleValues = {
  spendRateFullThreshold: number;
  initialJudgementImpressions: number;
  stopLossImpressions: number;
  minActiveAdsPerAdset: number;
  cpaWarningMultiplier: number;
  cpaStopMultiplier: number;
  roasWarningRatio: number;
  ctrWarningThreshold: number;
  budgetIncreaseRatio: number;
  budgetDecreaseRatio: number;
  observationWindowDays: number;
  protectLearningPhase: boolean;
  avoidEditingExistingAds: boolean;
};

export type DecisionMode =
  | "financial_decision"
  | "technical_troubleshooting"
  | "insufficient_data"
  | "mixed";

export type OverallStatus =
  | "can_scale"
  | "observe"
  | "needs_fix"
  | "stop_loss"
  | "insufficient_data";

export type RecommendationAction =
  | "increase_budget"
  | "decrease_budget"
  | "pause_ad"
  | "pause_adset"
  | "move_budget"
  | "add_creatives"
  | "create_new_adset"
  | "fix_tracking"
  | "improve_landing_page"
  | "observe"
  | "other";

export type RecommendationDraft = {
  priority: "high" | "medium" | "low";
  actionType: RecommendationAction;
  targetLevel: "account" | "campaign" | "adset" | "ad" | "creative" | "landing_page" | "tracking";
  targetId?: string;
  targetName?: string;
  reasonSummary: string;
  detailedReason?: string;
  recommendedAction: string;
  riskNote?: string;
  metricsSnapshot: Record<string, unknown>;
  ruleSnapshot: Record<string, unknown>;
  contextSnapshot?: Record<string, unknown>;
};

export type AdDecisionEngineInput = {
  userId: string;
  companyContext: CompanyContext;
  plan: PlanResult;
  actual: MetaActualMetrics;
  ruleSet: DecisionRuleValues;
  locale?: string;
};

export type AdDecisionEngineOutput = {
  decisionMode: DecisionMode;
  overallStatus: OverallStatus;
  summary: string;
  recommendations: RecommendationDraft[];
};
