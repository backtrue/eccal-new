import { fbAuditService } from "../../fbAuditService";
import type { MetaActualMetrics } from "./types";

export class MetaActualMetricsLoader {
  async load(accessToken: string, adAccountId: string): Promise<MetaActualMetrics> {
    if (!accessToken) {
      throw new Error("META_ACCESS_TOKEN_MISSING");
    }

    const adData = await fbAuditService.getAdAccountData(accessToken, adAccountId);
    const dailySpend = adData.spend / 28;
    const dailyPurchases = adData.purchases / 28;
    const cpa = adData.purchases > 0 ? adData.spend / adData.purchases : null;

    return {
      adAccountId: adData.accountId,
      dateRange: adData.dateRange,
      spend: round(adData.spend, 2),
      dailySpend: round(dailySpend, 2),
      purchases: adData.purchases,
      dailyPurchases: round(dailyPurchases, 2),
      roas: round(adData.roas, 2),
      ctr: round(adData.ctr, 2),
      cpa: cpa === null ? null : round(cpa, 2),
      raw: adData,
    };
  }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export const metaActualMetricsLoader = new MetaActualMetricsLoader();
