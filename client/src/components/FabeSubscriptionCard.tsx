import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, BookOpen, Calendar, DollarSign } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface FabeSubscriptionData {
  has_fabe_subscription: boolean;
  subscription_details: {
    amount: number;
    currency: string;
    created_at: string;
    expires_at: string | null;
    fabe_subscription_id: string;
  } | null;
  total_fabe_subscriptions: number;
}

interface FabeSubscriptionCardProps {
  userId: string;
  userEmail: string;
}

export function FabeSubscriptionCard({ userId, userEmail }: FabeSubscriptionCardProps) {
  const { data: fabeData, isLoading } = useQuery<FabeSubscriptionData>({
    queryKey: ['/api/fabe-reverse/check-fabe-subscription', userId],
    enabled: !!userId
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Fabe 課程訂閱
          </CardTitle>
          <CardDescription>檢查 Fabe 平台訂閱狀態中...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasFabeSubscription = fabeData?.has_fabe_subscription || false;
  const subscriptionDetails = fabeData?.subscription_details;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Fabe 課程訂閱
          {hasFabeSubscription && (
            <Badge variant="secondary" className="bg-green-100 text-green-800">
              已訂閱
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          跨平台課程訂閱狀態 - 在 fabe.thinkwithblack.com 購買的訂閱
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasFabeSubscription && subscriptionDetails ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">訂閱金額</p>
                  <p className="text-xs text-muted-foreground">
                    {subscriptionDetails.amount} {subscriptionDetails.currency.toUpperCase()}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">訂閱日期</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(subscriptionDetails.created_at).toLocaleDateString('zh-TW')}
                  </p>
                </div>
              </div>
            </div>

            {subscriptionDetails.expires_at && (
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-sm font-medium text-blue-900">到期日期</p>
                <p className="text-xs text-blue-700">
                  {new Date(subscriptionDetails.expires_at).toLocaleDateString('zh-TW')}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t">
              <p className="text-sm text-muted-foreground">
                總計 {fabeData?.total_fabe_subscriptions} 次 Fabe 訂閱
              </p>
              <a
                href="https://fabe.thinkwithblack.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 transition-colors"
              >
                前往 Fabe 平台
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground mb-2">
              尚未訂閱 Fabe 課程
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              在 Fabe 平台購買年訂閱方案後，會自動同步到這裡顯示
            </p>
            <a
              href="https://fabe.thinkwithblack.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              前往 Fabe 平台
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}