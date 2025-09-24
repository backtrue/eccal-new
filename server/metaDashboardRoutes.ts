import express from 'express';
import { requireJWTAuth } from './jwtAuth';
import { metaAccountService } from './metaAccountService';

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

    // 獲取廣告帳戶數據
    const accountData = await metaAccountService.getAdAccountData(user.metaAccessToken, user.metaAdAccountId);
    
    // 模擬儀表板數據（基於真實帳戶信息）
    const dashboardData = {
      account: {
        id: user.metaAdAccountId,
        name: accountData.accountName || `Account ${user.metaAdAccountId}`,
        currency: accountData.currency || 'USD',
        timezone: accountData.timezone || 'UTC'
      },
      performance: {
        spend: accountData.spend || 0,
        impressions: accountData.impressions || 0,
        clicks: accountData.clicks || 0,
        conversions: accountData.conversions || 0,
        cpm: accountData.cpm || 0,
        cpc: accountData.cpc || 0,
        ctr: accountData.ctr || 0,
        roas: accountData.roas || 0
      },
      dateRange: {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
      },
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

// AI 分析端點
router.get('/ai-analysis', requireJWTAuth, async (req: any, res) => {
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

    // 模擬 AI 分析結果
    const aiAnalysis = {
      summary: "您的廣告帳戶整體表現良好，建議優化轉換率和降低成本。",
      recommendations: [
        {
          type: "optimization",
          title: "優化目標受眾",
          description: "建議縮小目標受眾範圍以提高轉換率",
          priority: "high",
          impact: "medium"
        },
        {
          type: "budget",
          title: "調整預算分配",
          description: "將更多預算分配給高表現的廣告組",
          priority: "medium",
          impact: "high"
        },
        {
          type: "creative",
          title: "更新廣告素材",
          description: "測試新的廣告圖片和文案以提高點擊率",
          priority: "medium",
          impact: "medium"
        }
      ],
      insights: [
        {
          metric: "roas",
          trend: "improving",
          message: "投資回報率在過去7天中提升了15%"
        },
        {
          metric: "cpm",
          trend: "stable",
          message: "千次曝光成本保持穩定"
        }
      ],
      generatedAt: new Date().toISOString()
    };

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

export default router;