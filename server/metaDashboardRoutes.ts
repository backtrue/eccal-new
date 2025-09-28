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

    // 🎯 構建針對維度的 GPT 分析提示
    const dimensionContext = {
      'account': '請從廣告帳戶整體角度進行分析，重點關注帳戶層級的整體表現',
      'campaign': '請專注分析各個行銷活動的表現差異，找出表現最佳和最差的行銷活動，並提供針對性的優化建議',
      'adset': '請深入分析各廣告組合的表現，重點比較受眾設定、出價策略的效果差異',
      'ad': '請仔細分析各個廣告素材的表現，找出高效廣告的共同特徵和低效廣告的問題點'
    };

    const dimensionFocus = {
      'account': '帳戶整體策略',
      'campaign': '行銷活動',
      'adset': '廣告組合',
      'ad': '廣告素材'
    };

    const prompt = `🔍 **Meta 廣告分析專家報告**

作為專業的 Meta 廣告分析師，請遵循「數據解讀 → 洞察發現 → 行動計劃」的三步驟分析架構，對以下「${dimensionFocus[level as keyof typeof dimensionFocus]}」數據進行深度分析：

## 📊 **分析上下文資訊**
- **業務類型**: ${businessType === 'ecommerce' ? '電商' : businessType === 'consultation' ? '線上諮詢' : '名單收集'}
- **分析維度**: ${level === 'account' ? '廣告帳戶整體' : level === 'campaign' ? '行銷活動明細' : level === 'adset' ? '廣告組合明細' : '廣告素材明細'}
- **項目數量**: ${dashboardData.detailData?.length || 0} 個
- **分析期間**: ${dateRange?.since || '過去30天'} 至 ${dateRange?.until || '今日'}

## 💰 **整體表現匯總**
- **總花費**: $${dashboardData.overview?.totalSpend || 0}
- **曝光數**: ${dashboardData.overview?.totalImpressions?.toLocaleString() || 0}
- **連結點擊**: ${dashboardData.overview?.totalClicks?.toLocaleString() || 0}
- **平均 CTR**: ${dashboardData.metrics?.ctr?.toFixed(2) || 0}%
- **平均 CPC**: $${dashboardData.metrics?.cpc?.toFixed(2) || 0}

${businessType === 'ecommerce' ? `
## 🛒 **電商轉換表現**
- **商品瀏覽**: ${dashboardData.overview?.totalViewContent?.toLocaleString() || 0}
- **加入購物車**: ${dashboardData.overview?.totalAddToCart?.toLocaleString() || 0}
- **完成購買**: ${dashboardData.overview?.totalPurchase?.toLocaleString() || 0}
- **加購率 (ATC%)**: ${dashboardData.metrics?.atcRate?.toFixed(1) || 0}%
- **結帳率 (PF%)**: ${dashboardData.metrics?.pfRate?.toFixed(1) || 0}%
- **廣告投資報酬率 (ROAS)**: ${dashboardData.metrics?.roas?.toFixed(2) || 0}
- **平均購買成本**: $${dashboardData.metrics?.costPerPurchase?.toFixed(2) || 0}
` : businessType === 'consultation' ? `
## 💬 **諮詢互動表現**
- **對話開始次數**: ${dashboardData.overview?.totalMessaging?.toLocaleString() || 0}
- **每次對話成本**: $${dashboardData.metrics?.costPerMessaging?.toFixed(2) || 0}
` : `
## 📋 **潛客收集表現**
- **潛在顧客數**: ${dashboardData.overview?.totalLeads?.toLocaleString() || 0}
- **每名潛客成本**: $${dashboardData.metrics?.costPerLead?.toFixed(2) || 0}
`}

## 📈 **${dimensionFocus[level as keyof typeof dimensionFocus]}明細數據**
${dashboardData.detailData.map((item: any, index: number) => `
**${index + 1}. ${item.name}**
- 花費: $${item.spend.toFixed(2)} | 曝光: ${item.impressions.toLocaleString()} | 點擊: ${item.linkClicks.toLocaleString()}
- CTR: ${item.ctr.toFixed(2)}% | CPC: $${item.cpc.toFixed(2)}
${businessType === 'ecommerce' ? `- 瀏覽: ${item.viewContent} | 加購: ${item.addToCart} | 購買: ${item.purchase} | ROAS: ${item.roas.toFixed(2)}` : ''}
${businessType === 'consultation' ? `- 對話: ${item.messaging} | 對話成本: $${item.costPerMessaging.toFixed(2)}` : ''}
${businessType === 'lead_generation' ? `- 潛客: ${item.leads} | 潛客成本: $${item.costPerLead.toFixed(2)}` : ''}
`).join('')}

---

## 🎯 **三步驟分析架構要求**

請按照以下架構提供分析：

**第一步：數據解讀 (Data Interpretation)**
- 客觀解讀關鍵指標表現
- 識別表現異常和數據模式
- 量化不同${dimensionFocus[level as keyof typeof dimensionFocus]}之間的表現差異

**第二步：洞察發現 (Key Insights)**
- 基於數據發現商業洞察
- 分析表現差異的根本原因
- 找出隱藏的機會和風險點

**第三步：行動計劃 (What's Next)**
- 提供具體可執行的優化步驟
- 設定優先級和預期效果
- 制定短期和中期改善策略

---

**請以純JSON格式回應，包含：**

\`\`\`json
{
  "dataInterpretation": {
    "title": "數據解讀",
    "summary": "整體表現總結 (HTML格式，150字以內)",
    "keyMetrics": [
      {
        "metric": "指標名稱",
        "value": "數值",
        "interpretation": "解讀說明",
        "comparison": "比較分析"
      }
    ],
    "performanceRanking": [
      {
        "rank": 1,
        "name": "項目名稱",
        "score": "表現分數/描述",
        "reason": "排名原因"
      }
    ]
  },
  "insights": {
    "title": "洞察發現", 
    "discoveries": [
      {
        "insight": "洞察標題",
        "finding": "發現內容",
        "impact": "商業影響",
        "evidence": "數據證據"
      }
    ],
    "opportunities": [
      {
        "opportunity": "機會點",
        "potential": "潛在價值",
        "reasoning": "分析推論"
      }
    ],
    "risks": [
      {
        "risk": "風險點",
        "severity": "嚴重程度",
        "mitigation": "緩解建議"
      }
    ]
  },
  "actionPlan": {
    "title": "行動計劃",
    "immediateActions": [
      {
        "action": "立即行動",
        "description": "行動描述",
        "target": "目標項目",
        "expectedImpact": "預期效果",
        "priority": "high/medium/low"
      }
    ],
    "shortTermStrategy": [
      {
        "strategy": "短期策略 (1-4週)",
        "description": "策略描述",
        "steps": ["步驟1", "步驟2"],
        "kpi": "關鍵指標"
      }
    ],
    "mediumTermStrategy": [
      {
        "strategy": "中期策略 (1-3個月)",
        "description": "策略描述", 
        "investment": "所需投入",
        "roi": "預期回報"
      }
    ]
  },
  "generatedAt": "${new Date().toISOString()}"
}
\`\`\`

⚠️ **重要提醒**：
1. 分析必須基於實際數據，避免泛泛而談
2. 針對具體的${dimensionFocus[level as keyof typeof dimensionFocus]}項目提供建議
3. 確保三個步驟邏輯連貫，層層遞進
4. 使用繁體中文，專業但易懂的表達方式`;

    // 初始化 OpenAI 客戶端
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // 調用 GPT-4.1 分析
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: "你是資深的 Meta 廣告分析師，擅長三步驟分析架構：數據解讀→洞察發現→行動計劃。請嚴格按照指定的JSON格式回應，使用繁體中文，確保分析具體、可執行且邏輯清晰。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 3000,
      temperature: 0.3
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