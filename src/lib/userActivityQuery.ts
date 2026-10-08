/** One row per (user_id, app_type) from admin_user_activity_platforms(). */
export interface PlatformActivityRow {
  user_id: string;
  app_type: string;
  last_seen_at: string | null;
  browser_name: string | null;
  browser_version: string | null;
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
