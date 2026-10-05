import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ admin: true }));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: h.admin, loading: false }) }));
vi.mock("@/integrations/ios-supabase/client", () => {
  const c: any = { select: () => c, eq: () => c, is: () => c, order: () => c, then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) };
  return { supabase: { from: () => c, rpc: async () => ({ data: [], error: null }) } };
});

import { offeredOperationTypes } from "@/components/spray/wizard/ApplicationStep";
import { applyOperationType, applyTemplate } from "@/lib/sprayApplicationDraft";
import { emptySprayApplication, fromLegacySprayJob, type SprayApplication } from "@/lib/sprayApplicationDomain";
import { toSprayJobInput } from "@/lib/sprayApplicationSave";
import {
  activeBySession, buildFertigationPayload, draftProductsFromStep, fertigationGateReasons,
  plannedQuantity, servicedTotals,
} from "@/lib/fertigation";
import { ProgramStepDetailDialog } from "@/components/spray/ProgramStepDetailDialog";

const sprayStep = (): SprayApplication => ({
  ...emptySprayApplication(), vineyardId: "v", isTemplate: true, name: "Post-flowering nutrition",
  operationType: "foliar", mode: "whole_block", targets: ["powdery_mildew"] as any, headTarget: "full_canopy" as any,
  tractorId: "t1", equipmentId: "e1", growthStageCode: "EL27",
  carrier: { basis: "l_per_ha", litresPerHectare: 500, canopySize: "large", canopyDensity: "high" } as any,
  tankCapacityLitres: 2000, geometryOverride: { rowSpacingMetres: 3 },
  products: [{ savedChemicalId: "c1", productName: "Calcium Nitrate", rate: 20, unit: "kg", rateBasis: "per_100_litres", activityGroups: [], verificationStatus: "unverified" as any }],
});

describe("Fertigation gate + Program Step", () => {
  it("1. non-System-Admin is not offered Fertigation", () => {
    expect(offeredOperationTypes({ isTemplate: true, fertigationEnabled: false, current: null })).not.toContain("fertigation");
  });
  it("2. System Admin is offered Fertigation on a Program Step", () => {
    expect(offeredOperationTypes({ isTemplate: true, fertigationEnabled: true, current: null })).toContain("fertigation");
  });
  it("3. Fertigation is never offered on a Planned Spray, and templates can't seed one", () => {
    expect(offeredOperationTypes({ isTemplate: false, fertigationEnabled: true, current: null })).not.toContain("fertigation");
    const planned = { ...emptySprayApplication(), isTemplate: false };
    const fert = applyOperationType(sprayStep(), "fertigation");
    expect(applyTemplate(planned, fert)).toBe(planned);
  });
  it("4. switching to Fertigation clears every spray-only field and requires a new basis", () => {
    const f = applyOperationType(sprayStep(), "fertigation");
    expect(f).toMatchObject({ mode: null, targets: null, headTarget: null, tractorId: null, equipmentId: null,
      tankCapacityLitres: null, carrier: { basis: null }, geometryOverride: {}, blockIds: [], isTemplate: true });
    expect(f.products[0]).toMatchObject({ savedChemicalId: "c1", rate: 20, rateBasis: null, fertigationRateBasis: null });
  });
  it("5. Fertigation gate needs no equipment/carrier/resistance, only explicit basis + unit + rate", () => {
    const f = applyOperationType(sprayStep(), "fertigation");
    expect(fertigationGateReasons(f)).toEqual(["Choose the Fertigation rate basis for Calcium Nitrate."]);
    f.products[0] = { ...f.products[0], fertigationRateBasis: "per_hectare", fertigationRateUnit: "kg/ha" };
    expect(fertigationGateReasons(f)).toEqual([]);
  });
  it("6. saves operation_type = Fertigation with spray columns NULL, and round-trips", () => {
    const f = applyOperationType(sprayStep(), "fertigation");
    f.products[0] = { ...f.products[0], fertigationRateBasis: "per_hectare", fertigationRateUnit: "kg/ha" };
    const { input, paddockIds } = toSprayJobInput({ application: f, geometry: {} as any, calculation: { carrier: {} } as any });
    expect(input).toMatchObject({ operation_type: "Fertigation", is_template: true, application_mode: null,
      equipment_id: null, tractor_id: null, target: null, targets: null, spray_head_target: null,
      ground_application_target: null, carrier_volume_basis: null, spray_rate_per_ha: null,
      vsp_canopy_size: null, vsp_canopy_density: null, water_volume: null, row_spacing_metres: null,
      growth_stage_code: "EL27" });
    expect(paddockIds).toEqual([]);
    const line = (input.chemical_lines as any[])[0];
    expect(line).toMatchObject({ savedChemicalId: "c1", fertigation_rate_basis: "per_hectare", fertigation_rate_unit: "kg/ha", rate_basis: null, product_rate_basis: null });
    const back = fromLegacySprayJob({ ...(input as any), id: "s1" });
    expect(back.operationType).toBe("fertigation");
    expect(back.products[0]).toMatchObject({ fertigationRateBasis: "per_hectare", fertigationRateUnit: "kg/ha" });
  });
});

describe("Program Step detail", () => {
  const job: any = { id: "s1", vineyard_id: "v", is_template: true, operation_type: "Fertigation", name: "Post-flowering nutrition",
    growth_stage_code: "EL27", chemical_lines: [{ savedChemicalId: "c1", name: "Calcium Nitrate", rate: 20, fertigation_rate_basis: "per_hectare", fertigation_rate_unit: "kg/ha" }] };
  const renderIt = (j: any, extra: any = {}) => render(
    <QueryClientProvider client={new QueryClient()}>
      <ProgramStepDetailDialog open job={j} vineyardId="v" canEdit onOpenChange={() => {}} onPlanSpray={extra.plan ?? (() => {})}
        onApplyViaIrrigation={extra.apply} onEdit={() => {}} onArchive={() => {}} />
    </QueryClientProvider>,
  );
  it("7/8. Fertigation step shows Apply via Irrigation (not Plan Spray) and calls the handler", () => {
    h.admin = true;
    const apply = vi.fn();
    renderIt(job, { apply });
    expect(screen.queryByText("Plan Spray")).toBeNull();
    fireEvent.click(screen.getByText("Apply via Irrigation"));
    expect(apply).toHaveBeenCalled();
    expect(screen.getByText(/20 kg\/ha/)).toBeTruthy();
  });
  it("normal spray step keeps Plan Spray", () => {
    renderIt({ ...job, operation_type: "Foliar Spray" });
    expect(screen.getByText("Plan Spray")).toBeTruthy();
  });
});

describe("Fertigation quantities + records", () => {
  const blocks = [
    { serviced_area_m2: 13_000, serviced_vine_count: 2500 },
    { serviced_area_m2: 10_000, serviced_vine_count: 2000 },
  ] as any;
  const totals = servicedTotals(blocks);
  it("11. per hectare uses authoritative serviced area (20 kg/ha × 2.30 ha = 46 kg)", () => {
    expect(plannedQuantity({ rate: 20, rateBasis: "per_hectare", rateUnit: "kg/ha" }, totals)).toEqual({ quantity: 46, unit: "kg" });
  });
  it("12. per vine uses serviced vines (25 mL × 4,500 = 112.5 L)", () => {
    expect(plannedQuantity({ rate: 25, rateBasis: "per_vine", rateUnit: "mL/vine" }, totals)).toEqual({ quantity: 112.5, unit: "L" });
  });
  it("13. per cycle stays the entered total", () => {
    expect(plannedQuantity({ rate: 50, rateBasis: "per_irrigation_cycle", rateUnit: "kg" }, { areaHa: null, vines: null })).toEqual({ quantity: 50, unit: "kg" });
  });
  it("14. missing inputs stay unknown, never zero", () => {
    const partial = servicedTotals([{ serviced_area_m2: 10_000, serviced_vine_count: null }, { serviced_area_m2: null, serviced_vine_count: 10 }] as any);
    expect(partial).toEqual({ areaHa: null, vines: null });
    expect(plannedQuantity({ rate: 20, rateBasis: "per_hectare", rateUnit: "kg/ha" }, partial).quantity).toBeNull();
    expect(servicedTotals([])).toEqual({ areaHa: null, vines: null });
  });
  const step: any = { id: "s1", name: "Post-flowering nutrition", growth_stage_code: "EL27",
    chemical_lines: [{ savedChemicalId: "c1", name: "Calcium Nitrate", rate: 20, fertigation_rate_basis: "per_hectare", fertigation_rate_unit: "kg/ha" }] };
  it("15/20. actual is separate from planned and the snapshot is frozen", () => {
    const products = draftProductsFromStep(step);
    products[0].actual = "44";
    const payload = buildFertigationPayload({ id: "a1", vineyardId: "v", sessionId: "sess", step, products, totals, notes: null });
    expect(payload.products[0]).toMatchObject({ saved_chemical_id: "c1", planned_quantity: 46, actual_quantity: 44, quantity_unit: "kg", planned_rate: 20 });
    // Editing the Program Step later doesn't touch the built record.
    step.name = "Renamed"; step.chemical_lines[0].rate = 99;
    expect(payload.program_step_name).toBe("Post-flowering nutrition");
    expect(payload.products[0].planned_rate).toBe(20);
    // Editing an existing application keeps its frozen lines and ids.
    const existing: any = { id: "a1", program_step_id: "s1", products: [{ ...payload.products[0], sort_order: 0 }] };
    const again = draftProductsFromStep(step, existing);
    expect(again[0].id).toBe(payload.products[0].id);
    expect(again[0].line.rate).toBe(20);
    expect(again[0].actual).toBe("44");
  });
  it("blank actual stays null (not entered), not zero", () => {
    const products = draftProductsFromStep({ ...step, chemical_lines: [{ ...step.chemical_lines[0], rate: 20 }] });
    const p = buildFertigationPayload({ id: "a", vineyardId: "v", sessionId: "s", step, products, totals, notes: null });
    expect(p.products[0].actual_quantity).toBeNull();
  });
  it("19. history marks one row per session, ignoring reversed applications", () => {
    const m = activeBySession([
      { id: "1", irrigation_session_id: "sA", status: "active" },
      { id: "2", irrigation_session_id: "sB", status: "reversed" },
    ] as any);
    expect([...m.keys()]).toEqual(["sA"]);
  });
});
