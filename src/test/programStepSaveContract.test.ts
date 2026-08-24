// Program Step save contract: a template is still a valid `spray_jobs` row
// (status NOT NULL) and never fabricates a product rate basis.
import { describe, it, expect } from "vitest";
import { toChemicalLine, toSprayJobInput } from "@/lib/sprayApplicationSave";
import { hydrateDraft, productLineFromChemical } from "@/lib/sprayApplicationDraft";
import { calculateSprayApplication } from "@/lib/sprayCalculation";
import { resolveApplicationGeometry } from "@/lib/sprayApplicationGeometry";

function templateDraft() {
  const app = hydrateDraft({ vineyardId: "v1", job: null, isTemplate: true }) as any;
  app.name = "EL 12 protectant";
  app.operationType = "foliar";
  app.products = [
    productLineFromChemical({ savedChemicalId: "c1", productName: "Dithane", unit: "g" }),
  ];
  return app;
}

describe("Program Step save contract", () => {
  it("stores a non-null status for a template", () => {
    const app = templateDraft();
    const geometry = resolveApplicationGeometry({
      paddocks: [],
      blockIds: [],
      mode: app.mode,
      override: app.geometryOverride,
      totalTreatedBandWidthMetres: app.totalTreatedBandWidthMetres,
    } as any);
    const calculation = calculateSprayApplication({ application: app, geometry } as any);
    const { input, paddockIds } = toSprayJobInput({ application: app, geometry, calculation });
    expect(input.is_template).toBe(true);
    expect(input.status).toBe("draft");
    expect(paddockIds).toEqual([]);
  });

  it("does not invent a per-hectare basis for a rate-free product", () => {
    const line = productLineFromChemical({
      savedChemicalId: "c1",
      productName: "Dithane",
      unit: "g",
    });
    const mapped = toChemicalLine({ ...line, rate: null, rateBasis: null } as any);
    expect(mapped.rate).toBeNull();
    expect(mapped.product_rate_basis ?? null).toBeNull();
    expect(mapped.rate_basis ?? null).toBeNull();
  });

  it("keeps the per-hectare default once a rate is entered", () => {
    const line = productLineFromChemical({
      savedChemicalId: "c1",
      productName: "Dithane",
      unit: "g",
    });
    const mapped = toChemicalLine({ ...line, rate: 200, rateBasis: null } as any);
    expect(mapped.product_rate_basis).toBe("whole_block_area");
    expect(mapped.rate_basis).toBe("per_hectare");
  });
});
