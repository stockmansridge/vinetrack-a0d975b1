import { describe, expect, it } from "vitest";
import {
  activityStatus,
  hasNoActivityFor,
  isActiveWithin,
  lastActivityIso,
  matchesActivityFilter,
} from "@/lib/userActivityStatus";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const OLD_LOGIN = ago(200);

const user = (seen: Record<string, number>, login: string | null = OLD_LOGIN, client: string | null = null) => ({
  last_sign_in_at: login,
  last_client_seen_at: client,
  platforms: Object.entries(seen).map(([app_type, d]) => ({ app_type, last_seen_at: ago(d) })),
});

describe("canonical user activity", () => {
  it("old login + recent Android use is active", () => {
    const r = user({ android: 2 });
    expect(activityStatus(r, NOW)).toBe("active_7d");
    expect(matchesActivityFilter(r, "inactive30", NOW)).toBe(false);
    expect(matchesActivityFilter(r, "inactive90", NOW)).toBe(false);
  });
  it("old login + recent iOS use is active", () => {
    const r = user({ ios: 10 });
    expect(activityStatus(r, NOW)).toBe("active_30d");
    expect(matchesActivityFilter(r, "inactive30", NOW)).toBe(false);
  });
  it("old login + recent Portal use is active", () => {
    expect(activityStatus(user({ "portal-web": 1 }), NOW)).toBe("active_7d");
  });
  it("uses last_client_seen_at when platform history is unavailable", () => {
    const r = { last_sign_in_at: OLD_LOGIN, last_client_seen_at: ago(3) };
    expect(activityStatus(r, NOW)).toBe("active_7d");
  });
  it("all timestamps null is never active", () => {
    const r = { last_sign_in_at: null, last_client_seen_at: null, platforms: [] };
    expect(activityStatus(r, NOW)).toBe("never");
    expect(lastActivityIso(r)).toBeNull();
    expect(matchesActivityFilter(r, "never", NOW)).toBe(true);
    expect(matchesActivityFilter(r, "inactive90", NOW)).toBe(false);
  });
  it("exact 7/30/90-day boundaries", () => {
    const at = (d: number) => ({ last_sign_in_at: ago(d), last_client_seen_at: null });
    expect(activityStatus(at(7), NOW)).toBe("active_7d");
    expect(activityStatus(at(7.001), NOW)).toBe("active_30d");
    expect(activityStatus(at(30), NOW)).toBe("active_30d");
    expect(activityStatus(at(30.001), NOW)).toBe("inactive_30d");
    expect(activityStatus(at(90), NOW)).toBe("inactive_30d");
    expect(activityStatus(at(90.001), NOW)).toBe("inactive_90d");
    expect(hasNoActivityFor(at(30), 30, NOW)).toBe(false);
    expect(isActiveWithin(at(30), 30, NOW)).toBe(true);
  });
  it("filters/cards use canonical activity, not last login", () => {
    const rows = [user({ android: 1 }), user({ ios: 40 }), user({}, ago(100))];
    expect(rows.filter((r) => matchesActivityFilter(r, "7d", NOW))).toHaveLength(1);
    expect(rows.filter((r) => matchesActivityFilter(r, "inactive30", NOW))).toHaveLength(2);
    expect(rows.filter((r) => hasNoActivityFor(r, 90, NOW))).toHaveLength(1);
  });
});
