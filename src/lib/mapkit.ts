import { supabase as cloudSupabase } from "@/integrations/supabase/client";

export type MapKitReadinessState =
  | "not_started"
  | "token_loading"
  | "token_failed"
  | "script_loading"
  | "script_failed"
  | "initialising"
  | "ready"
  | "render_failed";

export type MapKitInitEvent =
  | { type: "state"; state: MapKitReadinessState; error?: string | null }
  | { type: "script"; status: "loading" | "loaded" | "failed" | "already_available" | "existing"; count?: number; globalAvailable?: boolean; error?: string | null }
  | { type: "token"; status: "loading" | "success" | "failed"; endpointStatus?: number | null; shape?: string[]; tokenFieldName?: string | null; tokenLength?: number; expiresAt?: number | null; errorBody?: string | null; error?: string | null }
  | { type: "auth_callback"; status: "invoked" | "resolved" | "failed"; error?: string | null };

export type MapKitInitObserver = (event: MapKitInitEvent) => void;

const emit = (observer: MapKitInitObserver | undefined, event: MapKitInitEvent) => {
  try { observer?.(event); } catch { /* diagnostics only */ }
};

// Loads Apple MapKit JS once and resolves when `mapkit` is available.
let loadPromise: Promise<typeof window & { mapkit: any }> | null = null;

export function loadMapKitScript(observer?: MapKitInitObserver): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const scriptCount = () => document.querySelectorAll('script[data-mapkit="1"], script[src*="apple-mapkit.com/mk/"]').length;
  if ((window as any).mapkit) {
    emit(observer, { type: "script", status: "already_available", count: scriptCount(), globalAvailable: true });
    return Promise.resolve((window as any).mapkit);
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    emit(observer, { type: "state", state: "script_loading" });
    emit(observer, { type: "script", status: "loading", count: scriptCount(), globalAvailable: !!(window as any).mapkit });
    const existing = document.querySelector('script[data-mapkit="1"]') as HTMLScriptElement | null;
    const onReady = () => {
      if ((window as any).mapkit) {
        emit(observer, { type: "script", status: "loaded", count: scriptCount(), globalAvailable: true });
        resolve((window as any).mapkit);
      } else {
        const error = "mapkit script loaded but global missing";
        emit(observer, { type: "state", state: "script_failed", error });
        emit(observer, { type: "script", status: "failed", count: scriptCount(), globalAvailable: false, error });
        reject(new Error(error));
      }
    };
    if (existing) {
      emit(observer, { type: "script", status: "existing", count: scriptCount(), globalAvailable: !!(window as any).mapkit });
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", () => {
        const error = "mapkit script failed";
        emit(observer, { type: "state", state: "script_failed", error });
        emit(observer, { type: "script", status: "failed", count: scriptCount(), globalAvailable: false, error });
        reject(new Error(error));
      }, { once: true });
      // If the script tag already completed before this listener was attached,
      // check the global shortly after; do not fail immediately while it is
      // still loading.
      setTimeout(() => { if ((window as any).mapkit) onReady(); }, 0);
      setTimeout(() => { if ((window as any).mapkit) onReady(); }, 5000);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.dataset.mapkit = "1";
    s.addEventListener("load", onReady, { once: true });
    s.addEventListener("error", () => {
      const error = "mapkit script failed";
      emit(observer, { type: "state", state: "script_failed", error });
      emit(observer, { type: "script", status: "failed", count: scriptCount(), globalAvailable: false, error });
      reject(new Error(error));
    }, { once: true });
    document.head.appendChild(s);
  });
  return loadPromise;
}

interface TokenResponse {
  token: string;
  expiresAt: number;
}

let cached: TokenResponse | null = null;

export async function fetchMapKitToken(observer?: MapKitInitObserver): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  emit(observer, { type: "state", state: "token_loading" });
  emit(observer, { type: "token", status: "loading" });

  const base = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
  const anon = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

  if (base && anon) {
    try {
      const res = await fetch(`${base}/functions/v1/get-mapkit-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anon,
          Authorization: `Bearer ${anon}`,
        },
        body: "{}",
      });
      const text = await res.text();
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* non-json error body */ }
      const shape = parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
      const token = typeof parsed?.token === "string" ? parsed.token : null;
      const expiresAt = typeof parsed?.expiresAt === "number" ? parsed.expiresAt : null;
      if (!res.ok || !token) {
        const errorBody = text.slice(0, 500);
        emit(observer, {
          type: "token",
          status: "failed",
          endpointStatus: res.status,
          shape,
          tokenFieldName: token ? "token" : null,
          expiresAt,
          errorBody,
          error: !res.ok ? `HTTP ${res.status}` : "token field missing",
        });
        emit(observer, { type: "state", state: "token_failed", error: !res.ok ? `HTTP ${res.status}` : "token field missing" });
        throw new Error(!res.ok ? `mapkit token endpoint failed (${res.status})` : "mapkit token unavailable");
      }
      emit(observer, {
        type: "token",
        status: "success",
        endpointStatus: res.status,
        shape,
        tokenFieldName: "token",
        tokenLength: token.length,
        expiresAt,
      });
      cached = { token, expiresAt: expiresAt ?? Date.now() + 25 * 60_000 };
      return token;
    } catch (e: any) {
      if (e?.message?.startsWith?.("mapkit token")) throw e;
      emit(observer, { type: "token", status: "failed", endpointStatus: null, error: String(e?.message ?? e) });
      emit(observer, { type: "state", state: "token_failed", error: String(e?.message ?? e) });
      throw e;
    }
  }

  const { data, error } = await cloudSupabase.functions.invoke<TokenResponse>("get-mapkit-token", { body: {} });
  if (error || !data?.token) {
    const message = error?.message || "mapkit token unavailable";
    emit(observer, { type: "token", status: "failed", endpointStatus: null, error: message });
    emit(observer, { type: "state", state: "token_failed", error: message });
    throw new Error(message);
  }
  emit(observer, { type: "token", status: "success", endpointStatus: null, shape: Object.keys(data), tokenFieldName: "token", tokenLength: data.token.length, expiresAt: data.expiresAt });
  cached = data;
  return data.token;
}

let initPromise: Promise<any> | null = null;

/** Returns initialised mapkit global, or throws if unavailable. */
export function initMapKit(observer?: MapKitInitObserver): Promise<any> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const mapkit = await loadMapKitScript(observer);
    emit(observer, { type: "state", state: "initialising" });
    await new Promise<void>((resolve, reject) => {
      try {
        mapkit.init({
          authorizationCallback: (done: (token: string) => void) => {
            emit(observer, { type: "auth_callback", status: "invoked" });
            fetchMapKitToken(observer)
              .then((token) => {
                done(token);
                emit(observer, { type: "auth_callback", status: "resolved" });
              })
              .catch((e) => {
                emit(observer, { type: "auth_callback", status: "failed", error: String(e?.message ?? e) });
                reject(e);
              });
          },
        });
        // Give init a tick to attach
        setTimeout(resolve, 0);
      } catch (e) {
        reject(e);
      }
    });
    // Force a token fetch up-front so we can fail fast if not configured.
    await fetchMapKitToken(observer);
    emit(observer, { type: "state", state: "ready" });
    return mapkit;
  })().catch((e) => {
    initPromise = null;
    throw e;
  });
  return initPromise;
}
