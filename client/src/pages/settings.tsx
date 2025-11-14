import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Link2, Unlink } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface SettingsProps {
  locale?: string;
}

interface GAConnection {
  userId: string;
  googleEmail: string;
  connectedAt: string;
}

const translations = {
  'zh-TW': {
    title: '帳號設定',
    subtitle: '管理您的帳號設定和整合',
    gaTitle: 'Google Analytics 帳號',
    gaDescription: '連結獨立的 GA4 帳號以存取不同的 Analytics 資料',
    connected: '已連結',
    notConnected: '未連結',
    connectButton: '連結 GA4 帳號',
    disconnectButton: '斷開連結',
    connectedEmail: '連結的帳號：',
    connectedAt: '連結時間：',
    disconnectTitle: '確認斷開連結',
    disconnectDescription: '您確定要斷開與 Google Analytics 帳號的連結嗎？斷開後將無法存取該帳號的 GA4 資料。',
    cancel: '取消',
    confirm: '確認',
    disconnectSuccess: 'Google Analytics 帳號已成功斷開',
    disconnectError: '斷開連結失敗',
    loading: '載入中...',
  },
  'en': {
    title: 'Account Settings',
    subtitle: 'Manage your account settings and integrations',
    gaTitle: 'Google Analytics Account',
    gaDescription: 'Link a separate GA4 account to access different Analytics data',
    connected: 'Connected',
    notConnected: 'Not Connected',
    connectButton: 'Link GA4 Account',
    disconnectButton: 'Disconnect',
    connectedEmail: 'Connected account:',
    connectedAt: 'Connected at:',
    disconnectTitle: 'Confirm Disconnect',
    disconnectDescription: 'Are you sure you want to disconnect your Google Analytics account? You will lose access to that account\'s GA4 data.',
    cancel: 'Cancel',
    confirm: 'Confirm',
    disconnectSuccess: 'Google Analytics account disconnected successfully',
    disconnectError: 'Failed to disconnect',
    loading: 'Loading...',
  },
  'ja': {
    title: 'アカウント設定',
    subtitle: 'アカウント設定と統合を管理',
    gaTitle: 'Google Analytics アカウント',
    gaDescription: '別の GA4 アカウントをリンクして、異なる Analytics データにアクセス',
    connected: '接続済み',
    notConnected: '未接続',
    connectButton: 'GA4 アカウントをリンク',
    disconnectButton: '接続解除',
    connectedEmail: '接続されたアカウント：',
    connectedAt: '接続日時：',
    disconnectTitle: '接続解除の確認',
    disconnectDescription: 'Google Analytics アカウントの接続を解除してもよろしいですか？解除すると、そのアカウントの GA4 データにアクセスできなくなります。',
    cancel: 'キャンセル',
    confirm: '確認',
    disconnectSuccess: 'Google Analytics アカウントが正常に切断されました',
    disconnectError: '接続解除に失敗しました',
    loading: '読み込み中...',
  },
};

export default function Settings({ locale = 'zh-TW' }: SettingsProps) {
  const t = translations[locale as keyof typeof translations] || translations['zh-TW'];
  const { toast } = useToast();
  const { user } = useAuth();
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  // Fetch GA connection status
  const { data: gaConnection, isLoading, refetch } = useQuery<GAConnection | null>({
    queryKey: ['/api/analytics/ga-connection'],
    enabled: !!user,
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/analytics/disconnect-ga', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to disconnect');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t.disconnectSuccess,
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/analytics/ga-connection'] });
      setShowDisconnectDialog(false);
    },
    onError: (error: Error) => {
      toast({
        title: t.disconnectError,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleConnectGA = () => {
    // Redirect to GA OAuth flow
    window.location.href = '/api/auth/google-analytics';
  };

  const handleDisconnect = () => {
    setShowDisconnectDialog(true);
  };

  const confirmDisconnect = () => {
    disconnectMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">{t.loading}</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            {t.title}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {t.subtitle}
          </p>
        </div>

        <div className="space-y-6">
          {/* Google Analytics Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                {t.gaTitle}
              </CardTitle>
              <CardDescription>
                {t.gaDescription}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {gaConnection ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-green-500"></div>
                      <span className="font-medium text-green-700 dark:text-green-400">
                        {t.connected}
                      </span>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
                      <div className="text-sm">
                        <span className="text-gray-600 dark:text-gray-400">{t.connectedEmail}</span>
                        <span className="ml-2 font-medium text-gray-900 dark:text-white">
                          {gaConnection.googleEmail}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-gray-600 dark:text-gray-400">{t.connectedAt}</span>
                        <span className="ml-2 font-medium text-gray-900 dark:text-white">
                          {new Date(gaConnection.connectedAt).toLocaleString(locale)}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      onClick={handleDisconnect}
                      disabled={disconnectMutation.isPending}
                      data-testid="button-disconnect-ga"
                    >
                      {disconnectMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t.loading}
                        </>
                      ) : (
                        <>
                          <Unlink className="mr-2 h-4 w-4" />
                          {t.disconnectButton}
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-gray-400"></div>
                      <span className="font-medium text-gray-600 dark:text-gray-400">
                        {t.notConnected}
                      </span>
                    </div>
                    <Button
                      onClick={handleConnectGA}
                      data-testid="button-connect-ga"
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      {t.connectButton}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.disconnectTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.disconnectDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-disconnect">
              {t.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDisconnect}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-disconnect"
            >
              {t.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
