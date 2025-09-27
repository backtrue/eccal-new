import express from 'express';
import { requireJWTAuth } from './jwtAuth';
import { metaAccountService, type MetaDashboardInsight } from './metaAccountService';
import OpenAI from 'openai';
import { storage } from './storage';

const router = express.Router();

// Meta 儀表板統計端點
router.get('/dashboard', requireJWTAuth, async (req: any, res) => {
  try {
    const user = req.user;
    
    // 檢查用戶是否有 Facebook 連接
    if (!user.metaAccessToken || !user.metaAdAccountId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'Facebook connection required'
      });
    }

    // 獲取查詢參數
    const businessType = (req.query.businessType as 'ecommerce' | 'consultation' | 'lead_generation') || 'ecommerce';
    const level = (req.query.level as 'account' | 'campaign' | 'adset' | 'ad') || 'account';
    const since = req.query.since as string || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const until = req.query.until as string || new Date().toISOString().split('T')[0];

    console.log('Fetching dashboard insights:', { businessType, level, since, until });

    // 🚀 智能緩存系統 - 優先使用緩存數據，加速載入並節省 API 次數
    console.log('檢查緩存數據...');
    
    // 獲取基本帳戶數據（無論是否使用緩存都需要）
    let accountData: any;
    try {
      accountData = await metaAccountService.getAdAccountData(user.metaAccessToken, user.metaAdAccountId);
    } catch (error) {
      console.error('獲取帳戶數據失敗:', error);
      accountData = {
        accountName: `Account ${user.metaAdAccountId}`,
        currency: 'USD',
        topPerformingAds: []
      };
    }
    
    const dateStart = new Date(since);
    const dateEnd = new Date(until);
    
    // 1. 先檢查緩存是否有效
    let insights: MetaDashboardInsight[] = [];
    const cachedInsights = await storage.getCachedMetaInsights(
      user.id,
      user.metaAdAccountId,
      level,
      businessType,
      dateStart,
      dateEnd
    );
    
    if (cachedInsights && cachedInsights.length > 0) {
      // 使用緩存數據
      console.log(`✅ 使用緩存數據 - ${cachedInsights.length} 筆記錄，避免 API 調用`);
      insights = cachedInsights.map(cached => ({
        campaignId: cached.campaignId || '',
        campaignName: cached.campaignName || '',
        adsetId: cached.adsetId || '',
        adsetName: cached.adsetName || '',
        adId: cached.adId || '',
        adName: cached.adName || '',
        
        // 時間和層級信息
        dateStart: cached.dateStart,
        dateEnd: cached.dateEnd,
        level: cached.level as 'account' | 'campaign' | 'adset' | 'ad',
        
        impressions: cached.impressions,
        reach: cached.reach,
        spend: Number(cached.spend),
        linkClicks: cached.linkClicks,
        
        // 計算基本指標
        ctr: Number(cached.ctr) || (cached.impressions > 0 ? (cached.linkClicks / cached.impressions * 100) : 0),
        cpc: Number(cached.cpc) || (cached.linkClicks > 0 ? (Number(cached.spend) / cached.linkClicks) : 0),
        
        viewContent: cached.viewContent,
        addToCart: cached.addToCart,
        purchase: cached.purchase,
        purchaseValue: Number(cached.purchaseValue),
        messaging: cached.messaging,
        leads: cached.leads,
        
        atcRate: Number(cached.atcRate),
        pfRate: Number(cached.pfRate),
        roas: Number(cached.roas),
        costPerPurchase: Number(cached.costPerPurchase),
        costPerMessaging: Number(cached.costPerMessaging),
        costPerLead: Number(cached.costPerLead),
        
        currency: cached.currency,
        rawData: cached.rawData
      }));
    } else {
      // 緩存無效，調用 Facebook API
      console.log('❌ 緩存無效，調用 Facebook API...');
      
      // 🚀 獲取真實的轉換事件數據
      insights = await metaAccountService.getMetaInsightsData(
        user.metaAccessToken,
        user.metaAdAccountId,
        {
          level,
          dateRange: { since, until },
          businessType,
          limit: 50
        }
      );

      console.log(`📊 API 獲取到 ${insights.length} 筆真實廣告數據`);
      
      // 🔍 新增：詳細檢查數據品質
      if (insights.length > 0) {
        const sampleInsight = insights[0];
        console.log(`🔍 數據品質檢查 (${level} 層級):`, {
          有活動名稱: !!sampleInsight.campaignName,
          有廣告組合名稱: !!sampleInsight.adsetName,
          有廣告名稱: !!sampleInsight.adName,
          樣本名稱: {
            campaign: sampleInsight.campaignName || '未提供',
            adset: sampleInsight.adsetName || '未提供',
            ad: sampleInsight.adName || '未提供'
          }
        });
      }
      
      // 保存到緩存（4小時有效期）
      if (insights.length > 0) {
        const cacheData = insights.map(insight => ({
          accountId: user.metaAdAccountId,
          campaignId: insight.campaignId,
          campaignName: insight.campaignName,
          adsetId: insight.adsetId,
          adsetName: insight.adsetName,
          adId: insight.adId,
          adName: insight.adName,
          
          dateStart,
          dateEnd,
          level,
          
          impressions: insight.impressions,
          reach: insight.reach,
          spend: insight.spend.toString(),
          linkClicks: insight.linkClicks,
          
          viewContent: insight.viewContent,
          addToCart: insight.addToCart,
          purchase: insight.purchase,
          purchaseValue: insight.purchaseValue.toString(),
          messaging: insight.messaging,
          leads: insight.leads,
          
          atcRate: insight.atcRate.toString(),
          pfRate: insight.pfRate.toString(),
          roas: insight.roas.toString(),
          costPerPurchase: insight.costPerPurchase.toString(),
          costPerMessaging: insight.costPerMessaging.toString(),
          costPerLead: insight.costPerLead.toString(),
          
          currency: insight.currency,
          rawData: insight.rawData
        }));
        
        try {
          await storage.saveCachedMetaInsights(cacheData, 4); // 4小時緩存
          console.log('💾 數據已保存到緩存');
        } catch (error) {
          console.error('保存緩存失敗:', error);
          // 不影響主要流程，繼續執行
        }
      }
    }

    // 聚合真實的轉換數據
    const businessMetrics = insights.reduce((totals, insight) => {
      return {
        totalViewContent: totals.totalViewContent + insight.viewContent,
        totalAddToCart: totals.totalAddToCart + insight.addToCart,
        totalPurchase: totals.totalPurchase + insight.purchase,
        totalPurchaseValue: totals.totalPurchaseValue + insight.purchaseValue,
        totalMessaging: totals.totalMessaging + insight.messaging,
        totalLeads: totals.totalLeads + insight.leads,
      };
    }, {
      totalViewContent: 0,
      totalAddToCart: 0,
      totalPurchase: 0,
      totalPurchaseValue: 0,
      totalMessaging: 0,
      totalLeads: 0,
    });

    console.log('聚合後的真實轉換數據:', businessMetrics);
    
    // 🔥 聚合真實數據，而非基於帳戶層級估算
    const aggregated = {
      totalSpend: insights.reduce((sum, insight) => sum + insight.spend, 0),
      totalImpressions: insights.reduce((sum, insight) => sum + insight.impressions, 0),
      totalClicks: insights.reduce((sum, insight) => sum + insight.linkClicks, 0),
      ...businessMetrics
    };

    // 計算業務指標
    const metrics = {
      ctr: aggregated.totalImpressions > 0 ? (aggregated.totalClicks / aggregated.totalImpressions * 100) : 0,
      cpc: aggregated.totalClicks > 0 ? (aggregated.totalSpend / aggregated.totalClicks) : 0,
      atcRate: aggregated.totalViewContent > 0 ? (aggregated.totalAddToCart / aggregated.totalViewContent * 100) : 0,
      pfRate: aggregated.totalAddToCart > 0 ? (aggregated.totalPurchase / aggregated.totalAddToCart * 100) : 0,
      roas: aggregated.totalSpend > 0 ? (aggregated.totalPurchaseValue / aggregated.totalSpend) : 0,
      costPerPurchase: aggregated.totalPurchase > 0 ? (aggregated.totalSpend / aggregated.totalPurchase) : 0,
      costPerMessaging: aggregated.totalMessaging > 0 ? (aggregated.totalSpend / aggregated.totalMessaging) : 0,
      costPerLead: aggregated.totalLeads > 0 ? (aggregated.totalSpend / aggregated.totalLeads) : 0,
    };

    // 帳戶基本信息已在上面獲取

    // 🚀 依據維度整理詳細列表數據
    const detailData = insights.map(insight => {
      // 根據層級動態獲取 ID 和名稱
      let id: string, name: string;
      
      switch (level) {
        case 'campaign':
          id = insight.campaignId || `campaign_${Date.now()}_${Math.random()}`;
          name = insight.campaignName || `未命名行銷活動`;
          break;
        case 'adset':
          id = insight.adsetId || `adset_${Date.now()}_${Math.random()}`;
          name = insight.adsetName || `未命名廣告組合`;
          break;
        case 'ad':
          id = insight.adId || `ad_${Date.now()}_${Math.random()}`;
          name = insight.adName || `未命名廣告`;
          break;
        default: // account
          id = `account_${Date.now()}_${Math.random()}`;
          name = `廣告帳戶總覽`;
      }
      
      return {
        id,
        name,
      spend: insight.spend,
      impressions: insight.impressions,
      linkClicks: insight.linkClicks,
      ctr: insight.impressions > 0 ? (insight.linkClicks / insight.impressions * 100) : 0,
      cpc: insight.linkClicks > 0 ? (insight.spend / insight.linkClicks) : 0,
      
      // 業務特定指標
      ...(businessType === 'ecommerce' && {
        viewContent: insight.viewContent,
        addToCart: insight.addToCart,
        purchase: insight.purchase,
        purchaseValue: insight.purchaseValue,
        roas: insight.spend > 0 ? (insight.purchaseValue / insight.spend) : 0,
        atcRate: insight.viewContent > 0 ? (insight.addToCart / insight.viewContent * 100) : 0,
        pfRate: insight.addToCart > 0 ? (insight.purchase / insight.addToCart * 100) : 0
      }),
      
      ...(businessType === 'consultation' && {
        messaging: insight.messaging,
        costPerMessaging: insight.messaging > 0 ? (insight.spend / insight.messaging) : 0
      }),
      
      ...(businessType === 'lead_generation' && {
        leads: insight.leads,
        costPerLead: insight.leads > 0 ? (insight.spend / insight.leads) : 0
      })
    };
    }).sort((a, b) => b.spend - a.spend); // 按花費排序

    const dashboardData = {
      account: {
        id: user.metaAdAccountId,
        name: accountData.accountName || `Account ${user.metaAdAccountId}`,
        currency: accountData.currency || 'USD',
        timezone: 'UTC'
      },
      businessType,
      level,
      dateRange: { since, until },
      overview: aggregated,
      metrics,
      
      // 🎯 新增：詳細列表數據
      detailData,
      totalItems: detailData.length,
      
      topPerformingAds: accountData.topPerformingAds || [], // 返回頂級廣告數據
      lastUpdated: new Date().toISOString()
    };

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Meta dashboard error:', error);
    
    // 檢查是否為權限問題
    if (error instanceof Error && error.message.includes('access')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'Invalid or expired Facebook access token'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 業務類型指標端點
router.get('/business-metrics', requireJWTAuth, async (req: any, res) => {
  try {
    const user = req.user;
    const { businessType = 'ecommerce' } = req.query;
    
    // 檢查用戶是否有 Facebook 連接
    if (!user.metaAccessToken || !user.metaAdAccountId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'Facebook connection required'
      });
    }

    // 根據業務類型生成相應的指標數據
    const businessMetrics = generateBusinessMetrics(businessType as string);

    res.json({
      success: true,
      data: businessMetrics
    });

  } catch (error) {
    console.error('Business metrics error:', error);
    
    if (error instanceof Error && error.message.includes('access')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'Invalid or expired Facebook access token'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch business metrics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GPT-4.1-mini 智能分析端點
router.post('/ai-analysis', requireJWTAuth, async (req: any, res) => {
  try {
    const user = req.user;
    const { dashboardData, businessType, level, dateRange } = req.body;
    
    // 檢查用戶是否有 Facebook 連接
    if (!user.metaAccessToken || !user.metaAdAccountId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'Facebook connection required'
      });
    }

    if (!dashboardData) {
      return res.status(400).json({
        success: false,
        error: 'Dashboard data is required for analysis'
      });
    }

    console.log('Generating GPT analysis for:', { businessType, level, dateRange });

    // 構建 GPT 分析提示
    const prompt = `作為 Meta 廣告專家，請分析以下廣告帳戶數據並提供專業建議：

業務類型: ${businessType === 'ecommerce' ? '電商' : businessType === 'consultation' ? '線上諮詢' : '名單收集'}
分析維度: ${level === 'account' ? '廣告帳戶' : level === 'campaign' ? '行銷活動' : level === 'adset' ? '廣告組合' : '廣告'}
時間範圍: ${dateRange?.since || '過去30天'} 至 ${dateRange?.until || '今日'}

廣告數據:
- 總花費: $${dashboardData.overview?.totalSpend || 0}
- 曝光數: ${dashboardData.overview?.totalImpressions?.toLocaleString() || 0}
- 觸及數: ${dashboardData.overview?.totalReach?.toLocaleString() || 0}
- 連結點擊數: ${dashboardData.overview?.totalClicks?.toLocaleString() || 0}
- 連結 CTR: ${dashboardData.metrics?.ctr?.toFixed(2) || 0}%
- 連結點擊成本: $${dashboardData.metrics?.cpc?.toFixed(2) || 0}

${businessType === 'ecommerce' ? `
電商轉換數據:
- ViewContent: ${dashboardData.overview?.totalViewContent?.toLocaleString() || 0}
- AddToCart: ${dashboardData.overview?.totalAddToCart?.toLocaleString() || 0}
- Purchase: ${dashboardData.overview?.totalPurchase?.toLocaleString() || 0}
- ATC% (加購率): ${dashboardData.metrics?.atcRate?.toFixed(1) || 0}%
- PF% (完成率): ${dashboardData.metrics?.pfRate?.toFixed(1) || 0}%
- ROAS: ${dashboardData.metrics?.roas?.toFixed(2) || 0}
- 購買成本: $${dashboardData.metrics?.costPerPurchase?.toFixed(2) || 0}
- 購買價值: $${dashboardData.overview?.totalPurchaseValue?.toLocaleString() || 0}
` : businessType === 'consultation' ? `
諮詢互動數據:
- 訊息對話開始次數: ${dashboardData.overview?.totalMessaging?.toLocaleString() || 0}
- 每次對話成本: $${dashboardData.metrics?.costPerMessaging?.toFixed(2) || 0}
` : `
名單收集數據:
- 潛在顧客數: ${dashboardData.overview?.totalLeads?.toLocaleString() || 0}
- 潛客取得成本: $${dashboardData.metrics?.costPerLead?.toFixed(2) || 0}
`}

**📊 詳細數據表格:**
${dashboardData.detailData.map((item: any, index: number) => `
${index + 1}. ${item.name}
   - 花費: $${item.spend.toFixed(2)}
   - 曝光: ${item.impressions.toLocaleString()}
   - 點擊: ${item.linkClicks.toLocaleString()}
   - CTR: ${item.ctr.toFixed(2)}%
   - CPC: $${item.cpc.toFixed(2)}
   ${businessType === 'ecommerce' ? `- 商品瀏覽: ${item.viewContent}, 加購: ${item.addToCart}, 購買: ${item.purchase}, ROAS: ${item.roas.toFixed(2)}` : ''}
   ${businessType === 'consultation' ? `- 對話: ${item.messaging}, 對話成本: $${item.costPerMessaging.toFixed(2)}` : ''}
   ${businessType === 'lead_generation' ? `- 潛客: ${item.leads}, 潛客成本: $${item.costPerLead.toFixed(2)}` : ''}
`).join('')}

請以純JSON格式回應（不要使用markdown代碼塊），包含:
1. summary: 整體表現總結 (HTML格式，100字以內，繁體中文)
2. recommendations: 3-5個具體改善建議，每個包含 {type, title, description, priority, impact, targetItem}，其中 targetItem 為建議針對的具體項目名稱
3. insights: 2-3個關鍵洞察，每個包含 {metric, trend, message, topPerformers}，其中 topPerformers 為表現最佳的項目列表

⚠️ 重要：請直接回傳JSON物件，不要包裝在markdown代碼塊中，summary欄位使用HTML格式，建議要針對具體的${level === 'campaign' ? '行銷活動' : level === 'adset' ? '廣告組合' : '廣告'}提出。`;

    // 初始化 OpenAI 客戶端
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // 調用 GPT-4.1-mini 分析
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "你是專業的 Meta 廣告分析專家，擅長提供數據驅動的廣告優化建議。請以JSON格式回應，使用繁體中文。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 1500,
      temperature: 0.7
    });

    const aiResponse = completion.choices[0]?.message?.content;
    let aiAnalysis;

    try {
      // 🔧 清理 GPT 回應中的 markdown 代碼塊標記
      let cleanedResponse = aiResponse || '{}';
      
      // 移除 markdown 代碼塊標記
      cleanedResponse = cleanedResponse
        .replace(/```json\s*/gi, '')  // 移除開始標記
        .replace(/```\s*$/gi, '')     // 移除結束標記
        .trim();
      
      console.log('🔍 Cleaned GPT response:', cleanedResponse.substring(0, 200) + '...');
      
      // 嘗試解析清理後的JSON回應
      aiAnalysis = JSON.parse(cleanedResponse);
      aiAnalysis.generatedAt = new Date().toISOString();
      
      console.log('✅ GPT JSON 解析成功');
    } catch (parseError) {
      // 如果JSON解析失敗，返回基本格式
      console.error('❌ Failed to parse GPT response:', parseError);
      console.error('📄 Original response:', aiResponse?.substring(0, 500));
      
      aiAnalysis = {
        summary: aiResponse || "無法生成分析結果",
        recommendations: [],
        insights: [],
        generatedAt: new Date().toISOString()
      };
    }

    res.json({
      success: true,
      data: aiAnalysis
    });

  } catch (error) {
    console.error('AI analysis error:', error);
    
    if (error instanceof Error && error.message.includes('access')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'Invalid or expired Facebook access token'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to generate AI analysis',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 生成業務類型指標的輔助函數
function generateBusinessMetrics(businessType: string) {
  const baseMetrics = {
    type: businessType,
    metrics: {},
    breakdown: {}
  };

  switch (businessType) {
    case 'ecommerce':
      return {
        ...baseMetrics,
        metrics: {
          totalRevenue: 125000,
          orders: 450,
          averageOrderValue: 278,
          conversionRate: 2.8,
          cartAbandonmentRate: 68.5,
          returnCustomerRate: 32.1
        },
        breakdown: {
          '新客戶': 68,
          '回購客戶': 32,
          '手機購買': 65,
          '桌面購買': 35
        }
      };
    
    case 'consultation':
      return {
        ...baseMetrics,
        metrics: {
          totalConsultations: 78,
          bookingRate: 4.2,
          averageSessionValue: 1500,
          clientRetentionRate: 85.3,
          noShowRate: 12.8,
          rebookingRate: 45.6
        },
        breakdown: {
          '首次諮詢': 55,
          '回診': 45,
          '線上諮詢': 70,
          '實體諮詢': 30
        }
      };
    
    case 'leads':
      return {
        ...baseMetrics,
        metrics: {
          totalLeads: 1250,
          qualifiedLeads: 380,
          leadConversionRate: 30.4,
          costPerLead: 45,
          leadToSaleConversion: 18.5,
          averageLeadValue: 750
        },
        breakdown: {
          '高品質': 30,
          '中品質': 50,
          '低品質': 20,
          '待評估': 15
        }
      };
    
    default:
      return baseMetrics;
  }
}

// 保存業務類型端點
router.post('/business-type', requireJWTAuth, async (req: any, res) => {
  try {
    const user = req.user;
    const { businessType } = req.body;
    
    // 驗證業務類型格式
    if (!businessType || !['ecommerce', 'consultation', 'lead_generation'].includes(businessType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid business type. Must be ecommerce, consultation, or lead_generation'
      });
    }

    // 更新用戶的業務類型設定
    await storage.upsertUser({
      id: user.id,
      metaBusinessType: businessType
    });

    res.json({
      success: true,
      message: 'Business type saved successfully',
      businessType
    });

  } catch (error) {
    console.error('Save business type error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save business type',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 獲取業務類型端點
router.get('/business-type', requireJWTAuth, async (req: any, res) => {
  try {
    const user = req.user;
    
    // 獲取用戶資訊包含業務類型
    const userInfo = await storage.getUser(user.id);
    
    if (!userInfo) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      businessType: userInfo.metaBusinessType || 'ecommerce' // 預設為電商
    });

  } catch (error) {
    console.error('Get business type error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get business type',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;