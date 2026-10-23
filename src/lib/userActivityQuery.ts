import { appTypeLabel } from "@/lib/portalClientActivity";

/**
 * One row per (user_id, app_type) from admin_user_activity_platform_details().
 * The detail fields beyond app_type/last_seen_at are nullable: older clients
 * and the legacy admin_user_activity_platforms() shape only provide those two.
 */
export interface PlatformActivityRow {
  user_id: string;
  app_type: string;
  last_seen_at: string | null;
  platform?: string | null;
  device_family?: string | null;
  device_model?: string | null;
  os_name?: string | null;
  os_version?: string | null;
  app_version?: string | null;
  app_build?: string | null;
  browser_name?: string | null;
  browser_version?: string | null;
}

/** Group platform history by user, newest first within each user. */
export function groupPlatformsByUser(
  rows: PlatformActivityRow[] | null | undefined,
): Map<string, PlatformActivityRow[]> {
  const map = new Map<string, PlatformActivityRow[]>();
  for (const r of rows ?? []) {
    if (!r?.user_id || !r.app_type) continue;
    const list = map.get(r.user_id) ?? [];
    list.push(r);
    map.set(r.user_id, list);
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        (b.last_seen_at ? Date.parse(b.last_seen_at) : 0) -
        (a.last_seen_at ? Date.parse(a.last_seen_at) : 0),
    );
  }
  return map;
}

/** True when the user has ANY recorded client of this app type ("all" matches everyone). */
export function userUsedAppType(
  platforms: PlatformActivityRow[] | undefined,
  appType: string,
): boolean {
  if (!appType || appType === "all") return true;
  return (platforms ?? []).some((p) => p.app_type === appType);
}

function browserLabel(p: PlatformActivityRow): string | null {
  if (!p.browser_name) return null;
  const major = p.browser_version ? p.browser_version.split(".")[0] : null;
  return major ? `${p.browser_name} ${major}` : p.browser_name;
}

/**
 * Compact one-line detail for a platform row, omitting anything not recorded:
 * "SM-G990E · Android 16 · v3.1.8 (1792728910)" or "Windows · Firefox 147".
 * Returns "" when only app_type/last_seen_at are known.
 */
export function platformDetailsLine(p: PlatformActivityRow): string {
  const parts: string[] = [];
  if (p.device_model) parts.push(p.device_model);
  const os = [p.os_name, p.os_version].filter(Boolean).join(" ");
  if (os) parts.push(os);
  if (p.app_version) {
    parts.push(`v${p.app_version}${p.app_build ? ` (${p.app_build})` : ""}`);
  } else if (p.app_build) {
    parts.push(`build ${p.app_build}`);
  }
  const browser = browserLabel(p);
  if (browser) parts.push(browser);
  return parts.join(" · ");
}

/**
 * CSV field summarising every platform a user has used, one segment per
 * platform: "Android: SM-G990E | Android 16 | 3.1.8 (1792728910) | 2026-10-23T08:00:00Z; iOS: ...".
 */
export function platformDetailsCsvField(
  rows: PlatformActivityRow[] | undefined,
): string {
  if (!rows || rows.length === 0) return "";
  return rows
    .map((p) => {
      const parts: string[] = [];
      if (p.device_model) parts.push(p.device_model);
      const os = [p.os_name, p.os_version].filter(Boolean).join(" ");
      if (os) parts.push(os);
      if (p.app_version) {
        parts.push(p.app_build ? `${p.app_version} (${p.app_build})` : p.app_version);
      } else if (p.app_build) {
        parts.push(`build ${p.app_build}`);
      }
      const browser = browserLabel(p);
      if (browser) parts.push(browser);
      if (p.last_seen_at) parts.push(p.last_seen_at);
      return `${appTypeLabel(p.app_type)}: ${parts.join(" | ")}`;
    })
    .join("; ");
}
