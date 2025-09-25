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

    // 獲取真實廣告帳戶數據
    const accountData = await metaAccountService.getAdAccountData(user.metaAccessToken, user.metaAdAccountId);

    // 基於真實數據構建完整的儀表板指標
    // 添加業務類型相關的模擬數據（未來將被真實API替換）
    const generateBusinessMetrics = (baseData: any, type: string) => {
      const multiplier = Math.random() * 0.5 + 0.75; // 0.75-1.25倍隨機變化
      
      switch (type) {
        case 'ecommerce':
          return {
            totalViewContent: Math.floor(baseData.impressions * 0.15 * multiplier),
            totalAddToCart: Math.floor(baseData.impressions * 0.03 * multiplier),
            totalPurchase: Math.floor(baseData.impressions * 0.008 * multiplier),
            totalPurchaseValue: Math.floor((baseData.impressions * 0.008 * multiplier) * 75),
            totalMessaging: 0,
            totalLeads: 0,
          };
        case 'consultation':
          return {
            totalViewContent: 0,
            totalAddToCart: 0,
            totalPurchase: 0,
            totalPurchaseValue: 0,
            totalMessaging: Math.floor(baseData.clicks * 0.12 * multiplier),
            totalLeads: 0,
          };
        case 'lead_generation':
          return {
            totalViewContent: 0,
            totalAddToCart: 0,
            totalPurchase: 0,
            totalPurchaseValue: 0,
            totalMessaging: 0,
            totalLeads: Math.floor(baseData.clicks * 0.08 * multiplier),
          };
        default:
          return {
            totalViewContent: 0,
            totalAddToCart: 0,
            totalPurchase: 0,
            totalPurchaseValue: 0,
            totalMessaging: 0,
            totalLeads: 0,
          };
      }
    };

    const businessMetrics = generateBusinessMetrics(accountData, businessType);
    
    // 聚合所有數據
    const aggregated = {
      totalSpend: accountData.spend || 0,
      totalImpressions: accountData.impressions || 0,
      totalReach: Math.floor((accountData.impressions || 0) * 0.8), // 估算觸及數
      totalClicks: accountData.linkClicks || accountData.clicks || 0,
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

請以JSON格式提供分析結果，包含:
1. summary: 整體表現總結 (100字以內，繁體中文)
2. recommendations: 3-5個具體改善建議，每個包含 {type, title, description, priority, impact}
3. insights: 2-3個關鍵洞察，每個包含 {metric, trend, message}

請使用繁體中文回應，提供專業且可執行的建議。`;

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
      // 嘗試解析JSON回應
      aiAnalysis = JSON.parse(aiResponse || '{}');
      aiAnalysis.generatedAt = new Date().toISOString();
    } catch (parseError) {
      // 如果JSON解析失敗，返回基本格式
      console.error('Failed to parse GPT response:', parseError);
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
    await storage.updateUser(user.id, {
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
    const userInfo = await storage.getUserById(user.id);
    
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