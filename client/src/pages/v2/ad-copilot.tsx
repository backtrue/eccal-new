import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Building2, CheckCircle2, CircleDot, ExternalLink, Loader2, Play, XCircle } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import GoogleLoginButton from "@/components/GoogleLoginButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

type ApiResponse<T> = {
  success: boolean;
  data: T;
  error?: string;
  details?: unknown;
};

type Company = {
  id: string;
  brandName: string;
  companyName?: string | null;
  websiteUrl?: string | null;
  industry?: string | null;
  businessModel: string;
  currency: string;
  primaryMarket: string;
  description?: string | null;
};

type CompanyContext = {
  company: Company;
  financialProfile: Record<string, string | null> | null;
  adAccounts: CompanyAdAccount[];
  products: unknown[];
  activeDecisionRuleSet: unknown | null;
};

type CompanyAdAccount = {
  id: string;
  adAccountId: string;
  adAccountName?: string | null;
  currency?: string | null;
};

type Plan = {
  id: string;
  planName: string;
  targetRoas: string;
  dailyAdBudget: string;
  requiredOrders: number;
  currency: string;
};

type MetaAccount = {
  id: string;
  name: string;
};

type Recommendation = {
  id: string;
  companyId: string;
  decisionMode: string;
  overallStatus: string;
  priority: "high" | "medium" | "low";
  actionType: string;
  targetLevel: string;
  reasonSummary: string;
  detailedReason?: string | null;
  recommendedAction: string;
  riskNote?: string | null;
  metricsSnapshot: any;
  approvalStatus: "pending" | "approved" | "rejected" | "executed" | "dismissed";
  createdAt?: string | null;
};

const statusLabel: Record<string, string> = {
  can_scale: "可加碼",
  observe: "觀察",
  needs_fix: "需修正",
  stop_loss: "止損",
  insufficient_data: "資料不足",
};

const actionLabel: Record<string, string> = {
  increase_budget: "加碼預算",
  decrease_budget: "降低預算",
  pause_ad: "暫停廣告",
  pause_adset: "暫停廣告組",
  move_budget: "移轉預算",
  add_creatives: "補素材",
  create_new_adset: "新增廣告組",
  fix_tracking: "修 tracking",
  improve_landing_page: "改善落地頁",
  observe: "觀察",
  other: "其他",
};

export default function V2AdCopilot() {
  const [, params] = useRoute("/v2/companies/:companyId");
  const [, navigate] = useLocation();
  const selectedCompanyId = params?.companyId;
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <PageShell><LoadingBlock label="確認登入狀態" /></PageShell>;
  }

  if (!isAuthenticated) {
    return (
      <PageShell>
        <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center text-center">
          <Badge className="mb-4 bg-slate-900 text-white">Beta</Badge>
          <h1 className="text-4xl font-bold tracking-tight text-slate-950">小黑幫你調廣告</h1>
          <p className="mt-4 text-lg text-slate-600">
            登入後建立公司資料、選擇既有 Plan，系統會依 Meta104 規則產生今日廣告調整建議。
          </p>
          <div className="mt-8">
            <GoogleLoginButton locale="zh-TW" />
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <V2Workspace selectedCompanyId={selectedCompanyId} onSelectCompany={(id) => navigate(`/v2/companies/${id}`)} />
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <NavigationBar locale="zh-TW" />
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}

function V2Workspace({ selectedCompanyId, onSelectCompany }: { selectedCompanyId?: string; onSelectCompany: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const companiesQuery = useQuery<ApiResponse<Company[]>>({
    queryKey: ["/api/v2/companies"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const recommendationsQuery = useQuery<ApiResponse<Recommendation[]>>({
    queryKey: [selectedCompanyId ? `/api/v2/ad-decision/recommendations?companyId=${selectedCompanyId}` : "/api/v2/ad-decision/recommendations"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: Boolean(companiesQuery.data),
  });

  const companies = companiesQuery.data?.data || [];
  const activeCompanyId = selectedCompanyId || companies[0]?.id;

  const createCompany = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/v2/companies", payload);
      return res.json() as Promise<ApiResponse<Company>>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/companies"] });
      toast({ title: "公司已建立", description: result.data.brandName });
      onSelectCompany(result.data.id);
    },
    onError: (error) => toast({ title: "建立公司失敗", description: String(error), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <HeroHeader />
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <CompanyCreateCard isPending={createCompany.isPending} onSubmit={(payload) => createCompany.mutate(payload)} />
          <CompanyList companies={companies} activeCompanyId={activeCompanyId} isLoading={companiesQuery.isLoading} onSelectCompany={onSelectCompany} />
        </aside>
        <section>
          {activeCompanyId ? (
            <CompanyWorkbench
              key={activeCompanyId}
              companyId={activeCompanyId}
              recommendations={recommendationsQuery.data?.data || []}
            />
          ) : (
            <EmptyState />
          )}
        </section>
      </div>
    </div>
  );
}

function HeroHeader() {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        <Badge className="mb-3 bg-slate-900 text-white">Beta 開放中</Badge>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">小黑幫你調廣告</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          不是重做 KPI calculator，而是用既有 Plan 與 Meta 實際數據，產生今天該觀察、補素材、止損或加碼的操作清單。
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/fbaudit">
          <ExternalLink className="mr-2 h-4 w-4" />
          舊版健檢
        </Link>
      </Button>
    </div>
  );
}

function CompanyCreateCard({ isPending, onSubmit }: { isPending: boolean; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [brandName, setBrandName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [industry, setIndustry] = useState("");
  const [description, setDescription] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" />
          建立公司
        </CardTitle>
        <CardDescription>先建 decision context，再跑巡帳。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>品牌名稱</Label>
          <Input value={brandName} onChange={(event) => setBrandName(event.target.value)} placeholder="例如：報數據" />
        </div>
        <div>
          <Label>網站</Label>
          <Input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://example.com" />
        </div>
        <div>
          <Label>產業</Label>
          <Input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="例如：電商、顧問、課程" />
        </div>
        <div>
          <Label>備註</Label>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </div>
        <Button
          className="w-full"
          disabled={isPending || !brandName.trim()}
          onClick={() => onSubmit({
            brandName: brandName.trim(),
            websiteUrl: websiteUrl.trim() || undefined,
            industry: industry.trim() || undefined,
            description: description.trim() || undefined,
            businessModel: "ecommerce",
            primaryMarket: "TW",
            currency: "TWD",
            language: "zh-TW",
            isActive: true,
          })}
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          建立
        </Button>
      </CardContent>
    </Card>
  );
}

function CompanyList({
  companies,
  activeCompanyId,
  isLoading,
  onSelectCompany,
}: {
  companies: Company[];
  activeCompanyId?: string;
  isLoading: boolean;
  onSelectCompany: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">公司清單</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <LoadingBlock label="載入公司" />}
        {!isLoading && companies.length === 0 && <p className="text-sm text-slate-500">尚未建立公司。</p>}
        {companies.map((company) => (
          <button
            key={company.id}
            className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
              company.id === activeCompanyId ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
            onClick={() => onSelectCompany(company.id)}
          >
            <div className="font-medium">{company.brandName}</div>
            <div className={company.id === activeCompanyId ? "text-slate-300" : "text-slate-500"}>{company.industry || company.businessModel}</div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function CompanyWorkbench({ companyId, recommendations }: { companyId: string; recommendations: Recommendation[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const contextQuery = useQuery<ApiResponse<CompanyContext>>({
    queryKey: [`/api/v2/companies/${companyId}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  const plansQuery = useQuery<ApiResponse<Plan[]>>({
    queryKey: ["/api/v2/plans"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  const metaAccountsQuery = useQuery<ApiResponse<MetaAccount[]>>({
    queryKey: ["/api/v2/meta/accounts"],
    queryFn: getQueryFn({ on401: "throw" }),
    retry: false,
  });

  const company = contextQuery.data?.data.company;
  const adAccounts = contextQuery.data?.data.adAccounts || [];
  const plans = plansQuery.data?.data || [];
  const [planResultId, setPlanResultId] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [manualAdAccountName, setManualAdAccountName] = useState("");

  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === planResultId), [plans, planResultId]);
  const selectedAdAccount = useMemo(() => adAccounts.find((account) => account.adAccountId === adAccountId), [adAccounts, adAccountId]);

  const upsertFinancialProfile = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/v2/companies/${companyId}/financial-profile`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/v2/companies/${companyId}`] });
      toast({ title: "財務基準已更新" });
    },
    onError: (error) => toast({ title: "財務基準更新失敗", description: String(error), variant: "destructive" }),
  });

  const linkAdAccount = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("POST", `/api/v2/companies/${companyId}/ad-accounts`, payload);
      return res.json() as Promise<ApiResponse<CompanyAdAccount>>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [`/api/v2/companies/${companyId}`] });
      setAdAccountId(result.data.adAccountId);
      toast({ title: "Meta 廣告帳號已綁定" });
    },
    onError: (error) => toast({ title: "綁定失敗", description: String(error), variant: "destructive" }),
  });

  const runDecision = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/v2/ad-decision/run", {
        companyId,
        planResultId,
        adAccountId,
        locale: "zh-TW",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/v2/ad-decision/recommendations?companyId=${companyId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/v2/ad-decision/recommendations"] });
      toast({ title: "巡帳完成", description: "已產生今日調整建議。" });
    },
    onError: (error) => toast({ title: "巡帳失敗", description: String(error), variant: "destructive" }),
  });

  if (contextQuery.isLoading) return <LoadingBlock label="載入工作台" />;
  if (!company) return <EmptyState />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {company.brandName}
          </CardTitle>
          <CardDescription>{company.description || "尚未填寫公司決策背景。"}</CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <FinancialProfileCard
          profile={contextQuery.data?.data.financialProfile || null}
          isPending={upsertFinancialProfile.isPending}
          onSubmit={(payload) => upsertFinancialProfile.mutate(payload)}
        />
        <AdAccountCard
          linkedAccounts={adAccounts}
          metaAccounts={metaAccountsQuery.data?.data || []}
          metaError={metaAccountsQuery.error ? String(metaAccountsQuery.error) : undefined}
          selectedAdAccountId={adAccountId}
          manualName={manualAdAccountName}
          onManualNameChange={setManualAdAccountName}
          onSelect={setAdAccountId}
          isPending={linkAdAccount.isPending}
          onLink={(accountId, accountName) => linkAdAccount.mutate({
            platform: "meta",
            adAccountId: accountId,
            adAccountName: accountName || manualAdAccountName || accountId,
            isActive: true,
          })}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>跑今日巡帳</CardTitle>
          <CardDescription>選擇既有 Plan KPI 與已綁定的 Meta 廣告帳號。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div>
            <Label>Plan KPI</Label>
            <Select value={planResultId} onValueChange={setPlanResultId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇 Plan" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {plan.planName} · ROAS {plan.targetRoas} · {plan.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Meta 廣告帳號</Label>
            <Select value={adAccountId} onValueChange={setAdAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇已綁定帳號" />
              </SelectTrigger>
              <SelectContent>
                {adAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.adAccountId}>
                    {account.adAccountName || account.adAccountId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={!selectedPlan || !selectedAdAccount || runDecision.isPending} onClick={() => runDecision.mutate()}>
            {runDecision.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            跑巡帳
          </Button>
        </CardContent>
      </Card>

      <RecommendationList companyId={companyId} recommendations={recommendations} />
    </div>
  );
}

function FinancialProfileCard({
  profile,
  isPending,
  onSubmit,
}: {
  profile: Record<string, string | null> | null;
  isPending: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [averageOrderValue, setAverageOrderValue] = useState(profile?.averageOrderValue || "");
  const [targetRoas, setTargetRoas] = useState(profile?.targetRoas || "");
  const [targetCpa, setTargetCpa] = useState(profile?.targetCpa || "");
  const [notes, setNotes] = useState(profile?.notes || "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">企業財務基準</CardTitle>
        <CardDescription>這是 baseline，不取代 Plan KPI。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>平均客單價</Label>
          <Input value={averageOrderValue || ""} onChange={(event) => setAverageOrderValue(event.target.value)} placeholder="例如 2500" />
        </div>
        <div>
          <Label>目標 ROAS</Label>
          <Input value={targetRoas || ""} onChange={(event) => setTargetRoas(event.target.value)} placeholder="例如 3.5" />
        </div>
        <div>
          <Label>目標 CPA</Label>
          <Input value={targetCpa || ""} onChange={(event) => setTargetCpa(event.target.value)} placeholder="例如 800" />
        </div>
        <div className="sm:col-span-2">
          <Label>備註</Label>
          <Textarea value={notes || ""} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </div>
        <div className="sm:col-span-2">
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => onSubmit({
              averageOrderValue: averageOrderValue || undefined,
              targetRoas: targetRoas || undefined,
              targetCpa: targetCpa || undefined,
              notes: notes || undefined,
            })}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            儲存財務基準
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AdAccountCard({
  linkedAccounts,
  metaAccounts,
  metaError,
  selectedAdAccountId,
  manualName,
  onManualNameChange,
  onSelect,
  isPending,
  onLink,
}: {
  linkedAccounts: CompanyAdAccount[];
  metaAccounts: MetaAccount[];
  metaError?: string;
  selectedAdAccountId: string;
  manualName: string;
  onManualNameChange: (value: string) => void;
  onSelect: (value: string) => void;
  isPending: boolean;
  onLink: (accountId: string, accountName?: string) => void;
}) {
  const [metaAccountId, setMetaAccountId] = useState("");
  const selectedMetaAccount = metaAccounts.find((account) => account.id === metaAccountId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Meta 廣告帳號</CardTitle>
        <CardDescription>一家公司可綁多個帳號，MVP 先跑 account level。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>已綁定帳號</Label>
          <Select value={selectedAdAccountId} onValueChange={onSelect}>
            <SelectTrigger>
              <SelectValue placeholder="尚未選擇" />
            </SelectTrigger>
            <SelectContent>
              {linkedAccounts.map((account) => (
                <SelectItem key={account.id} value={account.adAccountId}>
                  {account.adAccountName || account.adAccountId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {metaAccounts.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Label>從 Meta 授權帳號綁定</Label>
              <Select value={metaAccountId} onValueChange={setMetaAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇 Meta 帳號" />
                </SelectTrigger>
                <SelectContent>
                  {metaAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!selectedMetaAccount || isPending} onClick={() => selectedMetaAccount && onLink(selectedMetaAccount.id, selectedMetaAccount.name)}>
              綁定
            </Button>
          </div>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {metaError ? "目前讀不到 Meta 授權帳號，可先手動填帳號 ID。" : "尚未取得 Meta 帳號列表。"}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <Label>手動帳號 ID</Label>
            <Input value={metaAccountId} onChange={(event) => setMetaAccountId(event.target.value)} placeholder="act_123 或 123" />
          </div>
          <div>
            <Label>帳號名稱</Label>
            <Input value={manualName} onChange={(event) => onManualNameChange(event.target.value)} placeholder="選填" />
          </div>
          <Button variant="outline" disabled={!metaAccountId || isPending} onClick={() => onLink(metaAccountId, manualName)}>
            手動綁定
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RecommendationList({ companyId, recommendations }: { companyId: string; recommendations: Recommendation[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" | "dismissed" }) => {
      const res = await apiRequest("PATCH", `/api/v2/ad-decision/recommendations/${id}/status`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/v2/ad-decision/recommendations?companyId=${companyId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/v2/ad-decision/recommendations"] });
      toast({ title: "狀態已更新" });
    },
    onError: (error) => toast({ title: "狀態更新失敗", description: String(error), variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recommendation history</CardTitle>
        <CardDescription>每次巡帳都會保存 metricsSnapshot、ruleSnapshot、contextSnapshot。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {recommendations.length === 0 && <p className="text-sm text-slate-500">尚未產生建議。</p>}
        {recommendations.map((recommendation) => (
          <div key={recommendation.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={recommendation.priority === "high" ? "destructive" : "secondary"}>{recommendation.priority}</Badge>
                  <Badge variant="outline">{statusLabel[recommendation.overallStatus] || recommendation.overallStatus}</Badge>
                  <Badge variant="outline">{actionLabel[recommendation.actionType] || recommendation.actionType}</Badge>
                  <Badge>{recommendation.approvalStatus}</Badge>
                </div>
                <h3 className="font-semibold text-slate-950">{recommendation.reasonSummary}</h3>
                {recommendation.detailedReason && <p className="text-sm text-slate-600">{recommendation.detailedReason}</p>}
                <p className="text-sm text-slate-900">{recommendation.recommendedAction}</p>
                {recommendation.riskNote && <p className="text-xs text-amber-700">{recommendation.riskNote}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" disabled={updateStatus.isPending || recommendation.approvalStatus !== "pending"} onClick={() => updateStatus.mutate({ id: recommendation.id, status: "approved" })}>
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                  確認
                </Button>
                <Button size="sm" variant="outline" disabled={updateStatus.isPending || recommendation.approvalStatus !== "pending"} onClick={() => updateStatus.mutate({ id: recommendation.id, status: "rejected" })}>
                  <XCircle className="mr-1 h-4 w-4" />
                  拒絕
                </Button>
                <Button size="sm" variant="ghost" disabled={updateStatus.isPending || recommendation.approvalStatus !== "pending"} onClick={() => updateStatus.mutate({ id: recommendation.id, status: "dismissed" })}>
                  忽略
                </Button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-4">
              <Metric label="Spend" value={recommendation.metricsSnapshot?.actual?.spend} />
              <Metric label="Daily spend" value={recommendation.metricsSnapshot?.actual?.dailySpend} />
              <Metric label="ROAS" value={recommendation.metricsSnapshot?.actual?.roas} />
              <Metric label="CTR" value={recommendation.metricsSnapshot?.actual?.ctr} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div>{label}</div>
      <div className="font-semibold text-slate-900">{value === null || value === undefined ? "-" : String(value)}</div>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex min-h-[360px] flex-col items-center justify-center text-center">
        <CircleDot className="mb-4 h-10 w-10 text-slate-400" />
        <h2 className="text-xl font-semibold text-slate-950">先建立一家公司</h2>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          小黑決策引擎需要知道品牌、財務基準與廣告帳號，才能把 Meta 數據轉成可執行建議。
        </p>
      </CardContent>
    </Card>
  );
}
