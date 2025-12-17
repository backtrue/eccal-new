import OpenAI from 'openai';
import { fbAuditTerms } from './businessTermsDictionary';
import type { 
  SelectMetaAdAccountType, 
  SelectMetaAdInsightType,
  InsertMetaAdAccountType,
  InsertMetaAdInsightType 
} from '@shared/schema';

export interface MetaAccountData {
  accountId: string;
  accountName: string;
  impressions: number;
  clicks: number;
  spend: number;
  linkClicks: number;
  purchases: number;
  purchaseValue: number;
  addToCart: number;
  viewContent: number;
  currency: string;
  dateRange: {
    since: string;
    until: string;
  };
  // 真實廣告數據（從 Facebook API 獲取）
  topPerformingAds?: Array<{
    adName: string;
    effectiveObjectStoryId: string;
    ctr: number;
    impressions: number;
    clicks: number;
    spend: number;
  }>;
}

// Meta 廣告儀表板專用數據結構
export interface MetaDashboardInsight {
  // 廣告層級資訊
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  adName?: string;
  
  // 時間和維度
  dateStart: Date;
  dateEnd: Date;
  level: 'account' | 'campaign' | 'adset' | 'ad';
  
  // 核心指標
  impressions: number;
  reach: number;
  spend: number;
  linkClicks: number;
  ctr: number;
  cpc: number;
  
  // 業務類型指標
  viewContent: number;
  addToCart: number;
  purchase: number;
  purchaseValue: number;
  messaging: number;
  leads: number;
  
  // 計算指標
  atcRate: number; // AddToCart/ViewContent %
  pfRate: number;  // Purchase/AddToCart %
  roas: number;    // Return on Ad Spend
  costPerPurchase: number;
  costPerMessaging: number;
  costPerLead: number;
  
  currency: string;
  rawData?: any;
}

// Meta 廣告帳戶數據同步結果
export interface MetaSyncResult {
  success: boolean;
  recordsProcessed: number;
  recordsInserted: number;
  recordsUpdated: number;
  errors: string[];
  apiCalls: number;
  processingTime: number;
}

export interface AccountDiagnosisData {
  // Target data from calculator
  targetDailyTraffic: number;
  targetDailyBudget: number;
  targetCpa: number;
  targetRoas: number;
  targetRevenue: number;
  targetAov: number;
  targetConversionRate: number;
  
  // Actual Facebook account data
  actualDailyTraffic: number;
  actualDailySpend: number;
  actualCtr: number;
  actualCpa: number;
  actualRoas: number;
  
  // Calculated metrics
  trafficAchievementRate: number;
  budgetUtilizationRate: number;
  addToCartRate: number; // ATC/VC
  checkoutRate: number; // PUR/ATC
  overallConversionRate: number; // PUR/VC
}

export class MetaAccountService {
  private openai: OpenAI;
  private readonly baseUrl = 'https://graph.facebook.com/v24.0';

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * 獲取多層級 Meta 廣告數據 (支援 campaign, adset, ad 層級)
   */
  async getMetaInsightsData(
    accessToken: string, 
    adAccountId: string, 
    options: {
      level: 'account' | 'campaign' | 'adset' | 'ad';
      dateRange: { since: string; until: string };
      businessType: 'ecommerce' | 'consultation' | 'lead_generation';
      limit?: number;
    }
  ): Promise<MetaDashboardInsight[]> {
    try {
      console.log(`[META-DASHBOARD] 獲取 ${options.level} 層級數據: ${adAccountId}`);
      
      const formattedAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      
      // 根據業務類型選擇需要的指標
      const baseFields = 'impressions,reach,spend,inline_link_clicks,cpc,ctr,actions,action_values';
      const businessFields = this.getBusinessTypeFields(options.businessType);
      
      // 🔥 關鍵修復：根據層級添加名稱欄位
      let nameFields = '';
      switch (options.level) {
        case 'campaign':
          nameFields = 'campaign_id,campaign_name';
          break;
        case 'adset':
          nameFields = 'campaign_id,campaign_name,adset_id,adset_name';
          break;
        case 'ad':
          nameFields = 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name';
          break;
        default: // account
          nameFields = '';
          break;
      }
      
      const fields = [baseFields, businessFields, nameFields].filter(Boolean).join(',');
      
      let url: string;
      let level: string;
      
      if (options.level === 'account') {
        url = `${this.baseUrl}/${formattedAccountId}/insights`;
        level = 'account';
      } else {
        url = `${this.baseUrl}/${formattedAccountId}/insights`;
        level = options.level;
      }
      
      const params = new URLSearchParams({
        access_token: accessToken,
        time_range: JSON.stringify({ since: options.dateRange.since, until: options.dateRange.until }),
        fields,
        level,
        limit: (options.limit || 100).toString()
      });
      
      const response = await fetch(`${url}?${params}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(`Facebook API 請求失敗: ${response.status} - ${errorData?.error?.message}`);
      }
      
      const data = await response.json();
      const insights = data.data || [];
      
      return insights.map((insight: any) => this.transformToMetaDashboardInsight(
        insight, 
        options.level, 
        options.dateRange,
        options.businessType
      ));
      
    } catch (error) {
      console.error('獲取 Meta Insights 數據錯誤:', error);
      throw error;
    }
  }
  
  /**
   * 根據業務類型獲取所需字段
   */
  private getBusinessTypeFields(businessType: string): string {
    switch (businessType) {
      case 'ecommerce':
        // 電商相關指標
        return 'purchase_roas,cost_per_action_type,cost_per_purchase';
      case 'consultation':
        // 諮詢相關指標 - 需要從 actions 中提取 messaging_conversation_started_7d
        return '';
      case 'lead_generation':
        // 潛客相關指標 - 需要從 actions 中提取 lead
        return '';
      default:
        return '';
    }
  }
  
  /**
   * 轉換 Facebook API 數據為儀表板數據格式
   */
  private transformToMetaDashboardInsight(
    insight: any, 
    level: string, 
    dateRange: { since: string; until: string },
    businessType: string
  ): MetaDashboardInsight {
    const actions = insight.actions || [];
    const actionValues = insight.action_values || [];
    
    // 提取轉換數據
    const viewContent = this.extractActionValue(actions, 'view_content');
    const addToCart = this.extractActionValue(actions, 'add_to_cart');
    const purchase = this.extractActionValue(actions, 'purchase');
    const messaging = this.extractActionValue(actions, 'messaging_conversation_started_7d');
    const leads = this.extractActionValue(actions, 'lead');
    
    const purchaseValue = this.extractActionValue(actionValues, 'purchase');
    const spend = parseFloat(insight.spend || '0');
    
    // 計算指標
    const atcRate = viewContent > 0 ? (addToCart / viewContent) * 100 : 0;
    const pfRate = addToCart > 0 ? (purchase / addToCart) * 100 : 0;
    const roas = spend > 0 ? purchaseValue / spend : 0;
    const costPerPurchase = purchase > 0 ? spend / purchase : 0;
    const costPerMessaging = messaging > 0 ? spend / messaging : 0;
    const costPerLead = leads > 0 ? spend / leads : 0;
    
    return {
      campaignId: insight.campaign_id,
      campaignName: insight.campaign_name,
      adsetId: insight.adset_id,
      adsetName: insight.adset_name,
      adId: insight.ad_id,
      adName: insight.ad_name,
      
      dateStart: new Date(dateRange.since),
      dateEnd: new Date(dateRange.until),
      level: level as any,
      
      impressions: parseInt(insight.impressions || '0'),
      reach: parseInt(insight.reach || '0'),
      spend,
      linkClicks: parseInt(insight.inline_link_clicks || '0'),
      ctr: parseFloat(insight.ctr || '0'),
      cpc: parseFloat(insight.cpc || '0'),
      
      viewContent,
      addToCart,
      purchase,
      purchaseValue,
      messaging,
      leads,
      
      atcRate: parseFloat(atcRate.toFixed(4)),
      pfRate: parseFloat(pfRate.toFixed(4)),
      roas: parseFloat(roas.toFixed(4)),
      costPerPurchase: parseFloat(costPerPurchase.toFixed(2)),
      costPerMessaging: parseFloat(costPerMessaging.toFixed(2)),
      costPerLead: parseFloat(costPerLead.toFixed(2)),
      
      currency: insight.currency || 'TWD',
      rawData: insight
    };
  }

  /**
   * 同步 Meta 廣告帳戶基本資料
   */
  async syncMetaAdAccount(
    userId: string,
    accessToken: string, 
    adAccountId: string,
    businessType: 'ecommerce' | 'consultation' | 'lead_generation'
  ): Promise<SelectMetaAdAccountType> {
    try {
      const formattedAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      
      // 獲取廣告帳戶基本資訊
      const accountUrl = `${this.baseUrl}/${formattedAccountId}`;
      const accountParams = new URLSearchParams({
        access_token: accessToken,
        fields: 'name,account_status,currency,timezone_name'
      });
      
      const response = await fetch(`${accountUrl}?${accountParams}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(`Facebook API 請求失敗: ${response.status} - ${errorData?.error?.message}`);
      }
      
      const accountData = await response.json();
      
      return {
        id: '', // 會由資料庫自動生成
        userId,
        metaAccountId: formattedAccountId,
        accountName: accountData.name || '廣告帳戶',
        currency: accountData.currency || 'TWD',
        timezone: accountData.timezone_name || 'Asia/Taipei',
        accountStatus: accountData.account_status || 'ACTIVE',
        businessType,
        // accessToken 和 tokenExpires 應該單獨處理，不存儲在此結構中
        isActive: true,
        lastSyncAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
    } catch (error) {
      console.error('同步 Meta 廣告帳戶錯誤:', error);
      throw error;
    }
  }

  /**
   * 獲取 Facebook 廣告帳戶數據 (帳戶級別分析) - 保持向後相容
   */
  async getAdAccountData(accessToken: string, adAccountId: string): Promise<MetaAccountData> {
    try {
      if (!accessToken) {
        throw new Error('Facebook Access Token 未提供');
      }

      console.log(`[META] 開始獲取廣告帳戶數據: ${adAccountId}`);

      // 格式化廣告帳戶 ID (確保包含 act_ 前綴)
      const formattedAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

      // 設定時間範圍 (最近 30 天)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 30);
      
      const since = startDate.toISOString().split('T')[0];
      const until = endDate.toISOString().split('T')[0];

      // 檢查是否為測試 token (如 'mock_token')，只有在測試 token 時才使用模擬數據
      if (accessToken === 'mock_token' || accessToken.startsWith('mock_')) {
        console.log(`[META] 使用模擬數據（測試 token）- ${formattedAccountId}`);
        return {
          accountId: formattedAccountId,
          accountName: "示範廣告帳戶",
          impressions: 125000,
          clicks: 3200,
          spend: 15000,
          linkClicks: 2800,
          purchases: 45,
          purchaseValue: 67500,
          addToCart: 180,
          viewContent: 1200,
          currency: "TWD",
          dateRange: { since, until },

        };
      }

      console.log(`[META] 使用真實 Facebook API 獲取數據 - ${formattedAccountId}`);

      // 獲取廣告帳戶基本資訊
      const accountUrl = `${this.baseUrl}/${formattedAccountId}`;
      const accountParams = new URLSearchParams({
        access_token: accessToken,
        fields: 'name,account_status,currency'
      });

      const accountResponse = await fetch(`${accountUrl}?${accountParams}`);
      
      if (!accountResponse.ok) {
        const errorData = await accountResponse.json().catch(() => null);
        throw new Error(`Facebook API 請求失敗: ${accountResponse.status} - ${errorData?.error?.message || accountResponse.statusText}`);
      }
      
      const accountData = await accountResponse.json();

      // 獲取廣告帳戶的統計數據 (所有活動的綜合數據)
      const insightsUrl = `${this.baseUrl}/${formattedAccountId}/insights`;
      const insightsParams = new URLSearchParams({
        access_token: accessToken,
        time_range: JSON.stringify({ since, until }),
        fields: 'impressions,clicks,spend,actions,action_values,cpm,cpc,ctr,outbound_clicks_ctr,purchase_roas,website_ctr,inline_link_clicks,outbound_clicks',
        level: 'account'
      });

      const insightsResponse = await fetch(`${insightsUrl}?${insightsParams}`);
      
      if (!insightsResponse.ok) {
        const errorData = await insightsResponse.json().catch(() => null);
        throw new Error(`Facebook Insights API 請求失敗: ${insightsResponse.status} - ${errorData?.error?.message || insightsResponse.statusText}`);
      }
      
      const insightsData = await insightsResponse.json();
      const insights = insightsData.data?.[0];

      if (!insights) {
        throw new Error('無法獲取廣告帳戶統計數據，可能該帳戶沒有活躍廣告或權限不足');
      }

      // 解析數據並計算指標
      const impressions = parseInt(insights.impressions || '0');
      const clicks = parseInt(insights.clicks || '0');
      const spend = parseFloat(insights.spend || '0');
      
      // 從 actions 陣列中提取轉換數據
      const actions = insights.actions || [];
      const actionValues = insights.action_values || [];
      
      const linkClicks = this.extractActionValue(actions, 'link_click');
      const purchases = this.extractActionValue(actions, 'purchase');
      const addToCart = this.extractActionValue(actions, 'add_to_cart');
      const viewContent = this.extractActionValue(actions, 'view_content');
      
      const purchaseValue = this.extractActionValue(actionValues, 'purchase');

      // 獲取廣告級別數據來計算 top performing ads
      let topPerformingAds: Array<{
        adName: string;
        effectiveObjectStoryId: string;
        ctr: number;
        impressions: number;
        clicks: number;
        spend: number;
      }> = [];
      try {
        topPerformingAds = await this.getTopPerformingAds(accessToken, formattedAccountId, since, until);
      } catch (error) {
        console.log('[META] 獲取廣告級別數據失敗，繼續使用帳戶級別數據');
      }
      
      return {
        accountId: formattedAccountId,
        accountName: accountData.name || '廣告帳戶',
        impressions,
        clicks,
        spend,
        linkClicks,
        purchases,
        purchaseValue,
        addToCart,
        viewContent,
        currency: accountData.currency || 'TWD',
        dateRange: { since, until },
        topPerformingAds
      };

    } catch (error) {
      console.error('獲取 Meta 廣告帳戶數據錯誤:', error);
      throw error;
    }
  }

  /**
   * 批量同步廣告數據到資料庫
   */
  async batchSyncInsightsData(
    accountId: string,
    insights: MetaDashboardInsight[],
    storage: any // IStorage 介面
  ): Promise<MetaSyncResult> {
    const startTime = Date.now();
    let recordsProcessed = 0;
    let recordsInserted = 0;
    let recordsUpdated = 0;
    const errors: string[] = [];
    
    try {
      for (const insight of insights) {
        try {
          const insightData: InsertMetaAdInsightType = {
            accountId,
            campaignId: insight.campaignId,
            campaignName: insight.campaignName,
            adsetId: insight.adsetId,
            adsetName: insight.adsetName,
            adId: insight.adId,
            adName: insight.adName,
            
            dateStart: insight.dateStart,
            dateEnd: insight.dateEnd,
            level: insight.level,
            
            impressions: insight.impressions,
            reach: insight.reach,
            spend: insight.spend.toString(),
            linkClicks: insight.linkClicks,
            ctr: insight.ctr.toString(),
            cpc: insight.cpc.toString(),
            
            viewContent: insight.viewContent,
            addToCart: insight.addToCart,
            purchase: insight.purchase,
            purchaseValue: insight.purchaseValue.toString(),
            costPerPurchase: insight.costPerPurchase.toString(),
            roas: insight.roas.toString(),
            
            messaging: insight.messaging,
            costPerMessaging: insight.costPerMessaging.toString(),
            
            leads: insight.leads,
            costPerLead: insight.costPerLead.toString(),
            
            atcRate: insight.atcRate.toString(),
            pfRate: insight.pfRate.toString(),
            
            currency: insight.currency,
            rawData: insight.rawData
          };
          
          // 使用 upsert 邏輯避免重複數據
          const result = await storage.upsertMetaAdInsight(insightData);
          
          if (result.isNew) {
            recordsInserted++;
          } else {
            recordsUpdated++;
          }
          recordsProcessed++;
          
        } catch (error) {
          const errorMsg = `同步單筆數據失敗: ${error instanceof Error ? error.message : '未知錯誤'}`;
          errors.push(errorMsg);
          console.error(errorMsg, { insight });
        }
      }
      
      const processingTime = Date.now() - startTime;
      
      console.log(`[META-SYNC] 完成批量同步: 處理 ${recordsProcessed} 筆, 新增 ${recordsInserted} 筆, 更新 ${recordsUpdated} 筆`);
      
      return {
        success: errors.length === 0,
        recordsProcessed,
        recordsInserted,
        recordsUpdated,
        errors,
        apiCalls: 1, // 實際API調用次數應該從呼叫端計算
        processingTime
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMsg = `批量同步失敗: ${error instanceof Error ? error.message : '未知錯誤'}`;
      console.error(errorMsg);
      
      return {
        success: false,
        recordsProcessed,
        recordsInserted,
        recordsUpdated,
        errors: [errorMsg, ...errors],
        apiCalls: 1,
        processingTime
      };
    }
  }

  /**
   * 獲取表現最佳的廣告 (CTR 高於平均值且曝光 > 500)
   */
  private async getTopPerformingAds(accessToken: string, adAccountId: string, since: string, until: string): Promise<Array<{
    adName: string;
    effectiveObjectStoryId: string;
    ctr: number;
    impressions: number;
    clicks: number;
    spend: number;
  }>> {
    try {
      console.log(`[META] 開始獲取廣告級別數據用於篩選高效廣告`);
      
      // 獲取廣告帳戶下的所有廣告
      const adsUrl = `${this.baseUrl}/${adAccountId}/ads`;
      const adsParams = new URLSearchParams({
        access_token: accessToken,
        fields: 'id,name,effective_object_story_id,status',
        limit: '100', // 限制數量避免過多數據
        filtering: JSON.stringify([{
          field: 'ad.effective_status',
          operator: 'IN',
          value: ['ACTIVE', 'PAUSED']
        }])
      });

      const adsResponse = await fetch(`${adsUrl}?${adsParams}`);
      if (!adsResponse.ok) {
        throw new Error(`Facebook Ads API 錯誤: ${adsResponse.status}`);
      }

      const adsData = await adsResponse.json();
      const ads = adsData.data || [];

      if (ads.length === 0) {
        console.log(`[META] 該帳戶沒有找到廣告數據`);
        return [];
      }

      // 獲取每個廣告的統計數據
      const adPerformanceData = [];
      
      for (const ad of ads) {
        try {
          const insightsUrl = `${this.baseUrl}/${ad.id}/insights`;
          const insightsParams = new URLSearchParams({
            access_token: accessToken,
            fields: 'impressions,clicks,spend',
            time_range: JSON.stringify({
              since: since,
              until: until
            })
          });

          const insightsResponse = await fetch(`${insightsUrl}?${insightsParams}`);
          if (!insightsResponse.ok) {
            console.log(`[META] 無法獲取廣告 ${ad.id} 的統計數據`);
            continue;
          }

          const insightsData = await insightsResponse.json();
          const insights = insightsData.data?.[0];

          if (!insights) {
            continue;
          }

          const impressions = parseInt(insights.impressions || '0');
          const clicks = parseInt(insights.clicks || '0');
          const spend = parseFloat(insights.spend || '0');
          const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

          // 只考慮有曝光數據的廣告
          if (impressions > 0) {
            adPerformanceData.push({
              adName: ad.name || '未命名廣告',
              effectiveObjectStoryId: ad.effective_object_story_id || '',
              ctr,
              impressions,
              clicks,
              spend
            });
          }
        } catch (error) {
          console.log(`[META] 處理廣告 ${ad.id} 時發生錯誤:`, error);
          continue;
        }
      }

      if (adPerformanceData.length === 0) {
        console.log(`[META] 沒有找到有效的廣告統計數據`);
        return [];
      }

      // 計算帳戶平均 CTR
      const totalImpressions = adPerformanceData.reduce((sum, ad) => sum + ad.impressions, 0);
      const totalClicks = adPerformanceData.reduce((sum, ad) => sum + ad.clicks, 0);
      const averageCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

      console.log(`[META] 帳戶平均 CTR: ${averageCtr.toFixed(2)}%`);

      // 篩選條件：CTR > 平均值 且 曝光 > 500
      const filteredAds = adPerformanceData.filter(ad => 
        ad.ctr > averageCtr && ad.impressions > 500
      );

      // 按 CTR 排序並取前 5 名
      const topAds = filteredAds
        .sort((a, b) => b.ctr - a.ctr)
        .slice(0, 5);

      console.log(`[META] 找到 ${topAds.length} 個高效廣告 (CTR > ${averageCtr.toFixed(2)}%, 曝光 > 500)`);

      return topAds;

    } catch (error) {
      console.error('獲取廣告級別數據錯誤:', error);
      return [];
    }
  }

  /**
   * 從 Facebook actions 數組中提取特定動作的值
   */
  private extractActionValue(actions: any[], actionType: string): number {
    const action = actions.find(a => a.action_type === actionType);
    return action ? parseInt(action.value) : 0;
  }

  /**
   * 計算帳戶診斷數據
   */
  calculateAccountDiagnosisData(
    targetData: {
      targetRevenue: number;
      targetAov: number;
      targetConversionRate: number;
      cpc: number;
    },
    metaData: MetaAccountData
  ): AccountDiagnosisData {
    // 目標計算
    const targetDailyRevenue = targetData.targetRevenue / 30;
    const targetDailyOrders = targetDailyRevenue / targetData.targetAov;
    const targetDailyTraffic = targetDailyOrders / (targetData.targetConversionRate / 100);
    const targetDailyBudget = targetDailyTraffic * targetData.cpc;
    const targetCpa = targetData.targetAov / (targetData.targetConversionRate / 100);
    // 修正 ROAS 計算：月目標營業額 / 月廣告預算
    const monthlyTargetBudget = targetDailyBudget * 30;
    const targetRoas = targetData.targetRevenue / monthlyTargetBudget;

    // 實際數據 (30天平均)
    const actualDailyTraffic = metaData.linkClicks / 30;
    const actualDailySpend = metaData.spend / 30;
    const actualCtr = metaData.clicks > 0 ? (metaData.clicks / metaData.impressions) * 100 : 0;
    const actualCpa = metaData.purchases > 0 ? metaData.spend / metaData.purchases : 0;
    const actualRoas = metaData.spend > 0 ? metaData.purchaseValue / metaData.spend : 0;

    // 達成率計算
    const trafficAchievementRate = targetDailyTraffic > 0 ? (actualDailyTraffic / targetDailyTraffic) * 100 : 0;
    const budgetUtilizationRate = targetDailyBudget > 0 ? (actualDailySpend / targetDailyBudget) * 100 : 0;

    // 漏斗轉換率
    const addToCartRate = metaData.viewContent > 0 ? (metaData.addToCart / metaData.viewContent) * 100 : 0;
    const checkoutRate = metaData.addToCart > 0 ? (metaData.purchases / metaData.addToCart) * 100 : 0;
    const overallConversionRate = metaData.viewContent > 0 ? (metaData.purchases / metaData.viewContent) * 100 : 0;

    return {
      targetDailyTraffic,
      targetDailyBudget,
      targetCpa,
      targetRoas,
      targetRevenue: targetData.targetRevenue,
      targetAov: targetData.targetAov,
      targetConversionRate: targetData.targetConversionRate,
      
      actualDailyTraffic,
      actualDailySpend,
      actualCtr,
      actualCpa,
      actualRoas,
      
      trafficAchievementRate,
      budgetUtilizationRate,
      addToCartRate,
      checkoutRate,
      overallConversionRate
    };
  }

  /**
   * 生成 AI 帳戶診斷報告（支援多語言）
   */
  async generateAccountDiagnosisReport(
    accountName: string,
    diagnosisData: AccountDiagnosisData,
    metaData?: MetaAccountData,
    locale: string = 'zh-TW'
  ): Promise<string> {
    const prompt = this.buildAccountDiagnosisPrompt(accountName, diagnosisData, metaData, locale);
    const systemMessage = this.getSystemMessage(locale);
    
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system", 
            content: systemMessage
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 2000,
        temperature: 0.7
      });

      return completion.choices[0]?.message?.content || this.getErrorMessage(locale);
    } catch (error) {
      console.error('OpenAI API 錯誤:', error);
      return this.getServiceUnavailableMessage(locale);
    }
  }

  /**
   * 獲取系統提示訊息（多語言支援）
   */
  private getSystemMessage(locale: string): string {
    switch (locale) {
      case 'ja':
        return `あなたは Facebook 広告最適化の専門コンサルタントです。Eコマース広告アカウントの診断と最適化提案を専門としています。正確で実用的な分析とアドバイスを提供してください。

専門用語は以下の通り使用してください：
- ROAS: ${fbAuditTerms.roas}
- CTR: ${fbAuditTerms.ctr}
- CPC: ${fbAuditTerms.cpc}
- CPM: ${fbAuditTerms.cpm}
- コンバージョン: ${fbAuditTerms.conversion}
- インプレッション: ${fbAuditTerms.impressions}
- ターゲティング: ${fbAuditTerms.targeting}
- クリエイティブ: ${fbAuditTerms.creative}

回答は「小黒先生」として、プロフェッショナルかつ親しみやすい口調で提供してください。`;
      
      case 'en':
        return "You are a professional Facebook advertising optimization consultant specializing in e-commerce ad account diagnosis and optimization recommendations. Please provide accurate and practical analysis and advice. Respond as 'Teacher Black' with a professional yet approachable tone.";
      
      default: // zh-TW
        return "你是專業的 Facebook 廣告優化顧問，專精於電商廣告帳戶診斷和優化建議。請提供精準、實用的分析和建議。請以「小黑老師」的身份，用專業而親切的語調回答。";
    }
  }

  /**
   * 獲取錯誤訊息（多語言支援）
   */
  private getErrorMessage(locale: string): string {
    switch (locale) {
      case 'ja':
        return "診断レポートの生成に失敗しました";
      case 'en':
        return "Failed to generate diagnosis report";
      default:
        return "診斷報告生成失敗";
    }
  }

  /**
   * 獲取服務不可用訊息（多語言支援）
   */
  private getServiceUnavailableMessage(locale: string): string {
    switch (locale) {
      case 'ja':
        return "AI診断サービスは一時的に利用できません。しばらくしてからもう一度お試しください。";
      case 'en':
        return "AI diagnosis service is temporarily unavailable. Please try again later.";
      default:
        return "AI 診斷服務暫時無法使用，請稍後再試。";
    }
  }

  /**
   * 建構帳戶診斷 Prompt（支援多語言）
   */
  private buildAccountDiagnosisPrompt(accountName: string, data: AccountDiagnosisData, metaData?: MetaAccountData, locale: string = 'zh-TW'): string {
    const healthScore = this.calculateAccountHealthScore(data);
    
    // 計算目標轉換率
    const targetBrowseToCartRate = 15; // 業界標準
    const targetCartToCheckoutRate = 25; // 業界標準
    
    switch (locale) {
      case 'ja':
        return this.buildJapanesePrompt(accountName, data, healthScore, targetBrowseToCartRate, targetCartToCheckoutRate, metaData);
      case 'en':
        return this.buildEnglishPrompt(accountName, data, healthScore, targetBrowseToCartRate, targetCartToCheckoutRate, metaData);
      default:
        return this.buildChinesePrompt(accountName, data, healthScore, targetBrowseToCartRate, targetCartToCheckoutRate, metaData);
    }
  }

  /**
   * 建構日文診斷提示
   */
  private buildJapanesePrompt(accountName: string, data: AccountDiagnosisData, healthScore: number, targetBrowseToCartRate: number, targetCartToCheckoutRate: number, metaData?: MetaAccountData): string {
    return `
専門的な Facebook 広告最適化コンサルタントとして、「${accountName}」の包括的なアカウント${fbAuditTerms.healthCheck}分析を行ってください：

## 📊 アカウント基本データ
- 目標月間${fbAuditTerms.revenue}：¥${data.targetRevenue.toLocaleString()}
- 目標AOV（平均注文単価）：¥${data.targetAov.toLocaleString()}
- 目標${fbAuditTerms.conversionRate}：${data.targetConversionRate}%
- 目標${fbAuditTerms.roas}：${data.targetRoas.toFixed(2)}x
- 目標日次トラフィック：${Math.round(data.targetDailyTraffic)} 人
- 目標日次${fbAuditTerms.budget}：¥${Math.round(data.targetDailyBudget).toLocaleString()}

## 📈 実際のアカウント${fbAuditTerms.performance}
- 実際の日次トラフィック：${Math.round(data.actualDailyTraffic)} 人 (達成率：${data.trafficAchievementRate.toFixed(1)}%)
- 実際の日次支出：¥${Math.round(data.actualDailySpend).toLocaleString()} (予算使用率：${data.budgetUtilizationRate.toFixed(1)}%)
- 実際の${fbAuditTerms.ctr}：${data.actualCtr.toFixed(2)}% (${this.getCtrRating(data.actualCtr)})
- 実際のCPA（獲得単価）：¥${Math.round(data.actualCpa).toLocaleString()}
- 実際の${fbAuditTerms.roas}：${data.actualRoas.toFixed(2)}x

## 🔄 ${fbAuditTerms.conversion}ファネル分析
- 閲覧→カート追加率：${data.addToCartRate.toFixed(1)}% (目標：${targetBrowseToCartRate}%)
- カート追加→購入率：${data.checkoutRate.toFixed(1)}% (目標：${targetCartToCheckoutRate}%)
- 総合${fbAuditTerms.conversionRate}：${data.overallConversionRate.toFixed(2)}%

## 🎯 健康スコア
アカウント健康スコア：${healthScore}/100 点

${metaData && metaData.topPerformingAds && metaData.topPerformingAds.length > 0 ? `
## ⭐ 高効果広告分析
アカウントデータ分析に基づき、以下の ${metaData.topPerformingAds.length} 個の高効果${fbAuditTerms.advertisement}（${fbAuditTerms.ctr}がアカウント平均以上かつ${fbAuditTerms.impressions} > 500）を発見：

${metaData.topPerformingAds.map((ad, index) => `
### 第 ${index + 1} 位 高効果${fbAuditTerms.advertisement}
- ${fbAuditTerms.advertisement}名：${ad.adName}
- 投稿ID：${ad.effectiveObjectStoryId}
- ${fbAuditTerms.ctr}：${ad.ctr.toFixed(2)}%
- ${fbAuditTerms.impressions}：${ad.impressions.toLocaleString()}
- ${fbAuditTerms.clicks}：${ad.clicks.toLocaleString()}
- 支出金額：¥${ad.spend.toLocaleString()}
`).join('')}

**${fbAuditTerms.optimization}提案：** これらの${fbAuditTerms.advertisement}は優秀な${fbAuditTerms.performance}を示しているため、以下を推奨します：
1. これらの高効果${fbAuditTerms.advertisement}の${fbAuditTerms.budget}を20-50%増加
2. これらの${fbAuditTerms.advertisement}の${fbAuditTerms.creative}戦略を新しい広告グループに複製
3. これらの${fbAuditTerms.advertisement}の共通特徴を分析し、他の広告素材に適用
4. 投稿IDを使用して広告マネージャーで対応する素材を迅速に特定
` : ''}

以下の構造に従って完全な${fbAuditTerms.diagnosis}レポートを提供してください：

## 1. 🌟 成功ハイライト分析
既存データに基づくアカウントの強み：
- ${fbAuditTerms.ctr} ${fbAuditTerms.performance}分析と成功要因
- ${fbAuditTerms.roas}達成状況と${fbAuditTerms.optimization}戦略
- ${fbAuditTerms.conversionRate} ${fbAuditTerms.performance}評価
- ${fbAuditTerms.audience} ${fbAuditTerms.targeting}効果分析

## 2. 📊 ${fbAuditTerms.conversion}ファネル${fbAuditTerms.optimization}提案
詳細説明：
- 「閲覧→カート追加率」現在 ${data.addToCartRate.toFixed(1)}%、目標 ${targetBrowseToCartRate}% への改善方法
- 「カート追加→購入率」現在 ${data.checkoutRate.toFixed(1)}%、目標 ${targetCartToCheckoutRate}% への改善方法
- 具体的な${fbAuditTerms.optimization}戦略と実行可能な改善案の提供

## 3. ⚠️ 問題${fbAuditTerms.diagnosis}と解決方案
実際のデータに基づく問題の特定と解決策の提供

## 4. 💡 具体的なアクションプラン
- 短期改善策（1-2週間以内）
- 中期戦略（1-3ヶ月）
- 長期成長計画（3-6ヶ月）

## 5. 📋 実行チェックリスト
優先順位付きの具体的なタスクリスト

専門用語を正確に使用し、「小黒先生」として親しみやすく実用的なアドバイスを提供してください。
`;
  }

  /**
   * 建構英文診斷提示
   */
  private buildEnglishPrompt(accountName: string, data: AccountDiagnosisData, healthScore: number, targetBrowseToCartRate: number, targetCartToCheckoutRate: number, metaData?: MetaAccountData): string {
    return `
As a professional Facebook advertising optimization consultant, please conduct a comprehensive account health analysis for "${accountName}":

## 📊 Account Basic Data
- Target Monthly Revenue: $${data.targetRevenue.toLocaleString()}
- Target AOV: $${data.targetAov.toLocaleString()}
- Target Conversion Rate: ${data.targetConversionRate}%
- Target ROAS: ${data.targetRoas.toFixed(2)}x
- Target Daily Traffic: ${Math.round(data.targetDailyTraffic)} visits
- Target Daily Budget: $${Math.round(data.targetDailyBudget).toLocaleString()}

## 📈 Actual Account Performance
- Actual Daily Traffic: ${Math.round(data.actualDailyTraffic)} visits (Achievement: ${data.trafficAchievementRate.toFixed(1)}%)
- Actual Daily Spend: $${Math.round(data.actualDailySpend).toLocaleString()} (Budget Utilization: ${data.budgetUtilizationRate.toFixed(1)}%)
- Actual CTR: ${data.actualCtr.toFixed(2)}% (${this.getCtrRating(data.actualCtr)})
- Actual CPA: $${Math.round(data.actualCpa).toLocaleString()}
- Actual ROAS: ${data.actualRoas.toFixed(2)}x

## 🔄 Conversion Funnel Analysis
- Browse→Add to Cart Rate: ${data.addToCartRate.toFixed(1)}% (Target: ${targetBrowseToCartRate}%)
- Add to Cart→Purchase Rate: ${data.checkoutRate.toFixed(1)}% (Target: ${targetCartToCheckoutRate}%)
- Overall Conversion Rate: ${data.overallConversionRate.toFixed(2)}%

## 🎯 Health Score
Account Health Score: ${healthScore}/100 points

Please provide a complete diagnosis report following this structure as "Teacher Black" with professional and approachable advice.
`;
  }

  /**
   * 建構中文診斷提示
   */
  private buildChinesePrompt(accountName: string, data: AccountDiagnosisData, healthScore: number, targetBrowseToCartRate: number, targetCartToCheckoutRate: number, metaData?: MetaAccountData): string {
    return `
作為專業的 Facebook 廣告優化顧問，請針對「${accountName}」進行全面帳戶健診分析：

## 📊 帳戶基本數據
- 目標月營收：NT$${data.targetRevenue.toLocaleString()}
- 目標客單價：NT$${data.targetAov.toLocaleString()}
- 目標轉換率：${data.targetConversionRate}%
- 目標 ROAS：${data.targetRoas.toFixed(2)}x
- 目標日流量：${Math.round(data.targetDailyTraffic)} 人次
- 目標日預算：NT$${Math.round(data.targetDailyBudget).toLocaleString()}

## 📈 實際帳戶表現
- 實際日流量：${Math.round(data.actualDailyTraffic)} 人次 (達成率：${data.trafficAchievementRate.toFixed(1)}%)
- 實際日花費：NT$${Math.round(data.actualDailySpend).toLocaleString()} (預算使用率：${data.budgetUtilizationRate.toFixed(1)}%)
- 實際 CTR：${data.actualCtr.toFixed(2)}% (${this.getCtrRating(data.actualCtr)})
- 實際 CPA：NT$${Math.round(data.actualCpa).toLocaleString()}
- 實際 ROAS：${data.actualRoas.toFixed(2)}x

## 🔄 轉換漏斗分析
- 瀏覽→加購轉換率：${data.addToCartRate.toFixed(1)}% (目標：${targetBrowseToCartRate}%)
- 加購→結帳轉換率：${data.checkoutRate.toFixed(1)}% (目標：${targetCartToCheckoutRate}%)
- 整體轉換率：${data.overallConversionRate.toFixed(2)}%

## 🎯 健康分數
帳戶健康分數：${healthScore}/100 分

${metaData && metaData.topPerformingAds && metaData.topPerformingAds.length > 0 ? `
## ⭐ 高效廣告分析
基於帳戶數據分析，發現以下 ${metaData.topPerformingAds.length} 個高效廣告（CTR 高於帳戶平均值且曝光次數 > 500）：

${metaData.topPerformingAds.map((ad, index) => `
### 第 ${index + 1} 名高效廣告
- 廣告名稱：${ad.adName}
- 貼文編號：${ad.effectiveObjectStoryId}
- 點擊率：${ad.ctr.toFixed(2)}%
- 曝光次數：${ad.impressions.toLocaleString()}
- 點擊次數：${ad.clicks.toLocaleString()}
- 花費金額：NT$${ad.spend.toLocaleString()}
`).join('')}

**優化建議：** 這些廣告表現優異，建議：
1. 將這些高效廣告的預算提高 20-50%
2. 複製這些廣告的創意策略到新的廣告組合
3. 分析這些廣告的共同特徵，應用到其他廣告素材
4. 使用貼文編號快速在廣告管理員中找到對應素材
` : ''}

請按以下架構提供完整診斷報告：

## 1. 🌟 成功亮點分析
基於現有數據分析帳戶優勢：
- CTR 表現分析和成功因素
- ROAS 達成情況和優化策略
- 轉換率表現評估
- 受眾定向效果分析

## 2. 📊 轉換漏斗優化建議
詳細說明：
- 「瀏覽→加購轉換率」現在是 ${data.addToCartRate.toFixed(1)}%，應該要提升到 ${targetBrowseToCartRate}%
- 「加購→結帳轉換率」現在是 ${data.checkoutRate.toFixed(1)}%，應該要提升到 ${targetCartToCheckoutRate}%
- 提供具體優化策略和可執行的改善方案

## 3. ⚠️ 問題診斷與解決方案
基於實際數據指出問題並提供解決方案

## 4. 💰 預算優化建議
針對目前預算配置給出調整建議

請用繁體中文回答，語氣專業但易懂。嚴格遵守：絕對不要編造任何廣告名稱、Post ID、廣告組合名稱等具體細節，只提供基於真實數據的策略性建議。
`;
  }

  /**
   * 計算帳戶健康分數
   */
  private calculateAccountHealthScore(data: AccountDiagnosisData): number {
    let score = 0;
    
    // 流量達成率 (25分)
    if (data.trafficAchievementRate >= 80) score += 25;
    else if (data.trafficAchievementRate >= 60) score += 20;
    else if (data.trafficAchievementRate >= 40) score += 15;
    else score += 5;
    
    // CTR 表現 (25分)
    if (data.actualCtr >= 3) score += 25;
    else if (data.actualCtr >= 2) score += 20;
    else if (data.actualCtr >= 1) score += 15;
    else score += 5;
    
    // ROAS 表現 (25分)
    if (data.actualRoas >= data.targetRoas) score += 25;
    else if (data.actualRoas >= data.targetRoas * 0.8) score += 20;
    else if (data.actualRoas >= data.targetRoas * 0.6) score += 15;
    else score += 5;
    
    // 轉換率表現 (25分)
    if (data.overallConversionRate >= data.targetConversionRate) score += 25;
    else if (data.overallConversionRate >= data.targetConversionRate * 0.8) score += 20;
    else if (data.overallConversionRate >= data.targetConversionRate * 0.6) score += 15;
    else score += 5;
    
    return Math.min(score, 100);
  }

  /**
   * 獲取 CTR 評級
   */
  private getCtrRating(ctr: number): string {
    if (ctr >= 3) return "優秀";
    if (ctr >= 2) return "良好";
    if (ctr >= 1) return "普通";
    return "需改善";
  }
}

export const metaAccountService = new MetaAccountService();