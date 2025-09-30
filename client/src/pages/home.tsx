import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calculator, TrendingUp, Target, BarChart3, Activity, ArrowRight, Zap, Shield, Star, Monitor, Users, CheckCircle2, Clock } from "lucide-react";
import { Link } from "wouter";
import NavigationBar from "@/components/NavigationBar";
import Footer from "@/components/Footer";
import { getTranslations, type Locale } from "@/lib/i18n";
import { trackEvent } from "@/lib/analytics";
import { trackMetaEvent } from "@/lib/meta-pixel";

interface HomeProps {
  locale: Locale;
}

export default function Home({ locale }: HomeProps) {
  const t = getTranslations(locale);

  const handleCalculatorClick = () => {
    trackEvent('navigate_calculator', 'navigation', 'home_page');
    trackMetaEvent('ViewContent', { content_name: 'Calculator Page', content_category: 'Navigation' });
  };

  const handleCampaignPlannerClick = () => {
    trackEvent('navigate_campaign_planner', 'navigation', 'home_page');
    trackMetaEvent('ViewContent', { content_name: 'Campaign Planner Page', content_category: 'Navigation' });
  };

  const handleFbAuditClick = () => {
    trackEvent('navigate_fbaudit', 'navigation', 'home_page');
    trackMetaEvent('ViewContent', { content_name: 'FB Audit Page', content_category: 'Navigation' });
  };

  const handleMetaDashboardClick = () => {
    trackEvent('navigate_meta_dashboard', 'navigation', 'home_page');
    trackMetaEvent('ViewContent', { content_name: 'Meta Dashboard Page', content_category: 'Navigation' });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <NavigationBar locale={locale} />
      
      {/* Hero Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-5xl md:text-7xl font-bold text-gray-900 dark:text-white mb-6">
            {locale === 'zh-TW' ? '報數據' : locale === 'en' ? 'Report Data' : 'レポートデータ'}
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-300 mb-4">
            {locale === 'zh-TW' 
              ? '專業電商廣告分析平台'
              : locale === 'en'
              ? 'Professional E-commerce Advertising Analytics Platform'
              : 'プロフェッショナル電子商取引広告分析プラットフォーム'}
          </p>
          <p className="text-lg text-gray-500 dark:text-gray-400 mb-8 max-w-3xl mx-auto">
            {locale === 'zh-TW' 
              ? '提供 Facebook 廣告健檢、預算計算、活動規劃、數據儀表板四大核心服務，助您精準投放廣告，最大化投資回報'
              : locale === 'en'
              ? 'Offering four core services: Facebook ad health checks, budget calculation, campaign planning, and data dashboard to optimize your advertising ROI'
              : 'Facebook広告ヘルスチェック、予算計算、キャンペーン企画、データダッシュボードの4つのコアサービスで、広告ROIを最大化'}
          </p>

          {/* Social Proof & Value Proposition */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            {/* NPS Score Badge */}
            <div className="inline-flex items-center gap-2 bg-white dark:bg-gray-800 px-6 py-3 rounded-full shadow-lg">
              <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
              <span className="text-lg font-semibold text-gray-900 dark:text-white">
                {locale === 'zh-TW' ? '用戶推薦度' : locale === 'en' ? 'User NPS Score' : 'ユーザー推奨度'}
              </span>
              <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">8.3</span>
              <span className="text-gray-500 dark:text-gray-400">/10</span>
            </div>

            {/* Users Count Badge */}
            <div className="inline-flex items-center gap-2 bg-white dark:bg-gray-800 px-6 py-3 rounded-full shadow-lg">
              <Users className="h-5 w-5 text-green-600 dark:text-green-400" />
              <span className="text-lg font-semibold text-gray-900 dark:text-white">
                {locale === 'zh-TW' ? '350+ 品牌信賴' : locale === 'en' ? '350+ Brands Trust Us' : '350+ ブランド信頼'}
              </span>
            </div>
          </div>

          {/* Value Proposition & CTA */}
          <div className="mb-12">
            <p className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {locale === 'zh-TW' 
                ? '每天只要 NT$43，找出廣告浪費、優化投放策略'
                : locale === 'en'
                ? 'Only $43/day to identify ad waste and optimize your strategy'
                : '1日わずか¥43で、広告の無駄を発見し、戦略を最適化'}
            </p>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {locale === 'zh-TW' 
                ? 'NT$1,280/月，物超所值的專業廣告分析工具'
                : locale === 'en'
                ? 'NT$1,280/month - Professional ad analysis tool with exceptional value'
                : '月額NT$1,280 - 価値ある専門広告分析ツール'}
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href={locale === 'zh-TW' ? '/pricing' : `/${locale === 'en' ? 'en' : 'jp'}/pricing`}>
                <Button size="lg" className="text-lg px-8 py-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-xl hover:shadow-2xl transition-all">
                  <Zap className="mr-2 h-5 w-5" />
                  {locale === 'zh-TW' ? '立即升級 PRO' : locale === 'en' ? 'Upgrade to PRO Now' : '今すぐPROアップグレード'}
                </Button>
              </Link>
              <Link href={locale === 'zh-TW' ? '/help/fbaudit' : `/${locale === 'en' ? 'en' : 'jp'}/help/fbaudit`}>
                <Button variant="outline" size="lg" className="text-lg px-8 py-6">
                  <Shield className="mr-2 h-5 w-5" />
                  {locale === 'zh-TW' ? '查看完整功能' : locale === 'en' ? 'View All Features' : '全機能を見る'}
                </Button>
              </Link>
            </div>
          </div>

          {/* Pain Points Section */}
          <div className="mb-16 max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-6">
              {locale === 'zh-TW' ? '你是否也遇到這些困擾？' : locale === 'en' ? 'Are You Facing These Challenges?' : 'こんな悩みはありませんか？'}
            </h2>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                <div className="mt-1">
                  <div className="h-6 w-6 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
                    <span className="text-red-600 dark:text-red-400 font-bold">✗</span>
                  </div>
                </div>
                <p className="text-gray-700 dark:text-gray-300">
                  {locale === 'zh-TW' ? '廣告花很多，訂單卻很少？' : locale === 'en' ? 'Spending a lot on ads but getting few orders?' : '広告費は高いのに、注文が少ない？'}
                </p>
              </div>
              <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                <div className="mt-1">
                  <div className="h-6 w-6 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
                    <span className="text-red-600 dark:text-red-400 font-bold">✗</span>
                  </div>
                </div>
                <p className="text-gray-700 dark:text-gray-300">
                  {locale === 'zh-TW' ? '不知道預算該抓多少才夠？' : locale === 'en' ? "Don't know how much budget to allocate?" : '予算をいくらにすべきか分からない？'}
                </p>
              </div>
              <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                <div className="mt-1">
                  <div className="h-6 w-6 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
                    <span className="text-red-600 dark:text-red-400 font-bold">✗</span>
                  </div>
                </div>
                <p className="text-gray-700 dark:text-gray-300">
                  {locale === 'zh-TW' ? '活動預算分配憑感覺，沒把握？' : locale === 'en' ? 'Campaign budget allocation based on guesswork?' : 'キャンペーン予算配分が勘頼み？'}
                </p>
              </div>
              <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                <div className="mt-1">
                  <div className="h-6 w-6 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
                    <span className="text-red-600 dark:text-red-400 font-bold">✗</span>
                  </div>
                </div>
                <p className="text-gray-700 dark:text-gray-300">
                  {locale === 'zh-TW' ? '想優化廣告，但不知從何下手？' : locale === 'en' ? 'Want to optimize ads but don\'t know where to start?' : '広告最適化したいけど、どこから手をつけるべき？'}
                </p>
              </div>
            </div>
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-700 dark:to-purple-700 p-6 rounded-xl text-center">
              <CheckCircle2 className="h-12 w-12 text-white mx-auto mb-3" />
              <p className="text-xl font-bold text-white">
                {locale === 'zh-TW' ? '報數據幫你解決這些問題！' : locale === 'en' ? 'Report Data Solves These Problems!' : 'レポートデータがこれらの問題を解決！'}
              </p>
            </div>
          </div>

          {/* Service Cards Grid - 2x2 Layout */}
          <div className="grid md:grid-cols-2 gap-8 mb-16 max-w-5xl mx-auto">
            {/* FB Ads Health Check */}
            <Card className="group hover:shadow-xl transition-all duration-300 border-2 hover:border-red-200 dark:hover:border-red-800">
              <CardHeader className="pb-4">
                <div className="mx-auto mb-4 h-20 w-20 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Activity className="h-10 w-10 text-red-600 dark:text-red-400" />
                </div>
                <CardTitle className="text-xl">
                  {locale === 'zh-TW' ? 'FB廣告健檢' : locale === 'en' ? 'FB Ads Health Check' : 'FB広告ヘルスチェック'}
                </CardTitle>
                <Badge variant="outline" className="w-fit mx-auto">
                  {locale === 'zh-TW' ? 'AI 驅動' : locale === 'en' ? 'AI Powered' : 'AI駆動'}
                </Badge>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
                  {locale === 'zh-TW' 
                    ? '專業 AI 分析您的 Facebook 廣告帳戶表現，3分鐘找出問題所在，提供個人化改善建議與 Hero Post 識別'
                    : locale === 'en'
                    ? 'Professional AI analysis of your Facebook ad account performance, find issues in 3 minutes with personalized improvement suggestions and Hero Post identification'
                    : 'Facebook広告アカウントのパフォーマンスをプロのAIが分析し、3分で問題を発見、個別の改善提案とHero Post識別を提供'}
                </p>
                <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                  <Clock className="h-4 w-4 inline mr-1" />
                  {locale === 'zh-TW' ? 'PRO 會員無限次使用' : locale === 'en' ? 'Unlimited for PRO members' : 'PROメンバーは無制限利用'}
                </div>
                <Link href={locale === 'zh-TW' ? '/fbaudit' : `/${locale === 'en' ? 'en' : 'jp'}/fbaudit`}>
                  <Button 
                    className="w-full bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white"
                    onClick={handleFbAuditClick}
                    data-testid="button-fbaudit"
                  >
                    {locale === 'zh-TW' ? '開始健檢' : locale === 'en' ? 'Start Health Check' : 'ヘルスチェック開始'}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Budget Calculator */}
            <Card className="group hover:shadow-xl transition-all duration-300 border-2 hover:border-blue-200 dark:hover:border-blue-800">
              <CardHeader className="pb-4">
                <div className="mx-auto mb-4 h-20 w-20 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Calculator className="h-10 w-10 text-blue-600 dark:text-blue-400" />
                </div>
                <CardTitle className="text-xl">
                  {locale === 'zh-TW' ? '廣告預算計算機' : locale === 'en' ? 'Ad Budget Calculator' : '広告予算計算機'}
                </CardTitle>
                <Badge variant="outline" className="w-fit mx-auto">
                  {locale === 'zh-TW' ? 'GA4 整合' : locale === 'en' ? 'GA4 Integration' : 'GA4連携'}
                </Badge>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
                  {locale === 'zh-TW' 
                    ? '根據目標營收、客單價、轉換率智能計算廣告預算需求，避免預算不足或浪費，支援 Google Analytics 數據匯入'
                    : locale === 'en'
                    ? 'Intelligent ad budget calculation based on target revenue, AOV, and conversion rate, avoid budget shortage or waste with Google Analytics data import'
                    : '目標売上、客単価、コンバージョン率に基づく知的広告予算計算、予算不足や無駄を回避、Google Analyticsデータインポート対応'}
                </p>
                <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                  <CheckCircle2 className="h-4 w-4 inline mr-1" />
                  {locale === 'zh-TW' ? '科學化預算規劃，不再憑感覺' : locale === 'en' ? 'Scientific budget planning, no more guesswork' : '科学的予算計画、もう勘に頼らない'}
                </div>
                <Link href={locale === 'zh-TW' ? '/calculator' : `/${locale === 'en' ? 'en' : 'jp'}/calculator`}>
                  <Button 
                    className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white"
                    onClick={handleCalculatorClick}
                    data-testid="button-calculator"
                  >
                    {locale === 'zh-TW' ? '開始計算' : locale === 'en' ? 'Start Calculating' : '計算開始'}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Campaign Planner */}
            <Card className="group hover:shadow-xl transition-all duration-300 border-2 hover:border-purple-200 dark:hover:border-purple-800">
              <CardHeader className="pb-4">
                <div className="mx-auto mb-4 h-20 w-20 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <BarChart3 className="h-10 w-10 text-purple-600 dark:text-purple-400" />
                </div>
                <CardTitle className="text-xl">
                  {locale === 'zh-TW' ? '活動預算規劃師' : locale === 'en' ? 'Campaign Budget Planner' : 'キャンペーン予算プランナー'}
                </CardTitle>
                <Badge variant="outline" className="w-fit mx-auto">
                  {locale === 'zh-TW' ? 'PRO 功能' : locale === 'en' ? 'PRO Feature' : 'PRO機能'}
                </Badge>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
                  {locale === 'zh-TW' 
                    ? '專業五階段活動預算配置：預熱期、啟動期、主推期、衝刺期、回購期，智能分配每日預算，讓大檔活動不再手忙腳亂'
                    : locale === 'en'
                    ? 'Professional 5-phase campaign budget allocation: Pre-heat, Launch, Main, Final, Repurchase with intelligent daily budget distribution for stress-free major campaigns'
                    : 'プロ5段階キャンペーン予算配分：予熱期、開始期、メイン期、最終期、リピート期、知的日次予算分散で大型キャンペーンも余裕'}
                </p>
                <div className="mb-4 text-sm text-purple-600 dark:text-purple-400 font-semibold">
                  <Zap className="h-4 w-4 inline mr-1" />
                  {locale === 'zh-TW' ? 'PRO 會員專屬功能' : locale === 'en' ? 'Exclusive PRO Feature' : 'PROメンバー専用機能'}
                </div>
                <Link href={locale === 'zh-TW' ? '/campaign-planner' : `/${locale === 'en' ? 'en' : 'jp'}/campaign-planner`}>
                  <Button 
                    className="w-full bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-800 text-white"
                    onClick={handleCampaignPlannerClick}
                    data-testid="button-campaign-planner"
                  >
                    {locale === 'zh-TW' ? '開始規劃' : locale === 'en' ? 'Start Planning' : '企画開始'}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Meta Dashboard */}
            <Card className="group hover:shadow-xl transition-all duration-300 border-2 hover:border-emerald-200 dark:hover:border-emerald-800">
              <CardHeader className="pb-4">
                <div className="mx-auto mb-4 h-20 w-20 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Monitor className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
                </div>
                <CardTitle className="text-xl">
                  {locale === 'zh-TW' ? 'Meta 數據儀表板' : locale === 'en' ? 'Meta Data Dashboard' : 'Metaデータダッシュボード'}
                </CardTitle>
                <Badge variant="outline" className="w-fit mx-auto">
                  {locale === 'zh-TW' ? '實時數據' : locale === 'en' ? 'Real-time Data' : 'リアルタイムデータ'}
                </Badge>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
                  {locale === 'zh-TW' 
                    ? '整合多個 Meta 廣告帳戶，即時監控廣告數據表現，一站式管理所有廣告投放狀況，不再來回切換帳戶'
                    : locale === 'en'
                    ? 'Integrate multiple Meta ad accounts, monitor ad performance in real-time, manage all ad campaigns in one place, no more account switching'
                    : '複数のMeta広告アカウントを統合し、広告パフォーマンスをリアルタイムで監視、すべての広告キャンペーンを一元管理、アカウント切替不要'}
                </p>
                <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                  <TrendingUp className="h-4 w-4 inline mr-1" />
                  {locale === 'zh-TW' ? '多帳戶整合，效率提升 10 倍' : locale === 'en' ? 'Multi-account integration, 10x efficiency' : 'マルチアカウント統合、効率10倍'}
                </div>
                <Link href={locale === 'zh-TW' ? '/meta-dashboard' : `/${locale === 'en' ? 'en' : 'jp'}/meta-dashboard`}>
                  <Button 
                    className="w-full bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-800 text-white"
                    onClick={handleMetaDashboardClick}
                    data-testid="button-meta-dashboard"
                  >
                    {locale === 'zh-TW' ? '查看儀表板' : locale === 'en' ? 'View Dashboard' : 'ダッシュボード表示'}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>

          {/* Customer Success Stories */}
          <div className="mb-16 max-w-6xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-8 text-center">
              {locale === 'zh-TW' ? '用戶真實成果' : locale === 'en' ? 'Real User Results' : 'ユーザーの実績'}
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="border-2 border-blue-100 dark:border-blue-900">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                        <TrendingUp className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                      </div>
                    </div>
                    <div>
                      <div className="flex gap-1 mb-2">
                        {[1,2,3,4,5].map(i => (
                          <Star key={i} className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                        ))}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                        {locale === 'zh-TW' ? '保健品電商' : locale === 'en' ? 'Health E-commerce' : '健康食品EC'}
                      </p>
                    </div>
                  </div>
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    {locale === 'zh-TW' 
                      ? '使用廣告健檢功能後，CPA 從 $800 降到 $280，找出了之前沒發現的受眾問題。'
                      : locale === 'en'
                      ? 'After using the ad health check, CPA dropped from $800 to $280, uncovering audience issues I never noticed.'
                      : '広告ヘルスチェック利用後、CPAが$800から$280に低下、以前気づかなかったオーディエンス問題を発見。'}
                  </p>
                  <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                    {locale === 'zh-TW' ? 'CPA 降低 65%' : locale === 'en' ? 'CPA reduced by 65%' : 'CPA 65%削減'}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 border-purple-100 dark:border-purple-900">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
                        <BarChart3 className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                      </div>
                    </div>
                    <div>
                      <div className="flex gap-1 mb-2">
                        {[1,2,3,4,5].map(i => (
                          <Star key={i} className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                        ))}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                        {locale === 'zh-TW' ? '服飾電商' : locale === 'en' ? 'Fashion E-commerce' : 'ファッションEC'}
                      </p>
                    </div>
                  </div>
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    {locale === 'zh-TW' 
                      ? '用活動預算規劃師跑雙11，不再手忙腳亂。5階段分配讓整個活動有條不紊，ROAS 提升 2.5 倍。'
                      : locale === 'en'
                      ? 'Used campaign planner for 11.11, no more chaos. 5-phase allocation kept everything organized, ROAS increased 2.5x.'
                      : 'キャンペーンプランナーで11.11を実施、混乱なし。5段階配分で整然と進行、ROAS 2.5倍向上。'}
                  </p>
                  <p className="text-sm font-semibold text-purple-600 dark:text-purple-400">
                    {locale === 'zh-TW' ? 'ROAS 提升 2.5 倍' : locale === 'en' ? 'ROAS increased 2.5x' : 'ROAS 2.5倍向上'}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 border-emerald-100 dark:border-emerald-900">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                        <Monitor className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                      </div>
                    </div>
                    <div>
                      <div className="flex gap-1 mb-2">
                        {[1,2,3,4,5].map(i => (
                          <Star key={i} className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                        ))}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                        {locale === 'zh-TW' ? '代理商' : locale === 'en' ? 'Agency' : '広告代理店'}
                      </p>
                    </div>
                  </div>
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    {locale === 'zh-TW' 
                      ? '管理 20 個客戶帳戶，Meta 儀表板讓我不用來回切換，工作效率提升 10 倍。'
                      : locale === 'en'
                      ? 'Managing 20 client accounts, Meta dashboard eliminated account switching, 10x efficiency boost.'
                      : '20のクライアントアカウント管理、Metaダッシュボードでアカウント切替不要、効率10倍向上。'}
                  </p>
                  <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    {locale === 'zh-TW' ? '效率提升 10 倍' : locale === 'en' ? '10x efficiency boost' : '効率10倍向上'}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Quick Access Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href={locale === 'zh-TW' ? '/pricing' : `/${locale === 'en' ? 'en' : 'jp'}/pricing`}>
              <Button variant="outline" size="lg" className="text-lg px-8 py-3">
                <Zap className="mr-2 h-5 w-5" />
                {locale === 'zh-TW' ? '查看方案' : locale === 'en' ? 'View Pricing' : '料金プラン'}
              </Button>
            </Link>
            <Link href={locale === 'zh-TW' ? '/help/fbaudit' : `/${locale === 'en' ? 'en' : 'jp'}/help/fbaudit`}>
              <Button variant="outline" size="lg" className="text-lg px-8 py-3">
                <Shield className="mr-2 h-5 w-5" />
                {locale === 'zh-TW' ? '功能說明' : locale === 'en' ? 'Feature Guide' : '機能説明'}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Highlight */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-white dark:bg-gray-900">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
              {locale === 'zh-TW' ? '為什麼選擇報數據？' : locale === 'en' ? 'Why Choose Report Data?' : 'なぜレポートデータを選ぶのか？'}
            </h2>
            <p className="text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              {locale === 'zh-TW' 
                ? '專業的電商廣告分析平台，整合 AI 智能分析、數據驅動決策、多語言支援'
                : locale === 'en'
                ? 'Professional e-commerce advertising analytics platform with AI-powered analysis, data-driven decisions, and multilingual support'
                : 'AI知的分析、データ駆動決定、多言語サポートを統合したプロフェッショナル電子商取引広告分析プラットフォーム'}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <Zap className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                {locale === 'zh-TW' ? 'AI 智能分析' : locale === 'en' ? 'AI-Powered Analysis' : 'AI知的分析'}
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                {locale === 'zh-TW' 
                  ? '運用最新 AI 技術深度分析廣告數據，提供專業改善建議'
                  : locale === 'en'
                  ? 'Leverage cutting-edge AI technology to deeply analyze ad data and provide professional improvement suggestions'
                  : '最新のAI技術を活用して広告データを深く分析し、プロの改善提案を提供'}
              </p>
            </div>
            
            <div className="text-center">
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                <Target className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                {locale === 'zh-TW' ? '精準預算規劃' : locale === 'en' ? 'Precise Budget Planning' : '精密予算計画'}
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                {locale === 'zh-TW' 
                  ? '科學化的預算計算與分配策略，最大化廣告投資回報率'
                  : locale === 'en'
                  ? 'Scientific budget calculation and allocation strategies to maximize advertising ROI'
                  : '科学的な予算計算と配分戦略で、広告ROIを最大化'}
              </p>
            </div>
            
            <div className="text-center">
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
                <Shield className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                {locale === 'zh-TW' ? '多語言專業支援' : locale === 'en' ? 'Multilingual Professional Support' : '多言語プロサポート'}
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                {locale === 'zh-TW' 
                  ? '支援繁體中文、英文、日文，專業商務術語本地化'
                  : locale === 'en'
                  ? 'Support for Traditional Chinese, English, and Japanese with localized professional business terminology'
                  : '繁体字中国語、英語、日本語対応、プロビジネス用語のローカライズ'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}