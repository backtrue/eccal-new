import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown, BarChart3, Monitor, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { getTranslations, type Locale } from "@/lib/i18n";
import GoogleLoginButton from "@/components/GoogleLoginButton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface UserDropdownProps {
  locale: Locale;
}

export default function UserDropdown({ locale }: UserDropdownProps) {
  const { isAuthenticated, user } = useAuth();
  const t = getTranslations(locale);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = () => {
    setIsLoggingOut(true);
    
    // Clear all cached queries first
    queryClient.clear();
    
    toast({
      title: "登出中...",
      description: "正在切換帳號",
    });
    
    // Redirect directly to the Google OAuth logout endpoint
    setTimeout(() => {
      window.location.href = "/api/auth/logout";
    }, 500);
  };

  if (!isAuthenticated) {
    return <GoogleLoginButton locale={locale} />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2 h-8 px-2">
          <Avatar className="h-6 w-6">
            <AvatarImage src={user?.avatar} alt={user?.firstName || ""} />
            <AvatarFallback className="text-xs">
              {user?.firstName?.charAt(0) || "U"}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium">{user?.firstName}</span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href="/dashboard" className="flex items-center gap-2 w-full">
            <Monitor className="h-4 w-4" />
            {locale === 'zh-TW' ? '儀表板' : locale === 'en' ? 'Dashboard' : 'ダッシュボード'}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} disabled={isLoggingOut} className="flex items-center gap-2 text-red-600">
          <LogOut className={`h-4 w-4 ${isLoggingOut ? 'animate-spin' : ''}`} />
          {isLoggingOut ? (
            locale === 'zh-TW' ? '登出中...' : locale === 'en' ? 'Logging out...' : 'ログアウト中...'
          ) : (
            locale === 'zh-TW' ? '切換帳號' : locale === 'en' ? 'Switch Account' : 'アカウント切替'
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}