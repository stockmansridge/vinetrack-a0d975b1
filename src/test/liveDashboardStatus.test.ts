import { describe, it, expect } from "vitest";
import {
  tripStatusOf,
  buildLiveDashboardSummary,
  type LiveTripStatus,
} from "@/lib/liveDashboardStatus";
import type { Trip } from "@/lib/tripsQuery";

const baseTrip = (over: Partial<Trip> = {}): Trip => ({
  id: over.id ?? "00000000-0000-0000-0000-000000000000",
  vineyard_id: "00000000-0000-0000-0000-000000000001",
  person_name: over.person_name ?? "Operator",
  ...over,
});

describe("tripStatusOf lifecycle mapping", () => {
  it("active when is_active=true and not paused", () => {
    expect(tripStatusOf(baseTrip({ is_active: true, is_paused: false, end_time: null }))).toBe("active");
  });

  it("paused when is_active=true and is_paused=true", () => {
    expect(tripStatusOf(baseTrip({ is_active: true, is_paused: true, end_time: null }))).toBe("paused");
  });

  it("does not treat inactive/no-end-time trips as active", () => {
    expect(tripStatusOf(baseTrip({ is_active: false, is_paused: false, end_time: null }))).toBe("older");
    expect(tripStatusOf(baseTrip({ is_active: false, is_paused: true, end_time: null }))).toBe("older");
    expect(tripStatusOf(baseTrip({ is_active: undefined, is_paused: false, end_time: null }))).toBe("older");
  });

  it("finished when ended within the last 24 hours", () => {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    expect(tripStatusOf(baseTrip({ is_active: false, is_paused: false, end_time: oneHourAgo }))).toBe("finished");
    // Active flag being true with an end_time still resolves to finished because it has ended.
    expect(tripStatusOf(baseTrip({ is_active: true, is_paused: false, end_time: oneHourAgo }))).toBe("finished");
  });

  it("older when ended more than 24 hours ago", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    expect(tripStatusOf(baseTrip({ is_active: false, is_paused: false, end_time: twoDaysAgo }))).toBe("older");
  });
});

describe("buildLiveDashboardSummary counts", () => {
  it("counts two is_active=true trips as Active", () => {
    const trips = [
      baseTrip({ id: "a1", is_active: true, is_paused: false, end_time: null, person_name: "Sam" }),
      baseTrip({ id: "a2", is_active: true, is_paused: false, end_time: null, person_name: "Alex" }),
    ];
    expect(buildLiveDashboardSummary(trips)).toEqual({
      active: 2,
      paused: 0,
      finished: 0,
      operators: 2,
    });
  });

  it("counts a paused active trip as Paused", () => {
    const trips = [
      baseTrip({ id: "a1", is_active: true, is_paused: false, end_time: null, person_name: "Sam" }),
      baseTrip({ id: "p1", is_active: true, is_paused: true, end_time: null, person_name: "Jordan" }),
    ];
    expect(buildLiveDashboardSummary(trips)).toEqual({
      active: 1,
      paused: 1,
      finished: 0,
      operators: 2,
    });
  });

  it("excludes inactive/no-end-time saved trips from active counts", () => {
    const trips = [
      baseTrip({ id: "a1", is_active: true, is_paused: false, end_time: null, person_name: "Sam" }),
      baseTrip({ id: "saved", is_active: false, is_paused: false, end_time: null, person_name: "Unused" }),
    ];
    expect(buildLiveDashboardSummary(trips)).toEqual({
      active: 1,
      paused: 0,
      finished: 0,
      operators: 1,
    });
  });

  it("keeps the other active trip unchanged when one active trip ends", () => {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const trips = [
      baseTrip({ id: "still-active", is_active: true, is_paused: false, end_time: null, person_name: "Sam" }),
      baseTrip({ id: "just-finished", is_active: false, is_paused: false, end_time: oneHourAgo, person_name: "Alex" }),
    ];
    expect(buildLiveDashboardSummary(trips)).toEqual({
      active: 1,
      paused: 0,
      finished: 1,
      operators: 2,
    });
  });

  it("deduplicates operator names and excludes older-only operators", () => {
    const trips = [
      baseTrip({ id: "a1", is_active: true, is_paused: false, end_time: null, person_name: "Sam" }),
      baseTrip({ id: "a2", is_active: true, is_paused: false, end_time: null, person_name: "Sam" }),
      baseTrip({ id: "saved", is_active: false, is_paused: false, end_time: null, person_name: "Unused" }),
    ];
    expect(buildLiveDashboardSummary(trips)).toEqual({
      active: 2,
      paused: 0,
      finished: 0,
      operators: 1,
    });
  });
});

describe("status independence across trips", () => {
  it("assigns active status to every is_active=true trip independently", () => {
    const statuses: Record<string, LiveTripStatus> = {};
    const trips = [
      baseTrip({ id: "a1", is_active: true, is_paused: false, end_time: null }),
      baseTrip({ id: "a2", is_active: true, is_paused: false, end_time: null }),
      baseTrip({ id: "saved", is_active: false, is_paused: false, end_time: null }),
    ];
    for (const t of trips) statuses[t.id] = tripStatusOf(t);
    expect(statuses["a1"]).toBe("active");
    expect(statuses["a2"]).toBe("active");
    expect(statuses["saved"]).toBe("older");
  });
});
