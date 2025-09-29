import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Crown, Star, ExternalLink, GraduationCap, Users } from "lucide-react";
import { Link } from "wouter";

interface ProUpgradePromptProps {
  featureName: string;
  description: string;
  locale?: string;
}

export default function ProUpgradePrompt({ 
  featureName, 
  description, 
  locale = "zh-TW" 
}: ProUpgradePromptProps) {
  const translations = {
    "zh-TW": {
      upgradeTitle: "升級至 Pro 會員",
      upgradeSubtitle: "解鎖進階功能，提升廣告投放效果",
      currentFeature: "您正在嘗試使用",
      featureDescription: "此功能需要 Pro 會員權限才能使用",
      proBenefits: "Pro 會員專享功能",
      benefit1: "完整預算規劃工具",
      benefit2: "深度廣告健檢分析", 
      benefit3: "詳細成效報表與 AI 分析",
      benefit4: "優先客服支援",
      upgradeButton: "立即升級 Pro 會員",
      courseTitle: "課程學員免費升級",
      courseDescription: "已報名《FB 廣告成效攻略》課程的同學",
      courseAction: "可免費升級為 Pro 會員",
      surveyButton: "填寫免費升級表單",
      surveyNote: "請填寫購課姓名、購課 Email 及報數據登入 Email"
    },
    "en": {
      upgradeTitle: "Upgrade to Pro",
      upgradeSubtitle: "Unlock advanced features to boost your ad performance",
      currentFeature: "You're trying to access",
      featureDescription: "This feature requires Pro membership to access",
      proBenefits: "Pro Member Exclusive Features",
      benefit1: "Complete budget planning tools",
      benefit2: "In-depth ad health analysis",
      benefit3: "Detailed performance reports & AI analysis", 
      benefit4: "Priority customer support",
      upgradeButton: "Upgrade to Pro Now",
      courseTitle: "Free Upgrade for Course Students",
      courseDescription: "Students enrolled in FB Ad Performance Course",
      courseAction: "Get free Pro membership upgrade",
      surveyButton: "Fill Free Upgrade Form",
      surveyNote: "Please provide course name, course email & login email"
    },
    "ja": {
      upgradeTitle: "Proにアップグレード",
      upgradeSubtitle: "高度な機能で広告パフォーマンスを向上",
      currentFeature: "アクセスしようとしている機能",
      featureDescription: "この機能はProメンバーシップが必要です",
      proBenefits: "Proメンバー限定機能",
      benefit1: "完全な予算計画ツール",
      benefit2: "詳細な広告健全性分析",
      benefit3: "詳細なパフォーマンスレポート＆AI分析",
      benefit4: "優先カスタマーサポート",
      upgradeButton: "今すぐProにアップグレード", 
      courseTitle: "コース受講生無料アップグレード",
      courseDescription: "FB広告パフォーマンスコースの受講生",
      courseAction: "無料Proメンバーシップアップグレード",
      surveyButton: "無料アップグレードフォーム",
      surveyNote: "コース名、コースメール、ログインメールをご記入ください"
    }
  };

  const t = translations[locale as keyof typeof translations] || translations["zh-TW"];

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl border-2 border-yellow-200 bg-gradient-to-br from-yellow-50 to-orange-50">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full">
              <Crown className="w-8 h-8 text-white" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold text-gray-800 mb-2">
            {t.upgradeTitle}
          </CardTitle>
          <p className="text-gray-600 text-lg">
            {t.upgradeSubtitle}
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Current Feature Info */}
          <div className="bg-white rounded-lg p-4 border border-yellow-200">
            <div className="flex items-center gap-3 mb-2">
              <Star className="w-5 h-5 text-yellow-500" />
              <span className="text-sm text-gray-600">{t.currentFeature}</span>
            </div>
            <h3 className="font-semibold text-lg text-gray-800 mb-1">{featureName}</h3>
            <p className="text-gray-600">{description}</p>
            <p className="text-sm text-orange-600 mt-2">{t.featureDescription}</p>
          </div>

          {/* Pro Benefits */}
          <div className="bg-white rounded-lg p-4 border border-yellow-200">
            <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Crown className="w-4 h-4 text-yellow-500" />
              {t.proBenefits}
            </h4>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-gray-700">
                <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
                {t.benefit1}
              </li>
              <li className="flex items-center gap-2 text-gray-700">
                <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
                {t.benefit2}
              </li>
              <li className="flex items-center gap-2 text-gray-700">
                <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
                {t.benefit3}
              </li>
              <li className="flex items-center gap-2 text-gray-700">
                <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
                {t.benefit4}
              </li>
            </ul>
          </div>

          {/* Upgrade Options */}
          <div className="space-y-4">
            {/* Paid Upgrade */}
            <Link href="/pricing">
              <Button 
                className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 text-white border-0"
                data-testid="button-upgrade-pro"
              >
                <Crown className="w-5 h-5 mr-2" />
                {t.upgradeButton}
                <ExternalLink className="w-4 h-4 ml-2" />
              </Button>
            </Link>

            {/* Course Student Free Upgrade */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-100 rounded-full">
                  <GraduationCap className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h5 className="font-semibold text-blue-800 mb-1">{t.courseTitle}</h5>
                  <p className="text-blue-700 text-sm mb-2">{t.courseDescription}</p>
                  <Badge variant="secondary" className="bg-blue-100 text-blue-800 mb-3">
                    {t.courseAction}
                  </Badge>
                  
                  <a 
                    href="https://www.surveycake.com/s/r0Wn8"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button 
                      variant="outline" 
                      className="w-full border-blue-300 text-blue-700 hover:bg-blue-50"
                      data-testid="button-course-upgrade-form"
                    >
                      <Users className="w-4 h-4 mr-2" />
                      {t.surveyButton}
                      <ExternalLink className="w-4 h-4 ml-2" />
                    </Button>
                  </a>
                  
                  <p className="text-xs text-blue-600 mt-2">
                    {t.surveyNote}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}