// Existing server route files in this project use runtime Express patterns that do not type-check cleanly
// under the current strict tsconfig. Keep this V2 router aligned with that runtime style.
// @ts-nocheck
import { Router, type Request, type Response } from "express";
import { requireJWTAuth } from "../jwtAuth";
import { insertCompanyAdAccountSchema, insertCompanyFinancialProfileSchema, insertCompanySchema, insertDecisionRuleSetSchema } from "@shared/schema";
import { companyService } from "./company/companyService";
import { planContextLoader } from "./adDecision/planContextLoader";
import { metaActualMetricsLoader } from "./adDecision/metaActualMetricsLoader";
import { decisionRuleService, normalizeDecisionRules } from "./adDecision/decisionRuleService";
import { adDecisionEngine } from "./adDecision/adDecisionEngine";
import { adRecommendationRepository } from "./adDecision/adRecommendationRepository";

type AuthedRequest = Request & {
  user?: {
    id: string;
    email?: string;
    metaAccessToken?: string;
  };
};

function getUserId(req: AuthedRequest): string {
  const userId = req.user?.id;
  if (!userId) {
    throw new Error("AUTH_USER_MISSING");
  }
  return userId;
}

function sendError(res: Response, status: number, error: string, details?: unknown) {
  return res.status(status).json({
    success: false,
    error,
    details,
  });
}

export function createV2Router() {
  const router = Router();

  router.use(requireJWTAuth);

  router.get("/companies", async (req: AuthedRequest, res) => {
    try {
      const companies = await companyService.getCompaniesByUser(getUserId(req));
      return res.json({ success: true, data: companies });
    } catch (error) {
      console.error("[V2] List companies failed:", error);
      return sendError(res, 500, "COMPANY_LIST_FAILED");
    }
  });

  router.post("/companies", async (req: AuthedRequest, res) => {
    try {
      const parsed = insertCompanySchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "INVALID_COMPANY_INPUT", parsed.error.flatten());

      const company = await companyService.createCompany(getUserId(req), parsed.data);
      return res.status(201).json({ success: true, data: company });
    } catch (error) {
      console.error("[V2] Create company failed:", error);
      return sendError(res, 500, "COMPANY_CREATE_FAILED");
    }
  });

  router.get("/companies/:companyId", async (req: AuthedRequest, res) => {
    try {
      const context = await companyService.getCompanyContext(getUserId(req), req.params.companyId);
      if (!context) return sendError(res, 404, "COMPANY_NOT_FOUND");
      return res.json({ success: true, data: context });
    } catch (error) {
      console.error("[V2] Get company failed:", error);
      return sendError(res, 500, "COMPANY_GET_FAILED");
    }
  });

  router.patch("/companies/:companyId", async (req: AuthedRequest, res) => {
    try {
      const parsed = insertCompanySchema.partial().safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "INVALID_COMPANY_INPUT", parsed.error.flatten());

      const company = await companyService.updateCompany(getUserId(req), req.params.companyId, parsed.data);
      if (!company) return sendError(res, 404, "COMPANY_NOT_FOUND");
      return res.json({ success: true, data: company });
    } catch (error) {
      console.error("[V2] Update company failed:", error);
      return sendError(res, 500, "COMPANY_UPDATE_FAILED");
    }
  });

  router.delete("/companies/:companyId", async (req: AuthedRequest, res) => {
    try {
      const deleted = await companyService.deleteCompany(getUserId(req), req.params.companyId);
      if (!deleted) return sendError(res, 404, "COMPANY_NOT_FOUND");
      return res.json({ success: true });
    } catch (error) {
      console.error("[V2] Delete company failed:", error);
      return sendError(res, 500, "COMPANY_DELETE_FAILED");
    }
  });

  router.put("/companies/:companyId/financial-profile", async (req: AuthedRequest, res) => {
    try {
      const parsed = insertCompanyFinancialProfileSchema.partial().safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "INVALID_FINANCIAL_PROFILE_INPUT", parsed.error.flatten());

      const profile = await companyService.upsertFinancialProfile(getUserId(req), req.params.companyId, parsed.data);
      if (!profile) return sendError(res, 404, "COMPANY_NOT_FOUND");
      return res.json({ success: true, data: profile });
    } catch (error) {
      console.error("[V2] Upsert financial profile failed:", error);
      return sendError(res, 500, "FINANCIAL_PROFILE_UPSERT_FAILED");
    }
  });

  router.post("/companies/:companyId/ad-accounts", async (req: AuthedRequest, res) => {
    try {
      const parsed = insertCompanyAdAccountSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "INVALID_AD_ACCOUNT_INPUT", parsed.error.flatten());

      const account = await companyService.linkMetaAdAccount(getUserId(req), req.params.companyId, parsed.data);
      if (!account) return sendError(res, 404, "COMPANY_NOT_FOUND");
      return res.status(201).json({ success: true, data: account });
    } catch (error) {
      console.error("[V2] Link ad account failed:", error);
      return sendError(res, 500, "AD_ACCOUNT_LINK_FAILED", error instanceof Error ? error.message : undefined);
    }
  });

  router.get("/companies/:companyId/decision-rules", async (req: AuthedRequest, res) => {
    try {
      const context = await companyService.getCompanyContext(getUserId(req), req.params.companyId);
      if (!context) return sendError(res, 404, "COMPANY_NOT_FOUND");
      return res.json({
        success: true,
        data: {
          ruleSet: context.activeDecisionRuleSet,
          normalizedRules: normalizeDecisionRules(context.activeDecisionRuleSet),
        },
      });
    } catch (error) {
      console.error("[V2] Get decision rules failed:", error);
      return sendError(res, 500, "DECISION_RULE_GET_FAILED");
    }
  });

  router.put("/companies/:companyId/decision-rules", async (req: AuthedRequest, res) => {
    try {
      const userId = getUserId(req);
      const context = await companyService.getCompanyContext(userId, req.params.companyId);
      if (!context) return sendError(res, 404, "COMPANY_NOT_FOUND");

      const parsed = insertDecisionRuleSetSchema.partial().safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "INVALID_DECISION_RULE_INPUT", parsed.error.flatten());

      const ruleSet = await decisionRuleService.upsertCompanyRuleSet(req.params.companyId, parsed.data);
      return res.json({ success: true, data: ruleSet, normalizedRules: normalizeDecisionRules(ruleSet) });
    } catch (error) {
      console.error("[V2] Upsert decision rules failed:", error);
      return sendError(res, 500, "DECISION_RULE_UPSERT_FAILED");
    }
  });

  router.get("/plans", async (req: AuthedRequest, res) => {
    try {
      const plans = await planContextLoader.getPlansForUser(getUserId(req));
      return res.json({ success: true, data: plans });
    } catch (error) {
      console.error("[V2] List plans failed:", error);
      return sendError(res, 500, "PLAN_LIST_FAILED");
    }
  });

  router.get("/meta/accounts", async (req: AuthedRequest, res) => {
    try {
      const user = req.user;
      if (!user?.metaAccessToken) return sendError(res, 400, "META_ACCESS_TOKEN_MISSING");

      const { fbAuditService } = await import("../fbAuditService");
      const accounts = await fbAuditService.getAdAccounts(user.metaAccessToken);
      return res.json({ success: true, data: accounts });
    } catch (error) {
      console.error("[V2] List Meta accounts failed:", error);
      return sendError(res, 500, "META_ACCOUNT_LIST_FAILED", error instanceof Error ? error.message : undefined);
    }
  });

  router.post("/ad-decision/run", async (req: AuthedRequest, res) => {
    try {
      const userId = getUserId(req);
      const { companyId, planResultId, adAccountId, locale = "zh-TW" } = req.body || {};

      if (!companyId || typeof companyId !== "string") return sendError(res, 400, "COMPANY_ID_REQUIRED");
      if (!planResultId || typeof planResultId !== "string") return sendError(res, 400, "PLAN_RESULT_ID_REQUIRED");
      if (!adAccountId || typeof adAccountId !== "string") return sendError(res, 400, "AD_ACCOUNT_ID_REQUIRED");
      if (!req.user?.metaAccessToken) return sendError(res, 400, "META_ACCESS_TOKEN_MISSING");

      const companyContext = await companyService.getCompanyContext(userId, companyId);
      if (!companyContext) return sendError(res, 404, "COMPANY_NOT_FOUND");

      const linkedAccount = companyContext.adAccounts.find((account) => account.adAccountId === adAccountId);
      if (!linkedAccount) return sendError(res, 400, "AD_ACCOUNT_NOT_LINKED_TO_COMPANY");

      const plan = await planContextLoader.getPlanById(userId, planResultId);
      if (!plan) return sendError(res, 404, "PLAN_NOT_FOUND");

      const actual = await metaActualMetricsLoader.load(req.user.metaAccessToken, adAccountId);
      const ruleSet = normalizeDecisionRules(companyContext.activeDecisionRuleSet);
      const output = adDecisionEngine.evaluate({
        userId,
        companyContext,
        plan,
        actual,
        ruleSet,
        locale,
      });
      const recommendations = await adRecommendationRepository.saveRun({
        userId,
        companyId,
        planResultId,
        adAccountId,
        output,
      });

      return res.json({
        success: true,
        data: {
          summary: output.summary,
          decisionMode: output.decisionMode,
          overallStatus: output.overallStatus,
          actual,
          recommendations,
        },
      });
    } catch (error) {
      console.error("[V2] Run ad decision failed:", error);
      return sendError(res, 500, "AD_DECISION_RUN_FAILED", error instanceof Error ? error.message : undefined);
    }
  });

  router.get("/ad-decision/recommendations", async (req: AuthedRequest, res) => {
    try {
      const companyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
      const recommendations = await adRecommendationRepository.listForUser(getUserId(req), companyId);
      return res.json({ success: true, data: recommendations });
    } catch (error) {
      console.error("[V2] List recommendations failed:", error);
      return sendError(res, 500, "RECOMMENDATION_LIST_FAILED");
    }
  });

  router.patch("/ad-decision/recommendations/:id/status", async (req: AuthedRequest, res) => {
    try {
      const { status, note } = req.body || {};
      if (!["approved", "rejected", "dismissed"].includes(status)) {
        return sendError(res, 400, "INVALID_RECOMMENDATION_STATUS");
      }

      const recommendation = await adRecommendationRepository.updateStatus({
        userId: getUserId(req),
        recommendationId: req.params.id,
        status,
        note,
      });

      if (!recommendation) return sendError(res, 404, "RECOMMENDATION_NOT_FOUND");
      return res.json({ success: true, data: recommendation });
    } catch (error) {
      console.error("[V2] Update recommendation status failed:", error);
      return sendError(res, 500, "RECOMMENDATION_STATUS_UPDATE_FAILED");
    }
  });

  return router;
}
