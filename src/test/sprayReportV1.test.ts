import { describe, it, expect, vi } from "vitest";
import fixture from "../../docs/fixtures/spray-report-v1-stockmans-ridge.json";
import {
  parseSprayReportPayload,
  sprayReportFilename,
  sanitizeFilenameComponent,
  tripStartDateInVineyardTz,
  isSprayingTrip,
  SPRAY_RECORD_UNAVAILABLE_MESSAGE,
} from "@/lib/sprayReportV1";
import { routeHashForPoints, routeObjectPath } from "@/lib/sprayReportRoute";
import { formatDistance, formatActiveDuration } from "@/lib/sprayReportPdf";
import { AU_FORMATTERS } from "@/lib/regionFormatters";

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: vi.fn(), storage: { from: vi.fn() }, from: vi.fn() },
}));

describe("Spray Report v1 — canonical fixture", () => {
  it("accepts the Stockmans Ridge fixture", () => {
    const { payload, errors } = parseSprayReportPayload(fixture);
    expect(errors).toEqual([]);
    expect(payload).not.toBeNull();
    expect(payload!.identity.vineyardName).toBe("Stockmans Ridge");
    expect(payload!.rows).toHaveLength(2);
    expect(payload!.schemaVersion).toBe("1.1");
    // No actual has been recorded on this fixture yet.
    expect(payload!.tanks[0].chemicals[0].matchSource).toBe("notRecorded");
    expect(payload!.tanks[0].chemicals[0].usageKind).toBe("planned");
    expect(payload!.tankSessions?.[0].tankSessionId).toBe("tank-session-1");
    expect(payload!.route).toBeNull();
  });

  it("orders hourly weather by sampleSlot", () => {
    const raw = JSON.parse(JSON.stringify(fixture));
    raw.weather = [
      { ...raw.weather[0], sampleSlot: "2026-09-03T23:00:00Z" },
      { ...raw.weather[0], sampleSlot: "2026-09-03T21:00:00Z" },
    ];
    const { payload } = parseSprayReportPayload(raw);
    expect(payload!.weather.map((w) => w.sampleSlot)).toEqual([
      "2026-09-03T21:00:00Z",
      "2026-09-03T23:00:00Z",
    ]);
  });

  it("rejects an unknown row status rather than repairing it", () => {
    const raw = JSON.parse(JSON.stringify(fixture));
    raw.rows[0].status = "Done";
    const { payload, errors } = parseSprayReportPayload(raw);
    expect(payload).toBeNull();
    expect(errors.join()).toContain("rows[0].status");
  });

  it("rejects a foreign route style version", () => {
    const raw = JSON.parse(JSON.stringify(fixture));
    raw.route = {
      bucket: "trip-report-assets",
      objectPath: "a/b.png",
      sha256: "a".repeat(64),
      routeHash: "abc",
      styleVersion: "some-other-style",
    };
    const { payload, errors } = parseSprayReportPayload(raw);
    expect(payload).toBeNull();
    expect(errors.join()).toContain("route.styleVersion");
  });

  it("rejects a schema version other than 1.1", () => {
    expect(parseSprayReportPayload({ ...fixture, schemaVersion: "2.0" }).payload).toBeNull();
    expect(parseSprayReportPayload({ ...fixture, schemaVersion: "1.0" }).payload).toBeNull();
  });
});

describe("classification and filenames", () => {
  it("treats a linked legacy spray record as a spraying trip", () => {
    expect(isSprayingTrip({ tripFunction: "mowing", hasLinkedSprayRecord: true })).toBe(true);
    expect(isSprayingTrip({ tripFunction: "spraying" })).toBe(true);
    expect(isSprayingTrip({ tripFunction: "mowing" })).toBe(false);
  });

  it("sanitizes components to letters, numbers, underscores and hyphens", () => {
    expect(sanitizeFilenameComponent("  Stockmans Ridge / Café ", "X")).toBe(
      "Stockmans_Ridge_Cafe",
    );
    expect(sanitizeFilenameComponent("***", "Vineyard")).toBe("Vineyard");
  });

  it("uses the trip start date in the vineyard timezone", () => {
    // 21:00 UTC on 3 Sep is 07:00 on 4 Sep in Sydney.
    expect(tripStartDateInVineyardTz("2026-09-03T21:00:00Z", "Australia/Sydney")).toBe(
      "2026-09-04",
    );
  });

  it("builds the portal filename from the payload", () => {
    const { payload } = parseSprayReportPayload(fixture);
    expect(sprayReportFilename(payload!)).toBe(
      "SprayReport_Stockmans_Ridge_2026-09-04_Late_Woolly_Bud_E-L_Stage_2-3_a1b2c3d4-portal.pdf",
    );
  });

  it("exposes the blocked-export message", () => {
    expect(SPRAY_RECORD_UNAVAILABLE_MESSAGE).toBe(
      "Spray record not available yet—sync and retry",
    );
  });
});

describe("rendering helpers", () => {
  it("renders distances below one kilometre", () => {
    expect(formatDistance(420, AU_FORMATTERS)).toMatch(/0\.42/);
    expect(formatDistance(12439.15, AU_FORMATTERS)).toMatch(/12\.44/);
    expect(formatDistance(null, AU_FORMATTERS)).toBe("Not recorded");
  });

  it("renders active duration from seconds", () => {
    expect(formatActiveDuration(10860)).toBe("3 h 1 min");
    expect(formatActiveDuration(null)).toBe("Not recorded");
  });

  it("derives a deterministic route hash and object path", () => {
    const pts = [
      { lat: -33.1, lng: 149.1 },
      { lat: -33.2, lng: 149.2 },
    ];
    const a = routeHashForPoints(pts);
    expect(a).toBe(routeHashForPoints(pts));
    expect(a).not.toBe(routeHashForPoints([...pts].reverse()));
    const { payload } = parseSprayReportPayload(fixture);
    expect(routeObjectPath(payload!, a)).toBe(
      `${payload!.identity.tripId}/spray-route-red-green-v1-${a}.png`,
    );
  });
});
