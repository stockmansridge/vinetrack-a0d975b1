import { describe, expect, it } from "vitest";
import {
  groupPlatformsByUser,
  platformDetailsCsvField,
  platformDetailsLine,
  platformStackValue,
  type PlatformActivityRow,
} from "@/lib/userActivityQuery";
import { activityStatus, lastActivityMs } from "@/lib/userActivityStatus";

function row(partial: Partial<PlatformActivityRow>): PlatformActivityRow {
  return {
    user_id: "u1",
    app_type: "android",
    last_seen_at: "2026-10-23T08:00:00Z",
    ...partial,
  };
}

describe("platformDetailsLine", () => {
  it("Android: model, OS and app version/build", () => {
    const line = platformDetailsLine(
      row({
        device_model: "SM-G990E",
        os_name: "Android",
        os_version: "16",
        app_version: "3.1.8",
        app_build: "1792728910",
      }),
    );
    expect(line).toBe("SM-G990E · Android 16 · v3.1.8 (1792728910)");
  });

  it("iOS: model, OS and app version/build", () => {
    const line = platformDetailsLine(
      row({
        app_type: "ios",
        device_model: "iPhone 15 Pro",
        os_name: "iOS",
        os_version: "26.0",
        app_version: "3.1.8",
        app_build: "174",
      }),
    );
    expect(line).toBe("iPhone 15 Pro · iOS 26.0 · v3.1.8 (174)");
  });

  it("Portal: OS and browser major version", () => {
    const line = platformDetailsLine(
      row({
        app_type: "portal-web",
        os_name: "Windows",
        os_version: "10",
        browser_name: "Firefox",
        browser_version: "147.0.2",
      }),
    );
    expect(line).toBe("Windows 10 · Firefox 147");
  });

  it("omits missing pieces instead of placeholder text", () => {
    expect(
      platformDetailsLine(row({ device_model: null, os_name: "Android", os_version: null })),
    ).toBe("Android");
    expect(platformDetailsLine(row({}))).toBe("");
    expect(
      platformDetailsLine(row({ app_version: null, app_build: "174" })),
    ).toBe("build 174");
  });
});

describe("platformDetailsCsvField", () => {
  it("writes one labelled segment per platform", () => {
    const field = platformDetailsCsvField([
      row({
        app_type: "android",
        device_model: "SM-G990E",
        os_name: "Android",
        os_version: "16",
        app_version: "3.1.8",
        app_build: "1792728910",
      }),
      row({
        app_type: "portal-web",
        last_seen_at: "2026-10-22T09:00:00Z",
        browser_name: "Firefox",
        browser_version: "147.0.2",
      }),
    ]);
    expect(field).toBe(
      "Android: SM-G990E | Android 16 | 3.1.8 (1792728910) | 2026-10-23T08:00:00Z; " +
        "Portal (web): Firefox 147 | 2026-10-22T09:00:00Z",
    );
  });

  it("is empty when no platforms are recorded", () => {
    expect(platformDetailsCsvField([])).toBe("");
    expect(platformDetailsCsvField(undefined)).toBe("");
  });
});

describe("grouping and activity status with detail rows", () => {
  it("keeps per-platform rows sorted newest first", () => {
    const m = groupPlatformsByUser([
      row({ app_type: "portal-web", last_seen_at: "2026-10-01T00:00:00Z" }),
      row({ app_type: "ios", last_seen_at: "2026-10-08T05:00:00Z" }),
      row({ app_type: "android", last_seen_at: "2026-10-07T00:00:00Z" }),
    ]);
    expect(m.get("u1")!.map((p) => p.app_type)).toEqual(["ios", "android", "portal-web"]);
  });

  it("activity status still uses the latest platform last_seen timestamp", () => {
    const NOW = Date.parse("2026-10-23T12:00:00Z");
    const r = {
      last_sign_in_at: "2026-04-01T00:00:00Z",
      last_client_seen_at: null,
      platforms: [
        row({ app_type: "android", last_seen_at: "2026-10-21T12:00:00Z" }),
        row({ app_type: "ios", last_seen_at: "2026-09-01T00:00:00Z" }),
      ],
    };
    expect(lastActivityMs(r)).toBe(Date.parse("2026-10-21T12:00:00Z"));
    expect(activityStatus(r, NOW)).toBe("active_7d");
  });
});

describe("aligned platform stacks across columns", () => {
  // One shared newest-first list drives Platforms, Clients, App version,
  // Device and OS, so every column renders one value per platform in the
  // same order.
  const platforms = [
    row({
      app_type: "portal-web",
      last_seen_at: "2026-10-23T11:58:00Z",
      os_name: "Windows",
      os_version: "10",
      browser_name: "Firefox",
      browser_version: "158.0.1",
    }),
    row({
      app_type: "android",
      last_seen_at: "2026-10-23T11:00:00Z",
      device_model: "OnePlus8Pro",
      os_name: "Android",
      os_version: "11",
      app_version: "3.1.8",
      app_build: "1792745443",
    }),
    row({
      app_type: "ios",
      last_seen_at: "2026-10-23T10:00:00Z",
      device_model: "iPhone19,7",
      os_name: "iOS",
      os_version: "27.0.1",
      app_version: "3.1.8",
      app_build: "177",
    }),
  ];

  it("every column has one aligned value per platform in the same order", () => {
    const ordered = groupPlatformsByUser(platforms).get("u1")!;
    expect(ordered.map((p) => p.app_type)).toEqual(["portal-web", "android", "ios"]);
    expect(ordered.map((p) => platformStackValue(p, "appVersion"))).toEqual([
      "—",
      "3.1.8 (1792745443)",
      "3.1.8 (177)",
    ]);
    expect(ordered.map((p) => platformStackValue(p, "device"))).toEqual([
      "Firefox 158",
      "OnePlus8Pro",
      "iPhone19,7",
    ]);
    expect(ordered.map((p) => platformStackValue(p, "os"))).toEqual([
      "Windows 10 · Firefox 158",
      "Android 11",
      "iOS 27.0.1",
    ]);
  });

  it("Portal without app version shows an em dash but keeps OS + browser", () => {
    const portal = platforms[0];
    expect(platformStackValue(portal, "appVersion")).toBe("—");
    expect(platformStackValue(portal, "os")).toBe("Windows 10 · Firefox 158");
  });

  it("missing model/OS degrade to an em dash without dropping the row", () => {
    const bare = row({ app_type: "android" });
    expect(platformStackValue(bare, "device")).toBe("—");
    expect(platformStackValue(bare, "os")).toBe("—");
    expect(platformStackValue(bare, "appVersion")).toBe("—");
  });

  it("old login + recent Android use yields a recent canonical activity time", () => {
    const NOW = Date.parse("2026-10-23T12:00:00Z");
    const r = {
      last_sign_in_at: "2026-01-15T00:00:00Z",
      last_client_seen_at: null,
      platforms: [row({ app_type: "android", last_seen_at: "2026-10-23T11:00:00Z" })],
    };
    // Status line uses this timestamp, so it reads ~1h ago, not ~9 months.
    expect(lastActivityMs(r)).toBe(Date.parse("2026-10-23T11:00:00Z"));
    expect(activityStatus(r, NOW)).toBe("active_7d");
  });

  it("never-active users have no canonical activity timestamp", () => {
    const r = { last_sign_in_at: null, last_client_seen_at: null, platforms: [] };
    expect(lastActivityMs(r)).toBeNull();
    expect(activityStatus(r, Date.parse("2026-10-23T12:00:00Z"))).toBe("never");
  });
});
