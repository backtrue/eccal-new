import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { decisionRuleSets, type DecisionRuleSet } from "@shared/schema";
import type { DecisionRuleValues } from "./types";

export const DEFAULT_DECISION_RULES: DecisionRuleValues = {
  spendRateFullThreshold: 0.95,
  initialJudgementImpressions: 500,
  stopLossImpressions: 8000,
  minActiveAdsPerAdset: 3,
  cpaWarningMultiplier: 1.2,
  cpaStopMultiplier: 1.5,
  roasWarningRatio: 0.8,
  ctrWarningThreshold: 1.0,
  budgetIncreaseRatio: 0.2,
  budgetDecreaseRatio: 0.2,
  observationWindowDays: 3,
  protectLearningPhase: true,
  avoidEditingExistingAds: true,
};

function toNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeDecisionRules(ruleSet?: DecisionRuleSet | null): DecisionRuleValues {
  return {
    spendRateFullThreshold: toNumber(ruleSet?.spendRateFullThreshold, DEFAULT_DECISION_RULES.spendRateFullThreshold),
    initialJudgementImpressions: toNumber(ruleSet?.initialJudgementImpressions, DEFAULT_DECISION_RULES.initialJudgementImpressions),
    stopLossImpressions: toNumber(ruleSet?.stopLossImpressions, DEFAULT_DECISION_RULES.stopLossImpressions),
    minActiveAdsPerAdset: toNumber(ruleSet?.minActiveAdsPerAdset, DEFAULT_DECISION_RULES.minActiveAdsPerAdset),
    cpaWarningMultiplier: toNumber(ruleSet?.cpaWarningMultiplier, DEFAULT_DECISION_RULES.cpaWarningMultiplier),
    cpaStopMultiplier: toNumber(ruleSet?.cpaStopMultiplier, DEFAULT_DECISION_RULES.cpaStopMultiplier),
    roasWarningRatio: toNumber(ruleSet?.roasWarningRatio, DEFAULT_DECISION_RULES.roasWarningRatio),
    ctrWarningThreshold: toNumber(ruleSet?.ctrWarningThreshold, DEFAULT_DECISION_RULES.ctrWarningThreshold),
    budgetIncreaseRatio: toNumber(ruleSet?.budgetIncreaseRatio, DEFAULT_DECISION_RULES.budgetIncreaseRatio),
    budgetDecreaseRatio: toNumber(ruleSet?.budgetDecreaseRatio, DEFAULT_DECISION_RULES.budgetDecreaseRatio),
    observationWindowDays: toNumber(ruleSet?.observationWindowDays, DEFAULT_DECISION_RULES.observationWindowDays),
    protectLearningPhase: ruleSet?.protectLearningPhase ?? DEFAULT_DECISION_RULES.protectLearningPhase,
    avoidEditingExistingAds: ruleSet?.avoidEditingExistingAds ?? DEFAULT_DECISION_RULES.avoidEditingExistingAds,
  };
}

export class DecisionRuleService {
  async getActiveRuleSet(companyId: string): Promise<DecisionRuleSet | null> {
    const [companyRuleSet] = await db
      .select()
      .from(decisionRuleSets)
      .where(and(eq(decisionRuleSets.companyId, companyId), eq(decisionRuleSets.isActive, true)))
      .limit(1);

    return companyRuleSet ?? null;
  }

  async upsertCompanyRuleSet(companyId: string, input: Partial<typeof decisionRuleSets.$inferInsert>) {
    const [existing] = await db
      .select()
      .from(decisionRuleSets)
      .where(and(eq(decisionRuleSets.companyId, companyId), eq(decisionRuleSets.name, input.name || "default")))
      .limit(1);

    const values = {
      ...input,
      companyId,
      name: input.name || "default",
      isDefault: false,
      isActive: input.isActive ?? true,
      updatedAt: new Date(),
    };

    if (existing) {
      const [updated] = await db
        .update(decisionRuleSets)
        .set(values)
        .where(eq(decisionRuleSets.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(decisionRuleSets).values(values).returning();
    return created;
  }
}

export const decisionRuleService = new DecisionRuleService();
