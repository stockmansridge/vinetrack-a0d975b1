// SQL 222 correction: an explicit `rate_per_ha: null` must reach the database
// request, there must be NO silent retry without the field, and unrelated
// edits must still OMIT the column.
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: { op: "insert" | "update"; body: Record<string, any> }[] = [];
let nextError: any = null;

vi.mock("@/integrations/ios-supabase/client", () => {
  const result = (op: "insert" | "update", body: Record<string, any>) => ({
    eq: () => result(op, body),
    select: () => ({
      single: async () => {
        calls.push({ op, body });
        return nextError ? { data: null, error: nextError } : { data: { id: "c1", ...body }, error: null };
      },
    }),
  });
  return {
    supabase: {
      from: () => ({
        insert: (body: Record<string, any>) => result("insert", body),
        update: (body: Record<string, any>) => result("update", body),
      }),
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

import { createSavedChemical, updateSavedChemical } from "@/lib/savedChemicalsQuery";
import { legacyRatePerHaForWrite } from "@/lib/savedChemicalLegacyRate";
import { emptyManualRateDraft } from "@/lib/chemicalManualRate";

beforeEach(() => {
  calls.length = 0;
  nextError = null;
});

describe("rate_per_ha write contract", () => {
  it("per-hectare scalar changed to a /100 L range sends rate_per_ha: null", async () => {
    // The operator replaced a saved 2.5 L/ha scalar with a 200–300 mL/100 L range.
    const legacy = legacyRatePerHaForWrite({
      typed: "",
      manual: {
        ...emptyManualRateDraft(),
        open: true,
        confirmed: true,
        kind: "range",
        basis: "per_100_litres",
        min: "200",
        max: "300",
        unit: "mL",
      },
      defaults: null,
      rateDecisionChanged: true,
    });
    expect(legacy).toBeNull();

    await updateSavedChemical("c1", {
      name: "Manual Product",
      unit: "Litres",
      rate_per_ha: legacy as null,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe("update");
    expect("rate_per_ha" in calls[0].body).toBe(true);
    expect(calls[0].body.rate_per_ha).toBeNull();
    // Evidence for the report: the actual outgoing update payload.
    // eslint-disable-next-line no-console
    console.log("OUTGOING UPDATE PAYLOAD", JSON.stringify(calls[0].body, null, 2));
  });

  it("an unrelated edit omits rate_per_ha entirely", async () => {
    const legacy = legacyRatePerHaForWrite({ typed: "", defaults: null, rateDecisionChanged: false });
    expect(legacy).toBeUndefined();
    await updateSavedChemical("c1", {
      name: "Manual Product",
      unit: "Litres",
      notes: "changed note",
      ...(legacy === undefined ? {} : { rate_per_ha: legacy }),
    });
    expect("rate_per_ha" in calls[0].body).toBe(false);
  });

  it("a genuine per-hectare scalar is written as a number", async () => {
    await createSavedChemical("v1", { name: "P", unit: "Litres", rate_per_ha: 2.5 });
    expect(calls[0].body.rate_per_ha).toBe(2.5);
  });

  it("does NOT retry without rate_per_ha when the write fails", async () => {
    nextError = { code: "23502", message: 'null value in column "rate_per_ha" violates not-null constraint' };
    await expect(
      updateSavedChemical("c1", { name: "P", unit: "Litres", rate_per_ha: null }),
    ).rejects.toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.rate_per_ha).toBeNull();
  });
});

describe("shared operational pack/inventory columns", () => {
  it("coerces numeric columns and booleans, and survives create", async () => {
    await createSavedChemical("v1", {
      name: "P",
      unit: "Litres",
      product_form: "liquid",
      pack_size: "20",
      pack_unit: "Litres",
      price_per_pack: 340,
      inventory_quantity: 2,
      inventory_unit: "L",
      application_notes: "Apply at dusk",
      organic_certified: false,
    });
    const b = calls[0].body;
    expect(b.pack_size).toBe(20);
    expect(b.price_per_pack).toBe(340);
    expect(b.inventory_quantity).toBe(2);
    expect(b.organic_certified).toBe(false);
    expect(b.product_form).toBe("liquid");
    expect(b.pack_unit).toBe("Litres");
    expect(b.inventory_unit).toBe("L");
    expect(b.application_notes).toBe("Apply at dusk");
  });

  it("omits operational columns that were not supplied", async () => {
    await updateSavedChemical("c1", { name: "P", unit: "Litres" });
    for (const k of [
      "pack_size", "pack_unit", "price_per_pack", "inventory_quantity",
      "inventory_unit", "application_notes", "organic_certified", "product_form",
    ]) {
      expect(k in calls[0].body).toBe(false);
    }
  });

  it("never coerces a non-numeric pack value to zero", async () => {
    await updateSavedChemical("c1", { name: "P", unit: "Litres", pack_size: "abc" });
    expect("pack_size" in calls[0].body).toBe(false);
  });
});
