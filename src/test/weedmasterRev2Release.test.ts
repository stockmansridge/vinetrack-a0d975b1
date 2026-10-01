// Weedmaster (AU:apvma:53576) revision-2 release acceptance on the ACTUAL
// applied snapshot (sanitised derivative — see `_substitutions` in the fixture).
// Nothing is written; approval is only simulated on a local clone.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { MasterChemicalRow } from "@/lib/masterChemicals";
import { masterLabelTargets, approveWithCorrections, parseMasterViticultureRates } from "@/lib/masterCuration";
import {
  masterIssues,
  masterManufacturerLabel,
  masterReleaseBlockers,
  masterReleaseWarnings,
} from "@/lib/masterWorkbench";
import {
  buildMasterSavedChemicalInput,
  initialiseDefaultRatesFromMaster,
  normaliseMasterSearchHit,
  persistedDefaultRates,
  selectionFromMasterRate,
} from "@/lib/chemicalSearchV2";
import { decodePersistedDefaultRates } from "@/lib/chemicalDefaultRatesContract";

const FIXTURE = JSON.parse(readFileSync("src/test/fixtures/weedmaster-rev2.sanitised.json", "utf8"));
const ROW = FIXTURE.row as MasterChemicalRow;
const clone = (): MasterChemicalRow => JSON.parse(JSON.stringify(ROW));

const NUFARM_PDF =
  "https://cdn.nufarm.com/wp-content/uploads/sites/22/2018/05/13085258/0533-Nufarm-Weedmaster-DUO-Herbicide.pdf";
const PHALARIS_100L = "rate_v1_4efec198ead373a3286939ced245fadf";
const PHALARIS_DIRECTION = "direction_v1_1363f3205ca7b639cd5f970a03d91785";

describe("fixture is the real record", () => {
  it("keeps source order, counts and candidate status", () => {
    const s = ROW.verification_sources as any[];
    expect(s[3].kind).toBe("manufacturer_label");
    expect(s[3].reference).toMatch(/data\.gov\.au/);
    expect(s[6].reference).toBe(NUFARM_PDF);
    expect((ROW.registered_uses as any[]).length).toBe(582);
    expect((ROW.verification_unresolved_fields as any[]).length).toBe(32);
    expect(ROW.review_status).toBe("candidate");
  });
});

describe("1. label resolution on the raw row", () => {
  it("offers the Nufarm PDF, not the earlier data.gov.au API references", () => {
    expect(masterManufacturerLabel(ROW)?.url).toBe(NUFARM_PDF);
  });
  it("keeps the API references as evidence", () => {
    const urls = masterLabelTargets(ROW).map((t) => t.url);
    expect(urls.some((u) => /resource_id=80289270/.test(u))).toBe(true);
    expect(masterLabelTargets(ROW).find((t) => /80289270/.test(t.url))?.kind).not.toBe("manufacturer_label");
  });
  it("does not mutate the stored row", () => {
    const before = JSON.stringify(ROW);
    masterLabelTargets(ROW);
    expect(JSON.stringify(ROW)).toBe(before);
  });
});

describe("2. release eligibility vs completeness", () => {
  it("has no release blockers; unresolved label fields stay as warnings", () => {
    expect(masterReleaseBlockers(ROW)).toEqual([]);
    const warnings = masterReleaseWarnings(ROW).map((w) => w.field);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings).toContain("re_entry_period_hours");
    expect(masterIssues(ROW).length).toBe(warnings.length);
  });

  it("approves a local clone with no correction write; the input stays candidate", async () => {
    const save = vi.fn();
    const approve = vi.fn().mockResolvedValue({});
    const row = clone();
    const res = await approveWithCorrections(
      {
        row,
        identity: {
          registered_product_name: row.registered_product_name ?? "",
          registrant: row.registrant ?? "",
          product_category: row.product_category ?? "",
          form_type: row.form_type ?? "",
          label_reference: "",
        },
        reason: "Local mocked release check",
      },
      { save, approve },
    );
    expect(res.outcome).toBe("approved");
    expect(save).not.toHaveBeenCalled();
    expect(approve).toHaveBeenCalledWith(ROW.id, "Local mocked release check");
    expect(ROW.review_status).toBe("candidate");
  });

  it("still blocks on a real blocker (evidence conflict)", async () => {
    const row = { ...clone(), verification_conflicts: [{ field: "x" }] } as MasterChemicalRow;
    expect(masterReleaseBlockers(row).map((b) => b.key)).toContain("conflict");
  });
});

describe("3. option -> selection -> save payload -> read-back", () => {
  const hit = normaliseMasterSearchHit(ROW)!;
  const phalaris = hit.rates.find((r) => r.source_id === PHALARIS_100L)!;

  it("binds the flat Phalaris rate to its registered direction via rate_id", () => {
    expect(phalaris).toMatchObject({
      basis: "per_100_litres",
      kind: "range",
      min_value: 500,
      max_value: 1000,
      unit: "mL",
      label: "Handgun",
      target: "Phalaris",
      direction_id: PHALARIS_DIRECTION,
      crop: "Vineyards",
    });
    expect(phalaris.conditions).toMatch(/PERENNIAL WEED CONTROL/);
  });

  it("never auto-selects among the ambiguous directions", () => {
    const init = initialiseDefaultRatesFromMaster(hit.rates);
    expect(init.selections.per_hectare).toBeNull();
    expect(init.selections.per_100_litres).toBeNull();
    expect(init.ambiguous.per_100_litres.length).toBeGreaterThan(1);
  });

  it("without backend canonical options the choice saves as an honest manual rate", () => {
    expect(hit.defaultRateOptions).toBeNull();
    const sel = selectionFromMasterRate(phalaris, { selected_at: "2026-10-01T00:00:00Z", label_version: hit.labelVersion })!;
    expect(sel).toMatchObject({ entry_method: "manual", option_key: "", rate_ids: [], min_value: 500, max_value: 1000, unit: "mL" });
    const payload = buildMasterSavedChemicalInput(hit, persistedDefaultRates({ per_100_litres: sel }));
    expect(payload.master_chemical_id).toBe(ROW.id);
    const back = decodePersistedDefaultRates(JSON.parse(JSON.stringify(payload.default_rates)));
    expect(back?.per_100_litres).toMatchObject({ min_value: 500, max_value: 1000, unit: "mL", basis: "per_100_litres" });
  });

  it("with a backend canonical option citing the rate_id, saves it canonically", () => {
    const withOptions = normaliseMasterSearchHit({
      ...clone(),
      default_rate_options: {
        per_hectare: [],
        per_100_litres: [
          {
            option_key: "default_option_v1_mocked_phalaris",
            rate_ids: [PHALARIS_100L],
            basis: "per_100_litres",
            unit: "mL",
            value: null,
            min_value: 500,
            max_value: 1000,
          },
        ],
      },
    })!;
    const r = withOptions.rates.find((x) => x.source_id === PHALARIS_100L)!;
    const sel = selectionFromMasterRate(r, { selected_at: null, label_version: null }, withOptions.defaultRateOptions)!;
    expect(sel).toMatchObject({ entry_method: "canonical", option_key: "default_option_v1_mocked_phalaris", rate_ids: [PHALARIS_100L] });
    const payload = buildMasterSavedChemicalInput(withOptions, persistedDefaultRates({ per_100_litres: sel }));
    const back = decodePersistedDefaultRates(JSON.parse(JSON.stringify(payload.default_rates)));
    expect(back?.per_100_litres?.rate_ids).toEqual([PHALARIS_100L]);
    expect(back?.per_100_litres?.entry_method).toBe("canonical");
  });

  it("excluded Knapsack/Wiper 'other' bases never become options", () => {
    expect(parseMasterViticultureRates(ROW.viticulture_rates).every((r) => r.basis !== ("other" as any))).toBe(true);
  });
});

describe("4. Rork-confirmed canonical Phalaris option (default_option_v1_5f58…)", () => {
  const OPTION = "default_option_v1_5f58b1d9f422213e1ecf8632036c1356";
  const hit = normaliseMasterSearchHit({
    ...clone(),
    default_rate_options: {
      per_hectare: [],
      per_100_litres: [
        { option_key: OPTION, rate_ids: [PHALARIS_100L], basis: "per_100_litres", unit: "mL", value: null, min_value: 500, max_value: 1000 },
      ],
    },
  })!;
  const r = hit.rates.find((x) => x.source_id === PHALARIS_100L)!;

  it("displays Phalaris Handgun bound to its direction", () => {
    expect(r).toMatchObject({ min_value: 500, max_value: 1000, unit: "mL", basis: "per_100_litres", direction_id: PHALARIS_DIRECTION, target: "Phalaris", label: "Handgun" });
  });

  it("saves and reads back with the canonical option and rate identity", () => {
    const sel = selectionFromMasterRate(r, { selected_at: "2026-10-01T00:00:00Z", label_version: hit.labelVersion }, hit.defaultRateOptions)!;
    const payload = buildMasterSavedChemicalInput(hit, persistedDefaultRates({ per_100_litres: sel }));
    expect(payload.master_chemical_id).toBe(ROW.id);
    const back = decodePersistedDefaultRates(JSON.parse(JSON.stringify(payload.default_rates)))!;
    expect(back.per_100_litres).toMatchObject({ entry_method: "canonical", option_key: OPTION, rate_ids: [PHALARIS_100L], min_value: 500, max_value: 1000, unit: "mL", basis: "per_100_litres" });
    console.log("PAYLOAD", JSON.stringify(payload.default_rates));
  });

  it("keeps both bases and all 32 unresolved entries", () => {
    expect(new Set(hit.rates.map((x) => x.basis))).toEqual(new Set(["per_hectare", "per_100_litres"]));
    expect((ROW.verification_unresolved_fields as any[]).length).toBe(32);
    expect(hit.structured.verification_unresolved_fields).toHaveLength(32);
  });
});
