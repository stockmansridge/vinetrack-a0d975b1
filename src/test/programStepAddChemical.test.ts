// Program Step → Products: creating a Chemical Store product from an
// unresolved row must bind by persisted identity and preserve the row config.
import { describe, it, expect } from "vitest";
import { bindChemicalToLine } from "@/components/spray/wizard/ProductsStep";
import { productLineFromChemical } from "@/lib/sprayApplicationDraft";
import { toChemicalIntelligence } from "@/lib/chemicalIntelligence";

const savedRow = {
  id: "chem-uuid-1",
  vineyard_id: "v1",
  name: "Spray Seal",
  active_ingredient: "Di-1-p-menthene 960 g/L",
  unit: "mL",
} as any;

function unresolvedRow() {
  const line = productLineFromChemical({
    savedChemicalId: null,
    productName: "Spray Seal",
    unit: "mL",
  });
  return { ...line, rate: 150, unit: "mL", rateBasis: "whole_block_area" as const };
}

describe("Program Step add chemical binding", () => {
  it("binds by persisted id and keeps rate / unit / basis", () => {
    const intel = toChemicalIntelligence(savedRow);
    const bound = bindChemicalToLine(unresolvedRow(), intel, intel.id);
    expect(bound.savedChemicalId).toBe("chem-uuid-1");
    expect(bound.rate).toBe(150);
    expect(bound.unit).toBe("mL");
    expect(bound.rateBasis).toBe("whole_block_area");
    expect(bound.productName).toBe("Spray Seal");
  });

  it("never binds on a name match alone", () => {
    const bound = bindChemicalToLine(unresolvedRow(), null, null);
    expect(bound.savedChemicalId).toBeNull();
    expect(bound.productName).toBeNull();
  });
});
