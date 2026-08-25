import { describe, expect, it } from "vitest";
import {
  assertUserMachineType,
  isLinkedTractorMirror,
  isOrphanTractorMachine,
  isUserVineyardMachine,
  partitionMachines,
  TractorMachineTaxonomyError,
  USER_MACHINE_TYPES,
} from "@/lib/equipmentTaxonomy";

const mirror = { id: "m1", machine_type: "tractor", legacy_tractor_id: "t1" };
const orphan = { id: "m2", machine_type: "tractor", legacy_tractor_id: null };
const atv = { id: "m3", machine_type: "atv", legacy_tractor_id: null };

describe("equipment taxonomy", () => {
  it("never offers tractor as a user-creatable machine type", () => {
    expect(USER_MACHINE_TYPES).not.toContain("tractor" as never);
  });

  it("classifies linked mirrors, orphans and genuine machines", () => {
    expect(isLinkedTractorMirror(mirror)).toBe(true);
    expect(isOrphanTractorMachine(mirror)).toBe(false);
    expect(isOrphanTractorMachine(orphan)).toBe(true);
    expect(isLinkedTractorMirror(orphan)).toBe(false);
    expect(isUserVineyardMachine(atv)).toBe(true);
    expect(isUserVineyardMachine(mirror)).toBe(false);
    expect(isUserVineyardMachine(orphan)).toBe(false);
  });

  it("partitions a vineyard machine list into the three states", () => {
    const p = partitionMachines([mirror, orphan, atv]);
    expect(p.machines.map((m) => m.id)).toEqual(["m3"]);
    expect(p.mirrors.map((m) => m.id)).toEqual(["m1"]);
    expect(p.needsReview.map((m) => m.id)).toEqual(["m2"]);
  });

  it("machine counts exclude every tractor-typed row", () => {
    const rows = [mirror, orphan, atv, { id: "m4", machine_type: "harvester" }];
    expect(rows.filter(isUserVineyardMachine)).toHaveLength(2);
  });

  it("blocks the Portal from writing a tractor-machine", () => {
    expect(() => assertUserMachineType("tractor")).toThrow(TractorMachineTaxonomyError);
    expect(() => assertUserMachineType("")).toThrow(TractorMachineTaxonomyError);
    expect(() => assertUserMachineType("atv")).not.toThrow();
  });
});
