import { describe, it, expect, vi, beforeEach } from "vitest";

const state: any = { patch: null, filters: [], result: { data: [{ id: "t1" }], error: null } };

function builder() {
  const api: any = {
    update: (patch: any) => {
      state.patch = patch;
      return api;
    },
    eq: (col: string, val: unknown) => {
      state.filters.push([col, val]);
      return api;
    },
    is: () => api,
    select: () => Promise.resolve(state.result),
  };
  return api;
}

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { from: () => builder() },
}));

import {
  updateTripDetails,
  validateTripEngineHours,
  describeTripDetailsError,
  TripDetailsConflictError,
} from "@/lib/tripsQuery";

beforeEach(() => {
  state.patch = null;
  state.filters = [];
  state.result = { data: [{ id: "t1" }], error: null };
});

describe("edit trip details", () => {
  it("writes only the supplied fields and bumps the sync version", async () => {
    await updateTripDetails({
      tripId: "t1",
      currentSyncVersion: 4,
      userId: "u1",
      edits: { machineId: "m1", tractorId: null, personName: "Sam", startEngineHours: 1200, endEngineHours: 1203.1 },
    });
    expect(state.patch.machine_id).toBe("m1");
    expect(state.patch.tractor_id).toBeNull();
    expect(state.patch.person_name).toBe("Sam");
    expect(state.patch.start_engine_hours).toBe(1200);
    expect(state.patch.end_engine_hours).toBe(1203.1);
    expect(state.patch.sync_version).toBe(5);
    // Never touches tracking data or frozen spray quantities.
    expect(Object.keys(state.patch)).not.toContain("path_points");
    expect(Object.keys(state.patch)).not.toContain("tank_sessions");
    expect(state.filters).toContainEqual(["sync_version", 4]);
  });

  it("omits fields the caller did not supply", async () => {
    await updateTripDetails({ tripId: "t1", edits: { personName: "Sam" } });
    expect(Object.keys(state.patch)).not.toContain("machine_id");
    expect(Object.keys(state.patch)).not.toContain("start_engine_hours");
  });

  it("reports a concurrent mobile sync instead of overwriting it", async () => {
    state.result = { data: [], error: null };
    await expect(
      updateTripDetails({ tripId: "t1", currentSyncVersion: 4, edits: { personName: "Sam" } }),
    ).rejects.toBeInstanceOf(TripDetailsConflictError);
  });

  it("validates engine hour readings", () => {
    expect(validateTripEngineHours(null, null)).toBeNull();
    expect(validateTripEngineHours(1200, 1203)).toBeNull();
    expect(validateTripEngineHours(1203, 1200)).toMatch(/lower than/i);
    expect(validateTripEngineHours(-1, null)).toMatch(/zero or greater/i);
  });

  it("explains a permission failure in plain English", () => {
    expect(describeTripDetailsError({ message: "new row violates row-level security policy" })).toMatch(
      /permission/i,
    );
  });
});
