import { describe, it, expect } from "vitest";
import {
  assessPhysicalUnit,
  buildUnitCorrectionArgs,
  catalogueFormulationForm,
  rateUnitFamily,
  SAVED_CHEMICAL_UNIT_CORRECTION_RPC_DEPLOYED,
} from "@/lib/chemicalPhysicalUnitConsistency";
import { buildAddToVineyardArgs } from "@/lib/chemicalInventory";

const dipel = {
  id: "c34a3445-3845-4141-ab04-c17fcf6f26c3",
  product_form: "DRY FLOWABLE",
  default_rate_options: [{ unit: "g/100 L", value: 100 }, { unit: "kg/ha", value: 1 }],
};
const badSaved = { id: "f0244e28-c065-4124-a48f-a19994c7f236", unit: "Litres", product_form: "liquid", pack_unit: "L" };

describe("catalogue formulation form", () => {
  it("DRY FLOWABLE is solid", () => expect(catalogueFormulationForm("DRY FLOWABLE")).toBe("solid"));
  it("unrecognised formulation is unknown, never liquid", () => expect(catalogueFormulationForm("XYZ PASTE")).toBe("unknown"));
  it("EC is liquid", () => expect(catalogueFormulationForm("EC")).toBe("liquid"));
  it("rate families", () => {
    expect(rateUnitFamily("g/100 L")).toBe("weight");
    expect(rateUnitFamily("mL/100L")).toBe("volume");
    expect(rateUnitFamily("units/ha")).toBe("unknown");
  });
});

describe("assessPhysicalUnit", () => {
  it("flags DiPel DF saved as Litres and offers exact unit/form-only preview", () => {
    const a = assessPhysicalUnit(badSaved, dipel)!;
    expect(a.mismatch).toBe(true);
    expect(a.correctionEligible).toBe(true);
    expect(a.preview).toEqual([
      { field: "unit", from: "Litres", to: "Kg" },
      { field: "product_form", from: "liquid", to: "solid" },
    ]);
    expect(a.preview.some((p) => (p.field as string) === "pack_unit")).toBe(false);
    expect(buildUnitCorrectionArgs(badSaved.id, a)).toEqual({
      p_saved_chemical_id: badSaved.id,
      p_expected_approved_revision_id: dipel.id,
      p_expected_unit: "Litres",
      p_expected_product_form: "liquid",
      p_target_form: "solid",
    });
  });
  it("no mismatch when saved as Kg", () => {
    const a = assessPhysicalUnit({ unit: "Kg", product_form: "solid" }, dipel)!;
    expect(a.mismatch).toBe(false);
    expect(buildUnitCorrectionArgs("x", a)).toBeNull();
  });
  it("unrecognised dry-ish formulation is not eligible", () => {
    const a = assessPhysicalUnit(badSaved, { ...dipel, product_form: "PASTE" })!;
    expect(a.correctionEligible).toBe(false);
  });
  it("mixed weight/volume catalogue rates are not eligible", () => {
    const a = assessPhysicalUnit(badSaved, { ...dipel, default_rate_options: [{ unit: "g/100 L" }, { unit: "mL/100 L" }] })!;
    expect(a.mismatch).toBe(true);
    expect(a.correctionEligible).toBe(false);
  });
  it("requires an approved revision", () => expect(assessPhysicalUnit(badSaved, null)).toBeNull());
  it("correction stays gated until the backend function exists", () => expect(SAVED_CHEMICAL_UNIT_CORRECTION_RPC_DEPLOYED).toBe(false));
});

describe("add to vineyard never assumes a unit", () => {
  it("opening stock without a unit is refused", () => {
    expect(buildAddToVineyardArgs({ revisionId: "r", vineyardId: "v", quantity: "5", unit: null })).toEqual({ error: "Choose the opening stock unit." });
  });
  it("no opening stock sends no unit", () => {
    const b = buildAddToVineyardArgs({ revisionId: "r", vineyardId: "v", quantity: "", unit: null }) as any;
    expect(b.args.p_opening_unit).toBeNull();
  });
});
