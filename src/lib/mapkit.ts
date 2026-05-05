// Loads Apple MapKit JS once and resolves when `mapkit` is available.
let loadPromise: Promise<typeof window & { mapkit: any }> | null = null;

export function loadMapKitScript(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if ((window as any).mapkit) return Promise.resolve((window as any).mapkit);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mapkit="1"]') as HTMLScriptElement | null;
    const onReady = () => {
      if ((window as any).mapkit) resolve((window as any).mapkit);
      else reject(new Error("mapkit script loaded but global missing"));
    };
    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", () => reject(new Error("mapkit script failed")), {
        once: true,
      });
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.dataset.mapkit = "1";
    s.addEventListener("load", onReady, { once: true });
    s.addEventListener("error", () => reject(new Error("mapkit script failed")), { once: true });
    document.head.appendChild(s);
  });
  return loadPromise;
}

import { supabase as cloudSupabase } from "@/integrations/supabase/client";

interface TokenResponse {
  token: string;
  expiresAt: number;
}

let cached: TokenResponse | null = null;

export async function fetchMapKitToken(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  const { data, error } = await cloudSupabase.functions.invoke<TokenResponse>(
    "get-mapkit-token",
    { body: {} },
  );
  if (error || !data?.token) {
    throw new Error(error?.message || "mapkit token unavailable");
  }
  cached = data;
  return data.token;
}

let initPromise: Promise<any> | null = null;

/** Returns initialised mapkit global, or throws if unavailable. */
export function initMapKit(): Promise<any> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const mapkit = await loadMapKitScript();
    await new Promise<void>((resolve, reject) => {
      try {
        mapkit.init({
          authorizationCallback: (done: (token: string) => void) => {
            fetchMapKitToken().then(done).catch((e) => reject(e));
          },
        });
        // Give init a tick to attach
        setTimeout(resolve, 0);
      } catch (e) {
        reject(e);
      }
    });
    // Force a token fetch up-front so we can fail fast if not configured.
    await fetchMapKitToken();
    return mapkit;
  })().catch((e) => {
    initPromise = null;
    throw e;
  });
  return initPromise;
}
