import { useEffect, useRef, useState } from "react";
import { AlertCircle, Link2, Loader2, Search, Unlink } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const STATUS_PATH = "/api/gsc/browser/status";
const INTENT_PATH = "/api/gsc/browser/intent";
const START_PATH = "/api/gsc/browser/start";
const DISCONNECT_PATH = "/api/gsc/browser/disconnect";
const LOGIN_PATH = "/api/auth/google?returnTo=%2Fsettings";
const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_PERMISSION_MANAGEMENT_URL =
  "https://myaccount.google.com/linkedapps";

type ConnectionStatus =
  | "active"
  | "reauthorization_required"
  | "disconnected";

type ConnectionState = Readonly<{
  kind: "connection";
  status: ConnectionStatus;
  connectionId: string;
  generation: number;
  csrfProof: string;
  displayEmail?: string;
  notice?: string;
}>;

type PendingIntentState = Readonly<{
  kind: "pending_intent";
  csrfProof: string;
  startPath: typeof START_PATH;
}>;

type GscState = ConnectionState | PendingIntentState;
type GoogleRevocation = "confirmed" | "unconfirmed" | "not_applicable";

class BrowserRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BrowserRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return invalidResponse();
  }
  return value;
}

function requiredGeneration(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalidResponse();
  }
  return value;
}

function invalidResponse(): never {
  throw new BrowserRequestError(
    "GSC_INVALID_RESPONSE",
    "Google Search Console 目前無法使用，請稍後再試一次。",
  );
}

function parseBrowserError(value: unknown): BrowserRequestError {
  if (
    isRecord(value) &&
    value.success === false &&
    typeof value.error === "string" &&
    typeof value.message === "string" &&
    value.message.length > 0
  ) {
    return new BrowserRequestError(value.error, value.message);
  }
  return new BrowserRequestError(
    "GSC_UNAVAILABLE",
    "Google Search Console 目前無法使用，請稍後再試一次。",
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new BrowserRequestError(
      "GSC_INVALID_RESPONSE",
      "Google Search Console 目前無法使用，請稍後再試一次。",
    );
  }
}

async function getStatus(signal: AbortSignal): Promise<GscState> {
  const response = await fetch(STATUS_PATH, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = await readJson(response);
  if (!response.ok) throw parseBrowserError(payload);
  if (!isRecord(payload)) invalidResponse();

  if (payload.pendingIntent === true) {
    if (payload.startPath !== START_PATH) invalidResponse();
    return Object.freeze({
      kind: "pending_intent",
      startPath: START_PATH,
      csrfProof: requiredString(payload.csrfProof),
    });
  }

  const status = payload.status;
  if (
    status !== "active" &&
    status !== "reauthorization_required" &&
    status !== "disconnected"
  ) {
    invalidResponse();
  }
  const displayEmail = payload.displayEmail;
  if (
    (status === "active" &&
      (typeof displayEmail !== "string" || displayEmail.length === 0)) ||
    (displayEmail !== undefined && typeof displayEmail !== "string")
  ) {
    invalidResponse();
  }
  const notice = payload.notice;
  if (notice !== undefined && typeof notice !== "string") {
    invalidResponse();
  }
  return Object.freeze({
    kind: "connection",
    status,
    connectionId: requiredString(payload.connectionId),
    generation: requiredGeneration(payload.generation),
    csrfProof: requiredString(payload.csrfProof),
    ...(displayEmail === undefined ? {} : { displayEmail }),
    ...(notice === undefined ? {} : { notice }),
  });
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  csrfProof: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-gsc-csrf": csrfProof,
    },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await readJson(response);
  if (!response.ok) throw parseBrowserError(payload);
  return payload;
}

function authorizationUrl(value: unknown): string {
  const raw = requiredString(value);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    invalidResponse();
  }
  if (`${parsed.origin}${parsed.pathname}` !== GOOGLE_AUTHORIZATION_ENDPOINT) {
    invalidResponse();
  }
  return parsed.toString();
}

function displayError(error: unknown): string {
  return error instanceof BrowserRequestError
    ? error.message
    : "Google Search Console 目前無法使用，請稍後再試一次。";
}

function wasAborted(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function GscConnectionSection() {
  const [state, setState] = useState<GscState | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revocation, setRevocation] = useState<GoogleRevocation | null>(null);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const controllers = useRef(new Set<AbortController>());

  const beginOperation = () => {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    const controller = new AbortController();
    controllers.current.add(controller);
    const version = ++requestVersion.current;
    const current = () =>
      mounted.current &&
      requestVersion.current === version &&
      !controller.signal.aborted;
    return { controller, current };
  };

  const loadStatus = async () => {
    const operation = beginOperation();
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const nextState = await getStatus(operation.controller.signal);
      if (!operation.current()) return;
      setState(nextState);
      setMessage(nextState.kind === "connection" ? nextState.notice ?? null : null);
      setRevocation(null);
    } catch (caught) {
      if (!operation.current() || wasAborted(caught)) return;
      setState(null);
      setError(displayError(caught));
      setErrorCode(caught instanceof BrowserRequestError ? caught.code : null);
    } finally {
      controllers.current.delete(operation.controller);
      if (operation.current()) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    void loadStatus();
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
      controllers.current.forEach((controller) => controller.abort());
      controllers.current.clear();
    };
  }, []);

  const connect = async () => {
    if (!state) return;
    const operation = beginOperation();
    setAction("connect");
    setError(null);
    setErrorCode(null);
    setMessage(null);
    setRevocation(null);
    try {
      let startPath: typeof START_PATH = START_PATH;
      if (state.kind !== "pending_intent") {
        const intent = await postJson(
          INTENT_PATH,
          { csrfProof: state.csrfProof },
          state.csrfProof,
          operation.controller.signal,
        );
        if (!isRecord(intent) || intent.startPath !== START_PATH) {
          invalidResponse();
        }
        startPath = START_PATH;
      }
      const started = await postJson(
        startPath,
        { csrfProof: state.csrfProof },
        state.csrfProof,
        operation.controller.signal,
      );
      if (!isRecord(started)) invalidResponse();
      const destination = authorizationUrl(started.authorizationUrl);
      if (!operation.current()) return;
      window.location.assign(destination);
    } catch (caught) {
      if (!operation.current() || wasAborted(caught)) return;
      setError(displayError(caught));
      setErrorCode(caught instanceof BrowserRequestError ? caught.code : null);
    } finally {
      controllers.current.delete(operation.controller);
      if (operation.current()) setAction(null);
    }
  };

  const disconnect = async () => {
    if (!state || state.kind !== "connection" || state.status === "disconnected") {
      return;
    }
    const operation = beginOperation();
    setAction("disconnect");
    setError(null);
    setErrorCode(null);
    setMessage(null);
    setRevocation(null);
    try {
      const result = await postJson(
        DISCONNECT_PATH,
        {
          confirmed: true,
          connectionId: state.connectionId,
          generation: state.generation,
          csrfProof: state.csrfProof,
        },
        state.csrfProof,
        operation.controller.signal,
      );
      if (!isRecord(result)) invalidResponse();
      const resultGeneration = requiredGeneration(result.generation);
      if (
        result.status !== "disconnected" ||
        result.localDisconnected !== true ||
        result.connectionId !== state.connectionId ||
        resultGeneration !== state.generation + 1 ||
        (result.googleRevocation !== "confirmed" &&
          result.googleRevocation !== "unconfirmed" &&
          result.googleRevocation !== "not_applicable")
      ) invalidResponse();
      const resultMessage = requiredString(result.message);
      const resultRevocation = result.googleRevocation;
      if (!operation.current()) return;
      setState(Object.freeze({
        kind: "connection",
        status: "disconnected",
        connectionId: state.connectionId,
        generation: resultGeneration,
        csrfProof: state.csrfProof,
      }));
      setMessage(resultMessage);
      setRevocation(resultRevocation);
      setShowDisconnectDialog(false);
    } catch (caught) {
      if (!operation.current() || wasAborted(caught)) return;
      setError(displayError(caught));
      setErrorCode(caught instanceof BrowserRequestError ? caught.code : null);
    } finally {
      controllers.current.delete(operation.controller);
      if (operation.current()) setAction(null);
    }
  };

  const statusLabel =
    state?.kind === "connection" && state.status === "active"
      ? "已連接"
      : state?.kind === "connection" && state.status === "reauthorization_required"
        ? "需要重新授權"
        : state?.kind === "pending_intent"
          ? "等待繼續連線"
          : "尚未連接";
  const canConnect =
    state?.kind === "pending_intent" ||
    (state?.kind === "connection" && state.status !== "active");
  const canDisconnect =
    state?.kind === "connection" && state.status !== "disconnected";

  return (
    <Card data-testid="gsc-connection-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Google Search Console
        </CardTitle>
        <CardDescription>
          連接你自己的 Google Search Console 帳號，查看你有權限的網站資料。
          每位會員一次只能連接一個 Google 帳號。需要資料時才會即時讀取，
          ThinkWithBlack 不會儲存搜尋成效。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="gsc-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            正在讀取 Google Search Console 連線狀態…
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive" data-testid="gsc-error">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Google Search Console 連線失敗</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {state && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div
                    className={`h-2 w-2 rounded-full ${
                      state.kind === "connection" && state.status === "active"
                        ? "bg-green-500"
                        : state.kind === "connection" &&
                            state.status === "reauthorization_required"
                          ? "bg-amber-500"
                          : "bg-gray-400"
                    }`}
                  />
                  <span
                    className="font-medium text-gray-700 dark:text-gray-300"
                    data-testid="gsc-status"
                  >
                    {statusLabel}
                  </span>
                </div>

                {state.kind === "pending_intent" && (
                  <p
                    className="text-sm text-amber-700 dark:text-amber-400"
                    data-testid="gsc-pending-intent"
                  >
                    這個連線已由 ThinkWithBlack 對話發起。請使用目前登入的會員帳號繼續。
                  </p>
                )}

                {state.kind === "connection" && state.status === "active" && (
                  <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      已連接的 Google 帳號
                    </p>
                    <p
                      className="mt-1 break-all font-medium text-gray-900 dark:text-white"
                      data-testid="gsc-connected-email"
                    >
                      {state.displayEmail}
                    </p>
                  </div>
                )}
              </div>
            )}

            {message && (
              <Alert data-testid="gsc-message">
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}

            {revocation === "unconfirmed" && (
              <a
                href={GOOGLE_PERMISSION_MANAGEMENT_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex text-sm font-medium text-blue-700 underline underline-offset-4 dark:text-blue-400"
                data-testid="gsc-google-permissions-link"
              >
                到 Google 帳號的權限管理頁檢查
              </a>
            )}

            <div className="flex flex-wrap gap-3">
              {canConnect && (
                <Button
                  onClick={() => void connect()}
                  disabled={action !== null}
                  data-testid="button-connect-gsc"
                >
                  {action === "connect" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Link2 className="mr-2 h-4 w-4" />
                  )}
                  連接 Google Search Console
                </Button>
              )}

              {canDisconnect && (
                <Button
                  variant="destructive"
                  onClick={() => setShowDisconnectDialog(true)}
                  disabled={action !== null}
                  data-testid="button-disconnect-gsc"
                >
                  <Unlink className="mr-2 h-4 w-4" />
                  解除連線
                </Button>
              )}

              {!state && errorCode === "GSC_BROWSER_UNAUTHENTICATED" && (
                <Button asChild>
                  <a href={LOGIN_PATH} data-testid="button-gsc-login">
                    前往登入
                  </a>
                </Button>
              )}

              {!state && errorCode !== "GSC_BROWSER_UNAUTHENTICATED" && (
                <Button
                  variant="outline"
                  onClick={() => void loadStatus()}
                  data-testid="button-retry-gsc"
                >
                  重新讀取
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定要解除連線嗎？</AlertDialogTitle>
            <AlertDialogDescription>
              這會先解除 ThinkWithBlack 的本地連線，再嘗試撤銷 Google 授權。
              兩者的結果會分開顯示。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={action === "disconnect"}
              data-testid="button-cancel-gsc-disconnect"
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={action === "disconnect"}
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault();
                void disconnect();
              }}
              data-testid="button-confirm-gsc-disconnect"
            >
              {action === "disconnect" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              確認解除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
