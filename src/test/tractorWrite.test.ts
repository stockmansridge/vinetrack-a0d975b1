import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  archiveTractor,
  saveTractor,
  TRACTOR_RPC_MALFORMED,
  TRACTOR_RPC_UNAVAILABLE,
  TRACTOR_ARCHIVE_RPC_UNAVAILABLE,
} from "@/lib/tractorWrite";
import {
  formatFuelUsage,
  fuelUsageFieldValue,
  validateTractorFuelUsage,
  FUEL_NOT_SET_LABEL,
} from "@/lib/tractorFuel";

const input = {
  id: null,
  vineyard_id: "v1",
  name: "Kubota",
  brand: null,
  model: null,
  model_year: null,
  fuel_usage_l_per_hour: 6.8,
  serial_number: null,
  vin_number: null,
  user_id: "u1",
};

beforeEach(() => rpc.mockReset());

describe("SQL 209 RPC return handling", () => {
  it("extracts the first row of the array response", async () => {
    rpc.mockResolvedValue({
      data: [{ tractor_id: "t-1", machine_id: "m-1", name: "Kubota" }],
      error: null,
    });
    await expect(saveTractor(input)).resolves.toEqual({
      tractor_id: "t-1",
      machine_id: "m-1",
    });
  });

  it("still accepts a single-object response shape", async () => {
    rpc.mockResolvedValue({ data: { tractor_id: "t-2", machine_id: "m-2" }, error: null });
    const res = await saveTractor(input);
    expect(res.machine_id).toBe("m-2");
  });

  it("rejects a malformed success response (missing machine_id)", async () => {
    rpc.mockResolvedValue({ data: [{ tractor_id: "t-3" }], error: null });
    await expect(saveTractor(input)).rejects.toThrow(TRACTOR_RPC_MALFORMED);
  });

  it("rejects an empty array response", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(saveTractor(input)).rejects.toThrow(TRACTOR_RPC_MALFORMED);
  });

  it("fails clearly when the RPC is not deployed — no direct-table fallback", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    await expect(saveTractor(input)).rejects.toThrow(TRACTOR_RPC_UNAVAILABLE);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("archives through the RPC and tolerates a table-row response", async () => {
    rpc.mockResolvedValue({ data: [{ tractor_id: "t-1", archived: true }], error: null });
    await expect(archiveTractor("t-1")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("portal_archive_tractor", { p_tractor_id: "t-1" });
  });

  it("fails archive when the RPC is missing", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "schema cache" } });
    await expect(archiveTractor("t-1")).rejects.toThrow(TRACTOR_ARCHIVE_RPC_UNAVAILABLE);
  });
});

describe("fuel-rate rule: new vs existing", () => {
  it("rejects a blank rate on a new tractor", () => {
    expect(validateTractorFuelUsage({ raw: "", isNew: true }).ok).toBe(false);
  });

  it("rejects 0 on a new tractor", () => {
    expect(validateTractorFuelUsage({ raw: "0", isNew: true }).ok).toBe(false);
  });

  it("accepts a positive rate on a new tractor", () => {
    expect(validateTractorFuelUsage({ raw: "6.8", isNew: true })).toEqual({
      ok: true,
      value: 6.8,
    });
  });

  it("lets an existing 0/unset tractor stay editable and unset", () => {
    expect(validateTractorFuelUsage({ raw: "", isNew: false })).toEqual({ ok: true, value: null });
    expect(validateTractorFuelUsage({ raw: "0", isNew: false })).toEqual({ ok: true, value: 0 });
  });

  it("supports normal editing of a configured rate", () => {
    expect(validateTractorFuelUsage({ raw: "12", isNew: false }).value).toBe(12);
  });

  it("rejects out-of-range values", () => {
    expect(validateTractorFuelUsage({ raw: "-1", isNew: false }).ok).toBe(false);
    expect(validateTractorFuelUsage({ raw: "1001", isNew: false }).ok).toBe(false);
  });

  it("presents stored 0 as unset", () => {
    expect(formatFuelUsage(0)).toBe(FUEL_NOT_SET_LABEL);
    expect(formatFuelUsage(null)).toBe(FUEL_NOT_SET_LABEL);
    expect(formatFuelUsage(6.8)).toBe("6.8 L/hr");
    expect(fuelUsageFieldValue(0)).toBe("");
    expect(fuelUsageFieldValue(6.8)).toBe("6.8");
  });
});
