import { useEffect, useRef, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const STATUS_PATH = "/api/gtm/browser/status";
const BEGIN_PATH = "/api/gtm/browser/begin";
const START_PATH = "/api/gtm/browser/start";
const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

type GtmStatus = Readonly<{
  status: "disconnected" | "active" | "reauthorization_required";
  connectionId: string;
  generation: number;
  csrfProof: string;
}>;

const copy = {
  "zh-TW": {
    title: "Google Tag Manager 唯讀連線",
    description: "連線後可讀取你授權的 GTM 帳戶與設定，不會修改或發布容器。",
    connected: "已連線",
    disconnected: "尚未連線",
    reauthorize: "需要重新授權",
    connect: "連結 GTM",
    retry: "重新載入",
    loading: "載入中…",
    unavailable: "GTM 連線目前無法使用，請稍後再試。",
    login: "請先登入 ECCAL，再連結 GTM。",
  },
  en: {
    title: "Google Tag Manager read access",
    description: "Read the GTM accounts and configuration you authorize. This does not change or publish containers.",
    connected: "Connected",
    disconnected: "Not connected",
    reauthorize: "Authorization required",
    connect: "Connect GTM",
    retry: "Reload",
    loading: "Loading…",
    unavailable: "The GTM connection is unavailable. Please try again later.",
    login: "Sign in to ECCAL before connecting GTM.",
  },
  ja: {
    title: "Google Tag Manager 読み取り接続",
    description: "許可した GTM アカウントと設定を読み取ります。コンテナの変更や公開は行いません。",
    connected: "接続済み",
    disconnected: "未接続",
    reauthorize: "再認証が必要",
    connect: "GTM を接続",
    retry: "再読み込み",
    loading: "読み込み中…",
    unavailable: "GTM 接続を利用できません。後でもう一度お試しください。",
    login: "GTM を接続する前に ECCAL にログインしてください。",
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseStatus(value: unknown): GtmStatus {
  if (!isRecord(value) ||
      (value.status !== "disconnected" &&
        value.status !== "active" &&
        value.status !== "reauthorization_required") ||
      typeof value.connectionId !== "string" ||
      value.connectionId.length === 0 ||
      typeof value.generation !== "number" ||
      !Number.isSafeInteger(value.generation) ||
      value.generation < 0 ||
      typeof value.csrfProof !== "string" ||
      value.csrfProof.length === 0) {
    throw new Error("GTM_INVALID_RESPONSE");
  }
  return {
    status: value.status,
    connectionId: value.connectionId,
    generation: value.generation,
    csrfProof: value.csrfProof,
  };
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error("GTM_INVALID_RESPONSE");
  }
}

async function status(): Promise<GtmStatus> {
  const response = await fetch(STATUS_PATH, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const payload = await json(response);
  if (!response.ok) {
    throw new Error(response.status === 401 ? "GTM_CALLER_REJECTED" : "GTM_UNAVAILABLE");
  }
  return parseStatus(payload);
}

async function post(path: string, body: Record<string, unknown>, csrfProof: string): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-gtm-csrf": csrfProof,
    },
    body: JSON.stringify(body),
  });
  const payload = await json(response);
  if (!response.ok) throw new Error("GTM_UNAVAILABLE");
  return payload;
}

function authorizationUrl(value: unknown): string {
  if (!isRecord(value) || typeof value.authorizationUrl !== "string") {
    throw new Error("GTM_INVALID_RESPONSE");
  }
  const url = new URL(value.authorizationUrl);
  if (`${url.origin}${url.pathname}` !== GOOGLE_AUTHORIZATION_ENDPOINT ||
      url.username !== "" || url.password !== "") {
    throw new Error("GTM_INVALID_RESPONSE");
  }
  return url.toString();
}

export function GtmConnectionSection({ locale = "zh-TW" }: { locale?: string }) {
  const t = copy[locale as keyof typeof copy] ?? copy["zh-TW"];
  const [connection, setConnection] = useState<GtmStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);

  const connect = async (current: GtmStatus, hasPendingIntent: boolean) => {
    setBusy(true);
    setError(null);
    try {
      let state = current;
      if (!hasPendingIntent) {
        const begun = await post(BEGIN_PATH, {}, current.csrfProof);
        if (!isRecord(begun) ||
            typeof begun.connectionId !== "string" ||
            typeof begun.generation !== "number") {
          throw new Error("GTM_INVALID_RESPONSE");
        }
        state = { ...current, connectionId: begun.connectionId, generation: begun.generation };
      }
      const started = await post(START_PATH, {
        connectionId: state.connectionId,
        generation: state.generation,
      }, current.csrfProof);
      window.location.assign(authorizationUrl(started));
    } catch {
      if (mounted.current) {
        setError(t.unavailable);
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    const url = new URL(window.location.href);
    const hasPendingIntent = url.searchParams.get("gtm_connect") === "1";
    if (hasPendingIntent) {
      url.searchParams.delete("gtm_connect");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    void status().then((current) => {
      if (!mounted.current) return;
      setConnection(current);
      setBusy(false);
      if (hasPendingIntent) void connect(current, true);
    }).catch((caught: unknown) => {
      if (!mounted.current) return;
      setError(caught instanceof Error && caught.message === "GTM_CALLER_REJECTED"
        ? t.login : t.unavailable);
      setBusy(false);
    });
    return () => { mounted.current = false; };
  }, []);

  const label = connection?.status === "active"
    ? t.connected
    : connection?.status === "reauthorization_required"
      ? t.reauthorize
      : t.disconnected;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          {t.title}
        </CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {busy ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t.loading}
          </div>
        ) : (
          <>
            {connection && <p className="text-sm">{label}</p>}
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            {connection ? (
              <Button onClick={() => void connect(connection, false)}>
                {t.connect}
              </Button>
            ) : (
              <Button onClick={() => window.location.reload()}>{t.retry}</Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
