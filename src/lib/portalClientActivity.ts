// Portal client-activity telemetry. Calls the shared, existing
// record_my_client_activity RPC (server uses auth.uid(); per-client row keyed
// by user + client_instance_id). Portal identity is exactly ('portal-web','web').
// Telemetry is best effort: failures never block sign-in or the UI.

export const PORTAL_APP_TYPE = "portal-web";
export const PORTAL_PLATFORM = "web";
export const CLIENT_INSTANCE_KEY = "vt_portal_client_instance_id";
export const HEARTBEAT_MS = 15 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Reuse a valid stored UUID for this browser install, else create and store one. */
export function getOrCreateClientInstanceId(
  storage: StorageLike | null | undefined,
  gen: () => string = () => crypto.randomUUID(),
): string {
  try {
    const existing = storage?.getItem(CLIENT_INSTANCE_KEY);
    if (existing && UUID_RE.test(existing)) return existing.toLowerCase();
  } catch {
    /* storage blocked */
  }
  const id = gen();
  try {
    storage?.setItem(CLIENT_INSTANCE_KEY, id);
  } catch {
    /* storage blocked: id is per-page-load only */
  }
  return id;
}

export interface UaInfo {
  browser_name: string | null;
  browser_version: string | null;
  os_name: string | null;
  os_version: string | null;
  device_family: string | null;
}

function m(ua: string, re: RegExp): string | null {
  const r = ua.match(re);
  return r ? r[1] : null;
}

/** Conservative UA parsing; unknown values stay null rather than guessed. */
export function parseUserAgent(ua: string | null | undefined): UaInfo {
  const s = ua ?? "";
  let browser_name: string | null = null;
  let browser_version: string | null = null;
  const browsers: [string, RegExp][] = [
    ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ["Opera", /OPR\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  for (const [name, re] of browsers) {
    const v = m(s, re);
    if (v) {
      browser_name = name;
      browser_version = v;
      break;
    }
  }

  let os_name: string | null = null;
  let os_version: string | null = null;
  let device_family: string | null = null;
  if (/iPad/.test(s)) {
    os_name = "iPadOS";
    os_version = m(s, /OS (\d+[_\d]*)/)?.replace(/_/g, ".") ?? null;
    device_family = "tablet";
  } else if (/iPhone|iPod/.test(s)) {
    os_name = "iOS";
    os_version = m(s, /OS (\d+[_\d]*)/)?.replace(/_/g, ".") ?? null;
    device_family = "phone";
  } else if (/Android/.test(s)) {
    os_name = "Android";
    os_version = m(s, /Android ([\d.]+)/);
    device_family = /Mobile/.test(s) ? "phone" : "tablet";
  } else if (/Windows NT/.test(s)) {
    os_name = "Windows";
    os_version = m(s, /Windows NT ([\d.]+)/);
    device_family = "desktop";
  } else if (/Mac OS X/.test(s)) {
    os_name = "macOS";
    os_version = m(s, /Mac OS X (\d+[_.\d]*)/)?.replace(/_/g, ".") ?? null;
    device_family = "desktop";
  } else if (/CrOS/.test(s)) {
    os_name = "ChromeOS";
    device_family = "desktop";
  } else if (/Linux/.test(s)) {
    os_name = "Linux";
    device_family = "desktop";
  }
  return { browser_name, browser_version, os_name, os_version, device_family };
}

export function buildActivityPayload(
  clientInstanceId: string,
  ua: string | null | undefined,
  vineyardId: string | null | undefined,
) {
  const info = parseUserAgent(ua);
  return {
    p_client_instance_id: clientInstanceId,
    p_app_type: PORTAL_APP_TYPE,
    p_platform: PORTAL_PLATFORM,
    p_device_family: info.device_family,
    // Browsers do not expose a real device model; never invent one.
    p_device_model: null,
    p_os_name: info.os_name,
    p_os_version: info.os_version,
    // No real Portal release version exists yet; leave unset rather than fake.
    p_app_version: null,
    p_app_build: null,
    p_browser_name: info.browser_name,
    p_browser_version: info.browser_version,
    p_vineyard_id: vineyardId ?? null,
  };
}

/** Human label for an app_type value returned by the activity RPC. */
export function appTypeLabel(t: string | null | undefined): string {
  if (!t) return "Not recorded";
  if (t === PORTAL_APP_TYPE) return "Portal (web)";
  if (t === "ios") return "iOS";
  if (t === "android") return "Android";
  return t;
}
