// Chemical Search production closeout — GENERIC portal rules only.
//
// There is deliberately no product-specific behaviour anywhere in these tests:
// every expectation is driven by shared-contract fields (form_type,
// direction_id, rate_id, default_rate_options, provenance), never by a
// registration number or a product name.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  formFromInventoryUnit,
  inventoryUnitForForm,
  packUnitForForm,
  parsePhysicalForm,
} from "@/lib/chemicalPhysicalForm";
import { parseChemicalLookup } from "@/lib/chemicalLookupResolver";
import { normalGrapevineUses, useGroupKey } from "@/lib/chemicalGrapevineUses";
import {
  isNarrowedSelectionOf,
  matchDefaultRateSlot,
  narrowedSelectionFromOption,
  validateVineyardDose,
} from "@/lib/chemicalDefaultRateSelection";
import {
  classifyRefreshError,
  classifyRefreshOutcome,
  masterRefreshRequestBody,
  newRefreshRunState,
  pendingIds,
  recordRow,
  refreshTotals,
  resumableState,
  runCatalogueRefresh,
} from "@/lib/masterCatalogueRefresh";

const src = (p: string) => readFileSync(p, "utf8");

const PROVENANCE = {
  product_name: "official_register",
  registrant: "official_register",
  registration_number: "official_register",
  active_ingredients: "official_register",
  registered_uses: "official_label",
};

function payload(product: Record<string, unknown>) {
  return {
    match_source: "authoritative",
    jurisdiction: { country_code: "AU", registration_scheme: "apvma" },
    field_provenance: PROVENANCE,
    product: {
      registered_product_name: "Test Product",
      registrant: "Test Registrant",
      registration_country: "AU",
      registration_scheme: "apvma",
      registration_number: "11111",
      ...product,
    },
  };
}

/* ------------------------------------------------------- PART 5 / 6: form */

describe("physical form is contract-driven, never inferred", () => {
  it("maps an authoritative solid to Solid / kg", () => {
    const r = parseChemicalLookup(payload({ form_type: "solid" }), "AU");
    expect(r.fields.physicalForm).toBe("solid");
    expect(inventoryUnitForForm(r.fields.physicalForm)).toBe("kg");
    expect(packUnitForForm(r.fields.physicalForm)).toBe("Kg");
  });

  it("maps an authoritative liquid to Liquid / L", () => {
    const r = parseChemicalLookup(payload({ form_type: "liquid" }), "AU");
    expect(r.fields.physicalForm).toBe("liquid");
    expect(inventoryUnitForForm(r.fields.physicalForm)).toBe("L");
    expect(packUnitForForm(r.fields.physicalForm)).toBe("Litres");
  });

  it("leaves an absent form unknown and the inventory unit unset — never Liquid", () => {
    const r = parseChemicalLookup(payload({}), "AU");
    expect(r.fields.physicalForm).toBe("unknown");
    expect(inventoryUnitForForm(r.fields.physicalForm)).toBeUndefined();
    expect(packUnitForForm(r.fields.physicalForm)).toBeUndefined();
    expect(r.unresolvedFields).toContain("form_type");
  });

  it("never infers a form from a formulation code or junk value", () => {
    for (const v of ["WG", "SC", "EC", "", null, undefined, 7, "granule"]) {
      expect(parsePhysicalForm(v)).toBe("unknown");
    }
  });

  it("g/100 L application rates do not imply Liquid", () => {
    const r = parseChemicalLookup(
      payload({
        registered_uses: [
          {
            crop: "Grapevines",
            target: "Powdery mildew",
            rates: [{ unit: "g/100 L", min: 100, max: 200, basis: "per_100_litres" }],
          },
        ],
      }),
      "AU",
    );
    expect(r.fields.physicalForm).toBe("unknown");
  });

  it("g/kg active concentration does not by itself imply Solid", () => {
    const r = parseChemicalLookup(
      payload({
        active_ingredients: [{ name: "Sulfur", concentration: 800, concentration_unit: "g/kg" }],
      }),
      "AU",
    );
    expect(r.fields.physicalForm).toBe("unknown");
  });

  it("derives a form from a stored INVENTORY unit without defaulting to liquid", () => {
    expect(formFromInventoryUnit("kg")).toBe("solid");
    expect(formFromInventoryUnit("L")).toBe("liquid");
    expect(formFromInventoryUnit("")).toBe("unknown");
    expect(formFromInventoryUnit(null)).toBe("unknown");
  });

  it("save → reload keeps solid solid, liquid liquid and unknown unknown", () => {
    // The portal persists the inventory unit; reopening derives the form back
    // from it. No legacy "Litres" fallback may enter this round trip.
    const roundTrip = (form: "solid" | "liquid" | "unknown") =>
      formFromInventoryUnit(inventoryUnitForForm(form) ?? "");
    expect(roundTrip("solid")).toBe("solid");
    expect(roundTrip("liquid")).toBe("liquid");
    expect(roundTrip("unknown")).toBe("unknown");
  });
});

/* -------------------------------------------------- PART 7: directions */

describe("registered directions keep their own identity", () => {
  const uses = [
    {
      crop: "Grapevines",
      target_raw: "Powdery mildew",
      rates: [{ unit: "g/100 L", min_value: 100, max_value: 200 }],
      extra: { direction_id: "dir-1" },
    },
    {
      crop: "Grapevines",
      target_raw: "Powdery mildew",
      rates: [{ unit: "g/100 L", min_value: 200, max_value: 600 }],
      extra: { direction_id: "dir-2" },
    },
  ] as any[];

  it("does not deduplicate two directions for the same crop + target", () => {
    const rows = normalGrapevineUses(uses);
    expect(rows.length).toBe(2);
    expect(new Set(rows.map(useGroupKey)).size).toBe(2);
  });

  it("never unions separate ranges into one", () => {
    const rows = normalGrapevineUses(uses);
    const bounds = rows.map((u) => [u.rates?.[0]?.min_value, u.rates?.[0]?.max_value]);
    expect(bounds).toEqual([
      [100, 200],
      [200, 600],
    ]);
    expect(bounds).not.toContainEqual([100, 600]);
  });

  it("falls back to crop + target only when no direction identity exists", () => {
    const key = useGroupKey({ crop: "Grapevines", target_raw: "Botrytis" } as any);
    expect(key.startsWith("target:")).toBe(true);
  });
});

/* --------------------------------------------------- PART 8: WHP / REI */

describe("WHP wording and REI honesty", () => {
  it("preserves the legal withholding wording instead of projecting 0 days", () => {
    const r = parseChemicalLookup(
      payload({
        registered_uses: [
          {
            crop: "Grapevines",
            target: "Powdery mildew",
            rates: [{ unit: "g/100 L", value: 150, basis: "per_100_litres" }],
            withholding_period_text: "Not required when used as directed",
          },
        ],
      }),
      "AU",
    );
    expect(r.fields.withholdingText).toBe("Not required when used as directed");
  });

  it("leaves an unstated re-entry period unresolved", () => {
    const r = parseChemicalLookup(payload({}), "AU");
    expect(r.fields.reEntryHours).toBeUndefined();
  });
});

/* -------------------------------------------- PART 10: vineyard defaults */

const RANGE_OPTION = {
  option_key: "default_option_v1:a",
  rate_ids: ["rate_v1:a"],
  basis: "per_100_litres" as const,
  unit: "g",
  value: null,
  min_value: 100,
  max_value: 200,
};

const EXACT_OPTION = {
  option_key: "default_option_v1:b",
  rate_ids: ["rate_v1:b"],
  basis: "per_hectare" as const,
  unit: "L",
  value: 2,
  min_value: null,
  max_value: null,
};

describe("vineyard default rate inside the registered evidence", () => {
  it("accepts an exact dose inside the label range", () => {
    expect(validateVineyardDose(RANGE_OPTION, "150")).toEqual({ ok: true, value: 150 });
    expect(validateVineyardDose(RANGE_OPTION, 100)).toEqual({ ok: true, value: 100 });
    expect(validateVineyardDose(RANGE_OPTION, 200)).toEqual({ ok: true, value: 200 });
  });

  it("rejects a dose outside the label range", () => {
    expect(validateVineyardDose(RANGE_OPTION, 99).ok).toBe(false);
    expect(validateVineyardDose(RANGE_OPTION, 201).ok).toBe(false);
    expect(validateVineyardDose(RANGE_OPTION, "abc").ok).toBe(false);
  });

  it("keeps an exact label rate exact", () => {
    expect(validateVineyardDose(EXACT_OPTION, 2).ok).toBe(true);
    expect(validateVineyardDose(EXACT_OPTION, 1.5).ok).toBe(false);
  });

  it("does not alter the registered range when a dose is selected", () => {
    const selection = narrowedSelectionFromOption(RANGE_OPTION, 150);
    expect(selection.value).toBe(150);
    expect(selection.min_value).toBeNull();
    expect(selection.max_value).toBeNull();
    expect(RANGE_OPTION.min_value).toBe(100);
    expect(RANGE_OPTION.max_value).toBe(200);
    expect(isNarrowedSelectionOf(selection, RANGE_OPTION)).toBe(true);
    // Bases are never converted into one another.
    expect(isNarrowedSelectionOf(selection, { ...EXACT_OPTION })).toBe(false);
  });

  it("still matches the narrowed selection on reload", () => {
    const selection = narrowedSelectionFromOption(RANGE_OPTION, 150);
    const slot = matchDefaultRateSlot(
      { version: 1, per_hectare: null, per_100_litres: selection },
      { per_hectare: [], per_100_litres: [RANGE_OPTION] },
      "per_100_litres",
    );
    expect(slot.status).toBe("matched");
    expect(slot.matchedOption?.option_key).toBe(RANGE_OPTION.option_key);
  });
});

/* ---------------------------------------------- PART 1: catalogue refresh */

describe("candidate catalogue refresh", () => {
  it("asks the existing backend action and never changes review status", () => {
    const body = masterRefreshRequestBody("id-1", "AU", "cid-9") as any;
    expect(body.action).toBe("master_refresh");
    expect(body.masterChemicalId).toBe("id-1");
    expect(body.target_review_status).toBe("candidate");
    expect(JSON.stringify(body)).not.toMatch(/service_role|approved/i);
  });

  it("classifies backend outcomes separately", () => {
    expect(classifyRefreshOutcome({ refresh_outcome: "no_material_change" })).toBe("no_material_change");
    expect(classifyRefreshOutcome({ outcome: "material_change" })).toBe("material_change");
    expect(classifyRefreshOutcome({ outcome: "evidence_refreshed" })).toBe("evidence_refreshed");
    expect(classifyRefreshOutcome({ conflicts: [{ field: "actives" }] })).toBe("conflict");
    expect(classifyRefreshOutcome({ outcome: "source_unavailable" })).toBe("source_unavailable");
    expect(classifyRefreshError(new Error("429 rate limit"))).toBe("source_unavailable");
    expect(classifyRefreshError(new Error("bad request"))).toBe("failed");
  });

  it("runs with bounded concurrency and reports totals", async () => {
    let inFlight = 0;
    let peak = 0;
    const state = await runCatalogueRefresh({
      ids: ["a", "b", "c", "d", "e"],
      concurrency: 3,
      invoke: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return { refresh_outcome: "no_material_change" };
      },
    });
    expect(peak).toBeLessThanOrEqual(3);
    const totals = refreshTotals(state);
    expect(totals.processed).toBe(5);
    expect(totals.no_material_change).toBe(5);
  });

  it("resumes without restarting rows that already succeeded", async () => {
    const ids = ["a", "b", "c"];
    let first = newRefreshRunState(ids, "t0");
    first = recordRow(first, "a", "material_change", "t1");
    first = recordRow(first, "b", "source_unavailable", "t1");
    expect(pendingIds(first, ids)).toEqual(["b", "c"]);

    const touched: string[] = [];
    const resumed = await runCatalogueRefresh({
      ids,
      initialState: resumableState(JSON.parse(JSON.stringify(first)), ids),
      concurrency: 2,
      invoke: async (id) => {
        touched.push(id);
        return { outcome: "evidence_refreshed" };
      },
    });
    expect(touched.sort()).toEqual(["b", "c"]);
    expect(refreshTotals(resumed).processed).toBe(3);
    expect(resumed.rows.a.outcome).toBe("material_change");
  });

  it("never touches vineyard-private data from the client", () => {
    const file = src("src/lib/masterCatalogueRefresh.ts");
    const ui = src("src/components/chemicals/MasterCatalogueRefreshDialog.tsx");
    // Comments describe the guarantee; the CODE must not reference those tables.
    const strip = (t: string) =>
      t.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    for (const f of [strip(file), strip(ui)]) {
      expect(f).not.toMatch(/saved_chemicals|spray_|purchase|supplier|stock/i);
      expect(f).not.toMatch(/service_role|SERVICE_ROLE/);
      expect(f).not.toMatch(/review_status\s*[:=]\s*["']approved/);
    }
  });
});

/* ------------------------------------------- PART 3/4: portal editor flow */

describe("new chemical flow before selection", () => {
  const editor = src("src/components/chemicals/ChemicalEditorSheet.tsx");
  const lookup = src("src/components/spray/ChemicalAILookup.tsx");

  it("keeps the product editor gated until a product is chosen", () => {
    // Add stays gated on selection; editing an existing record is always open.
    expect(editor).toContain("const editorUnlocked = !!initial || selectionMode !== \"none\"");
    expect(editor).toContain("{editorUnlocked && (");
    expect(editor).toContain("onSelectionChange={handleSelectionChange}");
  });

  it("still supports explicit manual entry", () => {
    expect(lookup).toContain("function applyManual()");
    expect(lookup).toContain("Enter manually");
  });

  it("Change product returns to candidate selection and clears the identity", () => {
    expect(lookup).toContain("Change product");
    expect(editor).toContain("if (mode === \"none\" && !initial)");
    expect(editor).toContain("setIntel(emptyDraft())");
  });

  it("does not infer a product form from the unit in the product editor", () => {
    expect(editor).toContain("value={physicalForm}");
    expect(editor).not.toContain("value={inferProductType(form.unit)}\n                      onValueChange");
  });

  it("contains no product-specific logic", () => {
    for (const f of [editor, lookup, src("src/lib/chemicalPhysicalForm.ts")]) {
      expect(f).not.toMatch(/53904|Thiovit/i);
    }
  });
});
