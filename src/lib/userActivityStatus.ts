// Canonical "last activity" for the System Admin User Activity page.
// Inactivity means no meaningful VineTrack use on Portal OR mobile, so it uses
// the newest of: last sign-in, latest client heartbeat, and every per-platform
// last_seen_at. The RPC's own `status` field is not trusted for inactivity.

export interface ActivityTimestamps {
  last_sign_in_at: string | null;
  last_client_seen_at: string | null;
  platforms?: { last_seen_at: string | null }[];
}

export type ActivityStatus = "never" | "active_7d" | "active_30d" | "inactive_30d" | "inactive_90d";

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  never: "Never active",
  active_7d: "Active 7d",
  active_30d: "Active 30d",
  inactive_30d: "No activity 30d+",
  inactive_90d: "No activity 90d+",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Newest non-null activity timestamp as epoch ms, or null when none exist. */
export function lastActivityMs(r: ActivityTimestamps): number | null {
  const all = [r.last_sign_in_at, r.last_client_seen_at, ...(r.platforms ?? []).map((p) => p.last_seen_at)]
    .map(ms)
    .filter((t): t is number => t !== null);
  return all.length ? Math.max(...all) : null;
}

export function lastActivityIso(r: ActivityTimestamps): string | null {
  const t = lastActivityMs(r);
  return t === null ? null : new Date(t).toISOString();
}

/** Days are elapsed 24h periods; exactly N days ago still counts as within N days. */
export function activityStatus(r: ActivityTimestamps, now = Date.now()): ActivityStatus {
  const t = lastActivityMs(r);
  if (t === null) return "never";
  const age = now - t;
  if (age <= 7 * DAY_MS) return "active_7d";
  if (age <= 30 * DAY_MS) return "active_30d";
  if (age <= 90 * DAY_MS) return "inactive_30d";
  return "inactive_90d";
}

export function isActiveWithin(r: ActivityTimestamps, days: number, now = Date.now()): boolean {
  const t = lastActivityMs(r);
  return t !== null && now - t <= days * DAY_MS;
}

export function hasNoActivityFor(r: ActivityTimestamps, days: number, now = Date.now()): boolean {
  const t = lastActivityMs(r);
  return t !== null && now - t > days * DAY_MS;
}
