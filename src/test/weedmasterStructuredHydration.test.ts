// Weedmaster: search result -> select -> structured hydration -> canonical
// Phalaris option -> Saved Chemical payload -> read-back. Mocked lookup only.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { MasterChemicalRow } from "@/lib/masterChemicals";
import { masterManufacturerLabel, masterReleaseWarnings } from "@/lib/masterWorkbench";
import { masterLabelTargets, masterRateSummary } from "@/lib/masterCuration";
import {
  buildMasterSavedChemicalInput,
  hydrateMasterSelection,
  initialiseDefaultRatesFromMaster,
  normaliseMasterSearchHit,
  persistedDefaultRates,
  selectionFromMasterRate,
} from "@/lib/chemicalSearchV2";
import { decodePersistedDefaultRates } from "@/lib/chemicalDefaultRatesContract";

const FIXTURE = JSON.parse(readFileSync("src/test/fixtures/weedmaster-rev2.sanitised.json", "utf8"));
const ROW = FIXTURE.row as MasterChemicalRow;
const NUFARM_PDF =
  "https://cdn.nufarm.com/wp-content/uploads/sites/22/2018/05/13085258/0533-Nufarm-Weedmaster-DUO-Herbicide.pdf";
const OPTION = "default_option_v1_5f58b1d9f422213e1ecf8632036c1356";
const RATE = "rate_v1_4efec198ead373a3286939ced245fadf";
const DIRECTION = "direction_v1_1363f3205ca7b639cd5f970a03d91785";

const phalarisOption = (extra: Record<string, unknown> = {}) => ({
  option_key: OPTION, rate_ids: [RATE], direction_ids: [DIRECTION], basis: "per_100_litres",
  unit: "mL", value: null, min_value: 500, max_value: 1000,
  targets: ["Phalaris"], conditions: ["Handgun"], crops: ["Vineyards"], condition_ambiguous: false, ...extra,
});
const structured = (over: Record<string, unknown> = {}) => ({
  master_chemical_id: ROW.id,
  registration_number: "53576",
  registration_country: "AU",
  registration_identity_key: "AU:apvma:53576",
  default_rate_options: { per_hectare: [], per_100_litres: [phalarisOption()] },
  ...over,
});

const hit = normaliseMasterSearchHit(JSON.parse(JSON.stringify(ROW)))!;

describe("Weedmaster structured hydration", () => {
  it("search result carries no options; selection hydrates the exact identity", async () => {
    expect(hit.defaultRateOptions).toBeNull();
    const invoke = vi.fn().mockResolvedValue({ data: structured(), error: null });
    const res = await hydrateMasterSelection(hit, invoke);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toMatchObject({
      action: "structured", country: "Australia", registrationNumber: "53576",
      registrationScheme: hit.registrationScheme, productName: hit.productName,
    });
    expect(res.status).toBe("hydrated");

    const hydrated = { ...hit, defaultRateOptions: res.options };
    const r = hydrated.rates.find((x) => x.source_id === RATE)!;
    expect(r).toMatchObject({ target: "Phalaris", label: "Handgun", direction_id: DIRECTION });
    expect(masterRateSummary(r)).toMatch(/500/);

    const init = initialiseDefaultRatesFromMaster(hydrated.rates, {}, hydrated.defaultRateOptions);
    expect(init.ambiguous.per_hectare.length).toBeGreaterThan(0);
    expect(init.ambiguous.per_100_litres.length).toBeGreaterThan(1);
    expect(hydrated.rates.every((x) => x.basis === "per_hectare" || x.basis === "per_100_litres")).toBe(true);

    const sel = selectionFromMasterRate(r, { selected_at: "2026-10-01T05:00:00Z", label_version: hydrated.labelVersion }, hydrated.defaultRateOptions)!;
    const payload = buildMasterSavedChemicalInput(hydrated, persistedDefaultRates({ per_100_litres: sel }));
    expect(payload.master_chemical_id).toBe(ROW.id);
    expect(payload.master_source_revision).toBe(hit.catalogueVersion ?? undefined);
    const back = decodePersistedDefaultRates(JSON.parse(JSON.stringify(payload.default_rates)))!;
    expect(back.per_hectare).toBeNull();
    expect(back.per_100_litres).toMatchObject({
      option_key: OPTION, rate_ids: [RATE], basis: "per_100_litres",
      min_value: 500, max_value: 1000, unit: "mL", source: "operator", entry_method: "canonical",
    });
    expect(JSON.stringify(back)).not.toMatch(/direction_v1|master_source_revision/);
  });

  it("keeps warnings, Nufarm label and data.gov.au as evidence", () => {
    expect((ROW.verification_unresolved_fields as any[]).length).toBe(32);
    expect(hit.structured.verification_unresolved_fields).toHaveLength(32);
    expect(masterReleaseWarnings(ROW).length).toBeGreaterThan(0);
    expect(masterManufacturerLabel(ROW)?.url).toBe(NUFARM_PDF);
    expect(masterLabelTargets(ROW).find((t) => /data\.gov\.au/.test(t.url))?.kind).not.toBe("manufacturer_label");
  });

  it("Wiper and /15 L Knapsack never become calculator choices", () => {
    expect(hit.rates.some((r) => /wiper|knapsack/i.test(`${r.label ?? ""}`))).toBe(false);
  });

  const manualAfter = async (data: unknown, error: unknown = null) => {
    const res = await hydrateMasterSelection(hit, vi.fn().mockResolvedValue({ data, error }));
    const r = hit.rates.find((x) => x.source_id === RATE)!;
    return { res, sel: selectionFromMasterRate(r, {}, res.options ?? hit.defaultRateOptions)! };
  };

  it("hydration unavailable -> no fabricated catalogue identity", async () => {
    const { res, sel } = await manualAfter(null, new Error("503"));
    expect(res.status).toBe("unavailable");
    expect(sel).toMatchObject({ entry_method: "manual", option_key: "", rate_ids: [] });
    const thrown = await hydrateMasterSelection(hit, vi.fn().mockRejectedValue(new Error("x")));
    expect(thrown.status).toBe("unavailable");
  });

  it("wrong Master identity or unresolved -> rejected", async () => {
    expect((await manualAfter(structured({ master_chemical_id: "other" }))).res.status).toBe("identity_mismatch");
    expect((await manualAfter(structured({ registration_number: "99999" }))).res.status).toBe("identity_mismatch");
    expect((await manualAfter(structured({ registration_country: "NZ" }))).res.status).toBe("identity_mismatch");
    const u = await manualAfter(structured({ status: "unresolved" }));
    expect(u.res.status).toBe("unresolved");
    expect(u.sel.option_key).toBe("");
  });

  it("ambiguous canonical option -> no guess", async () => {
    const twice = await manualAfter(structured({
      default_rate_options: { per_hectare: [], per_100_litres: [phalarisOption(), phalarisOption({ option_key: "default_option_v1_other" })] },
    }));
    expect(twice.sel).toMatchObject({ entry_method: "manual", option_key: "" });
    const flagged = await manualAfter(structured({
      default_rate_options: { per_hectare: [], per_100_litres: [phalarisOption({ condition_ambiguous: true })] },
    }));
    expect(flagged.sel).toMatchObject({ entry_method: "manual", option_key: "" });
  });
});
