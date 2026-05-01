import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { adActionLogs, adActionRecommendations } from "@shared/schema";
import type { AdDecisionEngineOutput } from "./types";

export class AdRecommendationRepository {
  async saveRun(input: {
    userId: string;
    companyId: string;
    planResultId: string;
    adAccountId: string;
    output: AdDecisionEngineOutput;
  }) {
    const saved = [];

    for (const recommendation of input.output.recommendations) {
      const [created] = await db
        .insert(adActionRecommendations)
        .values({
          userId: input.userId,
          companyId: input.companyId,
          planResultId: input.planResultId,
          adAccountId: input.adAccountId,
          decisionMode: input.output.decisionMode,
          overallStatus: input.output.overallStatus,
          priority: recommendation.priority,
          actionType: recommendation.actionType,
          targetLevel: recommendation.targetLevel,
          targetId: recommendation.targetId,
          targetName: recommendation.targetName,
          reasonSummary: recommendation.reasonSummary,
          detailedReason: recommendation.detailedReason,
          recommendedAction: recommendation.recommendedAction,
          riskNote: recommendation.riskNote,
          metricsSnapshot: recommendation.metricsSnapshot,
          ruleSnapshot: recommendation.ruleSnapshot,
          contextSnapshot: recommendation.contextSnapshot,
          approvalStatus: "pending",
        })
        .returning();

      await db.insert(adActionLogs).values({
        recommendationId: created.id,
        userId: input.userId,
        companyId: input.companyId,
        action: "created",
        metadata: {
          decisionMode: input.output.decisionMode,
          overallStatus: input.output.overallStatus,
          summary: input.output.summary,
        },
      });

      saved.push(created);
    }

    return saved;
  }

  async listForUser(userId: string, companyId?: string) {
    const where = companyId
      ? and(eq(adActionRecommendations.userId, userId), eq(adActionRecommendations.companyId, companyId))
      : eq(adActionRecommendations.userId, userId);

    return db
      .select()
      .from(adActionRecommendations)
      .where(where)
      .orderBy(desc(adActionRecommendations.createdAt))
      .limit(50);
  }

  async updateStatus(input: {
    userId: string;
    recommendationId: string;
    status: "approved" | "rejected" | "dismissed";
    note?: string;
  }) {
    const [existing] = await db
      .select()
      .from(adActionRecommendations)
      .where(and(eq(adActionRecommendations.id, input.recommendationId), eq(adActionRecommendations.userId, input.userId)))
      .limit(1);

    if (!existing) return null;

    const now = new Date();
    const timestampUpdate =
      input.status === "approved"
        ? { approvedAt: now }
        : input.status === "rejected"
          ? { rejectedAt: now }
          : {};

    const [updated] = await db
      .update(adActionRecommendations)
      .set({
        approvalStatus: input.status,
        operatorNote: input.note,
        updatedAt: now,
        ...timestampUpdate,
      })
      .where(eq(adActionRecommendations.id, input.recommendationId))
      .returning();

    await db.insert(adActionLogs).values({
      recommendationId: existing.id,
      userId: input.userId,
      companyId: existing.companyId,
      action: input.status,
      note: input.note,
      metadata: {
        previousStatus: existing.approvalStatus,
        nextStatus: input.status,
      },
    });

    return updated;
  }
}

export const adRecommendationRepository = new AdRecommendationRepository();
