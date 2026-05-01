import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { planResults } from "@shared/schema";

export class PlanContextLoader {
  async getActivePlanForUser(userId: string) {
    const [plan] = await db
      .select()
      .from(planResults)
      .where(and(eq(planResults.userId, userId), eq(planResults.isActive, true)))
      .orderBy(desc(planResults.updatedAt))
      .limit(1);

    return plan ?? null;
  }

  async getPlanById(userId: string, planResultId: string) {
    const [plan] = await db
      .select()
      .from(planResults)
      .where(and(eq(planResults.id, planResultId), eq(planResults.userId, userId)))
      .limit(1);

    return plan ?? null;
  }

  async getPlansForUser(userId: string) {
    return db
      .select({
        id: planResults.id,
        planName: planResults.planName,
        targetRoas: planResults.targetRoas,
        dailyAdBudget: planResults.dailyAdBudget,
        requiredOrders: planResults.requiredOrders,
        currency: planResults.currency,
        isActive: planResults.isActive,
        updatedAt: planResults.updatedAt,
        createdAt: planResults.createdAt,
      })
      .from(planResults)
      .where(eq(planResults.userId, userId))
      .orderBy(desc(planResults.updatedAt));
  }
}

export const planContextLoader = new PlanContextLoader();
