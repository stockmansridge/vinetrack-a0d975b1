// Program Step canopy/water settings must persist and read back faithfully;
// missing historical values stay missing.
import { describe, it, expect } from "vitest";
import { toSprayJobInput } from "@/lib/sprayApplicationSave";
import { hydrateDraft } from "@/lib/sprayApplicationDraft";
import { calculateSprayApplication } from "@/lib/sprayCalculation";
import { resolveApplicationGeometry } from "@/lib/sprayApplicationGeometry";

function roundTrip(job: any) {
  const app = hydrateDraft({ vineyardId: "v1", job, isTemplate: true }) as any;
  const geometry = resolveApplicationGeometry({
    paddocks: [], blockIds: [], mode: app.mode, override: app.geometryOverride,
    totalTreatedBandWidthMetres: app.totalTreatedBandWidthMetres,
  } as any);
  const calculation = calculateSprayApplication({ application: app, geometry } as any);
  return { app, input: toSprayJobInput({ application: app, geometry, calculation }).input };
}

const base = {
  id: "s101", vineyard_id: "v1", name: "Step 101", is_template: true, status: "draft",
  operation_type: "Foliar", application_mode: "canopy", chemical_lines: [],
};

describe("Program Step carrier/canopy round trip", () => {
  it("Step 101: Small, Low, 400 L/ha read back exactly", () => {
    const { app, input } = roundTrip({
      ...base, vsp_canopy_size: "Small", vsp_canopy_density: "Low",
      spray_rate_per_ha: 400, carrier_volume_basis: "l_per_ha",
    });
    expect(app.carrier.litresPerHectare).toBe(400);
    expect(input.spray_rate_per_ha).toBe(400);
    expect(input.carrier_volume_basis).toBe("l_per_ha");
    expect(input.vsp_canopy_size).toBe("Small");
    expect(input.vsp_canopy_density).toBe("Low");
    expect(input.water_volume).toBeNull(); // templates carry no block total
  });
  it("older steps with nulls are not auto-filled", () => {
    const { input } = roundTrip({ ...base });
    expect(input.vsp_canopy_size).toBeNull();
    expect(input.vsp_canopy_density).toBeNull();
    expect(input.spray_rate_per_ha).toBeNull();
    expect(input.applied_litres_per_100m).toBeNull();
    expect(input.dilute_litres_per_100m).toBeNull();
  });
  it("L/100m settings persist", () => {
    const { input } = roundTrip({
      ...base, carrier_volume_basis: "l_per_100m", applied_litres_per_100m: 12.5,
      dilute_litres_per_100m: 25, vsp_canopy_size: "Large", vsp_canopy_density: "High",
    });
    expect(input.applied_litres_per_100m).toBe(12.5);
    expect(input.dilute_litres_per_100m).toBe(25);
    expect(input.vsp_canopy_size).toBe("Large");
  });
});
