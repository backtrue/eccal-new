import type {
  AdDecisionEngineInput,
  AdDecisionEngineOutput,
  OverallStatus,
  RecommendationDraft,
} from "./types";

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildSnapshot(input: AdDecisionEngineInput, extra: Record<string, unknown>) {
  return {
    actual: input.actual,
    plan: {
      id: input.plan.id,
      planName: input.plan.planName,
      dailyAdBudget: input.plan.dailyAdBudget,
      requiredOrders: input.plan.requiredOrders,
      targetRoas: input.plan.targetRoas,
      currency: input.plan.currency,
    },
    ...extra,
  };
}

export class AdDecisionEngine {
  evaluate(input: AdDecisionEngineInput): AdDecisionEngineOutput {
    const targetDailyBudget = toNumber(input.plan.dailyAdBudget);
    const targetRoas = toNumber(input.plan.targetRoas);
    const targetDailyOrders = Math.max(1, Math.round(toNumber(input.plan.requiredOrders) / 30));
    const spendRate = targetDailyBudget > 0 ? input.actual.dailySpend / targetDailyBudget : 0;
    const budgetIsFull = spendRate >= input.ruleSet.spendRateFullThreshold;
    const roasAchieved = input.actual.roas >= targetRoas;
    const ordersAchieved = input.actual.dailyPurchases >= targetDailyOrders;
    const hasPurchase = input.actual.purchases > 0 || input.actual.dailyPurchases > 0;
    const actualCpa = input.actual.cpa;
    const targetCpa = targetDailyOrders > 0 ? targetDailyBudget / targetDailyOrders : null;

    if (
      typeof input.actual.impressions === "number" &&
      input.actual.impressions < input.ruleSet.initialJudgementImpressions
    ) {
      return this.singleRecommendation(input, {
        decisionMode: "insufficient_data",
        overallStatus: "insufficient_data",
        summary: "目前曝光還不到初判門檻，先累積資料，不急著動廣告。",
        recommendation: {
          priority: "low",
          actionType: "observe",
          targetLevel: "account",
          reasonSummary: "曝光量不足，資料還不能支撐關閉、加碼或降預算判斷。",
          detailedReason: `目前曝光 ${input.actual.impressions}，低於初判門檻 ${input.ruleSet.initialJudgementImpressions}。`,
          recommendedAction: "先觀察到曝光達門檻後再重新巡帳。",
          riskNote: "資料不足時貿然調整，容易錯殺仍在學習的廣告。",
          metricsSnapshot: buildSnapshot(input, { spendRate, targetDailyBudget, targetRoas, targetDailyOrders }),
          ruleSnapshot: input.ruleSet,
          contextSnapshot: this.contextSnapshot(input),
        },
      });
    }

    if (!hasPurchase) {
      return this.evaluateTechnicalTroubleshooting(input, spendRate, targetDailyBudget);
    }

    if (roasAchieved && budgetIsFull) {
      return this.singleRecommendation(input, {
        decisionMode: "financial_decision",
        overallStatus: "can_scale",
        summary: "ROAS 達標且預算基本花滿，這組已經進入可放大的狀態。",
        recommendation: {
          priority: "high",
          actionType: "increase_budget",
          targetLevel: "account",
          reasonSummary: "ROAS 達標，且預算花費率已達加碼門檻。",
          detailedReason: `目前 ROAS ${input.actual.roas}，目標 ROAS ${targetRoas}；預算花費率 ${Math.round(spendRate * 100)}%。`,
          recommendedAction: `建議先小幅加碼 ${Math.round(input.ruleSet.budgetIncreaseRatio * 100)}%，觀察 CPA / ROAS 是否仍維持在目標線內。`,
          riskNote: "不要一次拉太大，避免破壞穩定投放與學習狀態。",
          metricsSnapshot: buildSnapshot(input, { spendRate, targetDailyBudget, targetRoas, targetDailyOrders, ordersAchieved }),
          ruleSnapshot: input.ruleSet,
          contextSnapshot: this.contextSnapshot(input),
        },
      });
    }

    if (actualCpa !== null && targetCpa !== null && actualCpa >= targetCpa * input.ruleSet.cpaStopMultiplier) {
      return this.singleRecommendation(input, {
        decisionMode: "financial_decision",
        overallStatus: "stop_loss",
        summary: "有轉單，但 CPA 已經明顯高於目標，需要先止損。",
        recommendation: {
          priority: "high",
          actionType: "decrease_budget",
          targetLevel: "account",
          reasonSummary: "CPA 超過停止門檻，短期不適合加碼。",
          detailedReason: `目前 CPA ${actualCpa}，目標 CPA 約 ${round(targetCpa, 2)}，已超過 ${input.ruleSet.cpaStopMultiplier} 倍門檻。`,
          recommendedAction: `建議先降低 ${Math.round(input.ruleSet.budgetDecreaseRatio * 100)}% 預算，並檢查高花費低轉換的活動或廣告組。`,
          riskNote: "MVP 只產生建議，不會自動改 Meta 預算。",
          metricsSnapshot: buildSnapshot(input, { spendRate, targetDailyBudget, targetRoas, targetDailyOrders, targetCpa }),
          ruleSnapshot: input.ruleSet,
          contextSnapshot: this.contextSnapshot(input),
        },
      });
    }

    if (!roasAchieved) {
      const status: OverallStatus = input.actual.roas < targetRoas * input.ruleSet.roasWarningRatio ? "needs_fix" : "observe";
      return this.singleRecommendation(input, {
        decisionMode: "financial_decision",
        overallStatus: status,
        summary: "有轉單但 ROAS 尚未達標，先觀察並找出效率落差，不建議加碼。",
        recommendation: {
          priority: status === "needs_fix" ? "medium" : "low",
          actionType: status === "needs_fix" ? "decrease_budget" : "observe",
          targetLevel: "account",
          reasonSummary: "ROAS 未達標，尚未進入可放大狀態。",
          detailedReason: `目前 ROAS ${input.actual.roas}，低於目標 ROAS ${targetRoas}。`,
          recommendedAction: status === "needs_fix"
            ? "先降低低效率預算並檢查素材、受眾與落地頁，不要直接加碼。"
            : "先維持預算觀察，等待更多轉換資料再判斷是否調整。",
          riskNote: "ROAS 未達標時加碼，可能只是把虧損放大。",
          metricsSnapshot: buildSnapshot(input, { spendRate, targetDailyBudget, targetRoas, targetDailyOrders, targetCpa }),
          ruleSnapshot: input.ruleSet,
          contextSnapshot: this.contextSnapshot(input),
        },
      });
    }

    return this.singleRecommendation(input, {
      decisionMode: "financial_decision",
      overallStatus: "observe",
      summary: "目前有效率，但還沒有足夠條件判定要加碼。",
      recommendation: {
        priority: "low",
        actionType: "observe",
        targetLevel: "account",
        reasonSummary: "ROAS 達標但預算尚未花滿，先不要急著調整。",
        detailedReason: `目前預算花費率 ${Math.round(spendRate * 100)}%，低於 ${Math.round(input.ruleSet.spendRateFullThreshold * 100)}% 加碼門檻。`,
        recommendedAction: "先觀察投放是否能穩定花出預算，再判斷是否加碼或調整受眾。",
        metricsSnapshot: buildSnapshot(input, { spendRate, targetDailyBudget, targetRoas, targetDailyOrders, ordersAchieved }),
        ruleSnapshot: input.ruleSet,
        contextSnapshot: this.contextSnapshot(input),
      },
    });
  }

  private evaluateTechnicalTroubleshooting(
    input: AdDecisionEngineInput,
    spendRate: number,
    targetDailyBudget: number,
  ): AdDecisionEngineOutput {
    const ctrTooLow = input.actual.ctr > 0 && input.actual.ctr < input.ruleSet.ctrWarningThreshold;
    const spentMeaningfully = targetDailyBudget > 0 ? spendRate >= 0.5 : input.actual.spend > 0;
    const recommendation: RecommendationDraft = {
      priority: ctrTooLow || spentMeaningfully ? "medium" : "low",
      actionType: ctrTooLow ? "add_creatives" : "observe",
      targetLevel: ctrTooLow ? "creative" : "account",
      reasonSummary: ctrTooLow
        ? "目前沒有轉單，且 CTR 偏低，優先補素材角度。"
        : "目前沒有轉單，但還不足以判定素材或受眾已失效。",
      detailedReason: `過去區間購買數為 0，CTR 為 ${input.actual.ctr}%。`,
      recommendedAction: ctrTooLow
        ? "下一輪先補三種素材角度：情境痛點、價格疑慮、角色認同，再觀察是否拉高點擊與轉換。"
        : "先維持觀察，確認曝光、點擊與事件追蹤資料是否持續進來。",
      riskNote: "沒有轉單時不要只看 ROAS，需先排除素材、受眾與 tracking 問題。",
      metricsSnapshot: buildSnapshot(input, { spendRate, targetDailyBudget }),
      ruleSnapshot: input.ruleSet,
      contextSnapshot: this.contextSnapshot(input),
    };

    return {
      decisionMode: "technical_troubleshooting",
      overallStatus: ctrTooLow ? "needs_fix" : "observe",
      summary: ctrTooLow
        ? "目前比較像素材或第一眼吸引力問題，先補素材，不急著加碼。"
        : "目前沒有轉單，先進入技術排查與觀察。",
      recommendations: [recommendation],
    };
  }

  private singleRecommendation(
    _input: AdDecisionEngineInput,
    payload: {
      decisionMode: AdDecisionEngineOutput["decisionMode"];
      overallStatus: AdDecisionEngineOutput["overallStatus"];
      summary: string;
      recommendation: RecommendationDraft;
    },
  ): AdDecisionEngineOutput {
    return {
      decisionMode: payload.decisionMode,
      overallStatus: payload.overallStatus,
      summary: payload.summary,
      recommendations: [payload.recommendation],
    };
  }

  private contextSnapshot(input: AdDecisionEngineInput): Record<string, unknown> {
    return {
      companyId: input.companyContext.company.id,
      brandName: input.companyContext.company.brandName,
      businessModel: input.companyContext.company.businessModel,
      primaryMarket: input.companyContext.company.primaryMarket,
      currency: input.companyContext.company.currency,
      hasFinancialProfile: Boolean(input.companyContext.financialProfile),
      adAccountsCount: input.companyContext.adAccounts.length,
    };
  }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export const adDecisionEngine = new AdDecisionEngine();
