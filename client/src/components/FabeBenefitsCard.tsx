import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFabeAccess } from "@/hooks/useCrossPlatformBenefits";
import { 
  ExternalLink, 
  BookOpen, 
  CheckCircle, 
  Clock, 
  Gift,
  Users,
  Trophy
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface FabeBenefitsCardProps {
  locale?: string;
}

export function FabeBenefitsCard({ locale = 'zh-TW' }: FabeBenefitsCardProps) {
  const { user } = useAuth();
  const { hasFabeAccess, foundersPlan, purchases, isLoading } = useFabeAccess((user as any)?.id);
  
  // 開發模式下顯示調試資訊
  if (process.env.NODE_ENV === 'development') {
    console.log('FabeBenefitsCard debug:', {
      userId: (user as any)?.id,
      hasFabeAccess,
      foundersPlan,
      purchases,
      isLoading
    });
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            FABE 課程權限
          </CardTitle>
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

  const foundersData = purchases.find(p => p.planType === 'founders');

  return (
    <Card className="border-2 border-dashed border-green-200 bg-green-50/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-green-700">
          <BookOpen className="w-5 h-5" />
          FABE × SPIN 課程權限
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasFabeAccess ? (
          <>
            {/* 權限狀態 */}
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="font-medium text-green-700">已獲得完整課程權限</span>
              <Badge variant="secondary" className="bg-green-100 text-green-700">
                創始會員特權
              </Badge>
            </div>

            {/* 創始會員資訊 */}
            {foundersData && (
              <div className="bg-white rounded-lg p-4 border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="w-4 h-4 text-yellow-600" />
                  <span className="font-medium text-gray-900">Eccal 創始會員</span>
                  <Badge variant="outline" className="text-xs">
                    NT$ {foundersData.purchaseAmount.toLocaleString()}
                  </Badge>
                </div>
                <div className="text-sm text-gray-600 space-y-1">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    購買時間：{new Date(foundersData.createdAt).toLocaleDateString('zh-TW')}
                  </div>
                  <div className="flex items-center gap-2">
                    <Gift className="w-3 h-3" />
                    權限期限：終身有效
                  </div>
                </div>
              </div>
            )}

            {/* 課程訪問 */}
            <div className="border-t border-green-200 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-gray-900">FABE × SPIN 廣告操盤課程</h4>
                  <p className="text-sm text-gray-600">價值 NT$ 999 的專業課程</p>
                </div>
                <Button 
                  size="sm" 
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => window.open('https://fabe.thinkwithblack.com', '_blank')}
                >
                  前往學習
                  <ExternalLink className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>

            {/* 同步狀態 */}
            <div className="text-xs text-gray-500">
              同步狀態：
              {foundersPlan?.fabeAccessSynced ? (
                <span className="text-green-600 ml-1">✓ 已同步到 FABE 平台</span>
              ) : (
                <span className="text-yellow-600 ml-1">⚠ 正在同步中</span>
              )}
            </div>
          </>
        ) : (
          <>
            {/* 無權限狀態 */}
            <div className="text-center py-4">
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <h4 className="font-medium text-gray-900 mb-2">尚未獲得 FABE 課程權限</h4>
              <p className="text-sm text-gray-600 mb-4">
                購買 Eccal 創始會員（NT$ 5,990）即可獲得 FABE 課程完整權限
              </p>
              <Button variant="outline" size="sm">
                了解創始會員方案
              </Button>
            </div>
          </>
        )}

        {/* 跨平台說明 */}
        <div className="text-xs text-gray-500 border-t pt-3">
          <div className="flex items-center gap-1">
            <ExternalLink className="w-3 h-3" />
            跨平台整合：Eccal 創始會員自動獲得 FABE 課程權限
          </div>
        </div>
      </CardContent>
    </Card>
  );
}