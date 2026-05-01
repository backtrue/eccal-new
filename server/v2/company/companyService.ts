import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  companies,
  companyAdAccounts,
  companyFinancialProfiles,
  decisionRuleSets,
  productProfiles,
  type InsertCompany,
  type InsertCompanyAdAccount,
  type InsertCompanyFinancialProfile,
} from "@shared/schema";
import { decisionRuleService } from "../adDecision/decisionRuleService";
import type { CompanyContext } from "../adDecision/types";

export class CompanyService {
  async createCompany(userId: string, input: Omit<InsertCompany, "userId">) {
    const [created] = await db
      .insert(companies)
      .values({
        ...input,
        userId,
        isActive: input.isActive ?? true,
      })
      .returning();

    return created;
  }

  async getCompaniesByUser(userId: string) {
    return db
      .select()
      .from(companies)
      .where(and(eq(companies.userId, userId), eq(companies.isActive, true)))
      .orderBy(desc(companies.updatedAt));
  }

  async getCompanyById(userId: string, companyId: string) {
    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.userId, userId), eq(companies.isActive, true)))
      .limit(1);

    return company ?? null;
  }

  async updateCompany(userId: string, companyId: string, input: Partial<Omit<InsertCompany, "userId">>) {
    const company = await this.getCompanyById(userId, companyId);
    if (!company) return null;

    const [updated] = await db
      .update(companies)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(companies.id, companyId))
      .returning();

    return updated;
  }

  async deleteCompany(userId: string, companyId: string) {
    const company = await this.getCompanyById(userId, companyId);
    if (!company) return false;

    await db
      .update(companies)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(companies.id, companyId));

    return true;
  }

  async upsertFinancialProfile(
    userId: string,
    companyId: string,
    input: Omit<InsertCompanyFinancialProfile, "companyId">,
  ) {
    const company = await this.getCompanyById(userId, companyId);
    if (!company) return null;

    const [existing] = await db
      .select()
      .from(companyFinancialProfiles)
      .where(eq(companyFinancialProfiles.companyId, companyId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(companyFinancialProfiles)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(companyFinancialProfiles.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(companyFinancialProfiles)
      .values({ ...input, companyId })
      .returning();

    return created;
  }

  async getFinancialProfile(userId: string, companyId: string) {
    const company = await this.getCompanyById(userId, companyId);
    if (!company) return null;

    const [profile] = await db
      .select()
      .from(companyFinancialProfiles)
      .where(eq(companyFinancialProfiles.companyId, companyId))
      .limit(1);

    return profile ?? null;
  }

  async linkMetaAdAccount(userId: string, companyId: string, input: Omit<InsertCompanyAdAccount, "companyId">) {
    const company = await this.getCompanyById(userId, companyId);
    if (!company) return null;

    const adAccountId = input.adAccountId?.trim();
    if (!adAccountId) {
      throw new Error("adAccountId is required");
    }

    const [existing] = await db
      .select()
      .from(companyAdAccounts)
      .where(
        and(
          eq(companyAdAccounts.companyId, companyId),
          eq(companyAdAccounts.platform, input.platform || "meta"),
          eq(companyAdAccounts.adAccountId, adAccountId),
        ),
      )
      .limit(1);

    const values = {
      ...input,
      companyId,
      platform: input.platform || "meta",
      adAccountId,
      isActive: input.isActive ?? true,
      updatedAt: new Date(),
    };

    if (existing) {
      const [updated] = await db
        .update(companyAdAccounts)
        .set(values)
        .where(eq(companyAdAccounts.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(companyAdAccounts).values(values).returning();
    return created;
  }

  async getCompanyAdAccounts(userId: string, companyId: string) {
    const company = await this.getCompanyById(userId, companyId);
    if (!company) return null;

    return db
      .select()
      .from(companyAdAccounts)
      .where(and(eq(companyAdAccounts.companyId, companyId), eq(companyAdAccounts.isActive, true)))
      .orderBy(desc(companyAdAccounts.updatedAt));
  }

  async getCompanyContext(userId: string, companyId: string): Promise<CompanyContext | null> {
    const company = await this.getCompanyById(userId, companyId);
    if (!company) return null;

    const [financialProfile, adAccounts, products, activeDecisionRuleSet] = await Promise.all([
      this.getFinancialProfile(userId, companyId),
      this.getCompanyAdAccounts(userId, companyId),
      db
        .select()
        .from(productProfiles)
        .where(and(eq(productProfiles.companyId, companyId), eq(productProfiles.isActive, true))),
      decisionRuleService.getActiveRuleSet(companyId),
    ]);

    return {
      company,
      financialProfile,
      adAccounts: adAccounts || [],
      products,
      activeDecisionRuleSet,
    };
  }
}

export const companyService = new CompanyService();
