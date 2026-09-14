import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type EmailPreference = {
  status: "pending" | "subscribed" | "unsubscribed";
  providerSync: "not_required" | "pending" | "synced" | "failed";
};

type EmailPreferenceResponse = {
  success: true;
  preference: EmailPreference;
  providerSync?: EmailPreference["providerSync"];
};

const translations = {
  "zh-TW": {
    title: "接收 ECCAL 教學與產品更新",
    description:
      "我們偶爾會寄送功能更新、實作教學與課程消息。你可以隨時在帳號設定取消，不影響服務及課程權限。",
    accept: "願意接收",
    decline: "暫時不要",
    saved: "郵件偏好已儲存",
    pendingSync: "你的選擇已儲存，郵件服務會稍後同步。",
    error: "無法儲存郵件偏好",
  },
  en: {
    title: "Receive ECCAL lessons and product updates",
    description:
      "We occasionally send product updates, practical lessons, and course news. You can unsubscribe in Account Settings at any time without affecting your service or course access.",
    accept: "Yes, keep me updated",
    decline: "Not now",
    saved: "Email preference saved",
    pendingSync: "Your choice was saved. The email service will sync later.",
    error: "Unable to save email preference",
  },
  ja: {
    title: "ECCALの実践情報と製品アップデートを受け取る",
    description:
      "機能アップデート、実践的な学習情報、講座のお知らせを時々お送りします。サービスや講座の利用権限に影響することなく、アカウント設定からいつでも解除できます。",
    accept: "受け取る",
    decline: "今は受け取らない",
    saved: "メール設定を保存しました",
    pendingSync: "選択内容を保存しました。メールサービスは後ほど同期されます。",
    error: "メール設定を保存できませんでした",
  },
} as const;

function currentLocale(pathname: string): keyof typeof translations {
  if (pathname.startsWith("/en")) return "en";
  if (pathname.startsWith("/jp")) return "ja";
  return "zh-TW";
}

export default function MarketingEmailConsentPrompt() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();
  const t = translations[currentLocale(location)];
  const { data } = useQuery<EmailPreferenceResponse | null>({
    queryKey: ["/api/email-preferences"],
    enabled: isAuthenticated,
  });

  const mutation = useMutation({
    mutationFn: async (subscribed: boolean) => {
      const response = await apiRequest("PUT", "/api/email-preferences", {
        subscribed,
        source: "first_login_prompt",
      });
      return (await response.json()) as EmailPreferenceResponse;
    },
    onSuccess: (response) => {
      queryClient.setQueryData(["/api/email-preferences"], response);
      toast({
        title: t.saved,
        description:
          response.providerSync === "failed" || response.providerSync === "pending"
            ? t.pendingSync
            : undefined,
      });
    },
    onError: () => {
      toast({ title: t.error, variant: "destructive" });
    },
  });

  if (!isAuthenticated || data?.preference.status !== "pending") return null;

  return (
    <Card className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-md border-blue-200 shadow-xl">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Mail className="h-5 w-5 text-blue-600" />
          {t.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-6 text-muted-foreground">{t.description}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(false)}
          >
            {t.decline}
          </Button>
          <Button
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(true)}
          >
            {t.accept}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
