import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MasterChemicalRow } from "@/lib/masterChemicals";
import {
  buildMasterCurationPatch,
  encodeMasterViticultureRates,
  filterMasterQueue,
  masterLabelTargets,
  masterMissingFields,
  masterNeedsAttention,
  masterRateCoverage,
  masterRateProblems,
  newMasterRate,
  nextAttentionId,
  nextQueueId,
  parseMasterViticultureRates,
  primaryMasterLabelTarget,
  removeMasterRate,
  setMasterRateKind,
  upsertMasterRate,
} from "@/lib/masterCuration";

const complete = (over: Partial<MasterChemicalRow> = {}): MasterChemicalRow => ({
  id: "c1",
  registered_product_name: "Prosaro 420 SC",
  registration_number: "63243",
  registration_country: "AU",
  registration_scheme: "apvma",
  product_category: "fungicide",
  review_status: "candidate",
  active_ingredients: [{ name: "Prothioconazole", concentration: 210, concentration_unit: "g/L" }],
  label_reference: "https://elabels.apvma.gov.au/90279ELBL.pdf",
  viticulture_rates: [{ basis: "per_100_litres", kind: "range", min_value: 240, max_value: 320, unit: "mL" }],
  ...over,
});

/* ------------------------------------------------------- missing fields */

describe("missing-field calculation", () => {
  it("reports nothing missing for a complete record", () => {
    expect(masterMissingFields(complete())).toEqual([]);
    expect(masterNeedsAttention(complete())).toBe(false);
  });

  it("reports each core field that is blank", () => {
    const row = complete({
      registered_product_name: "  ",
      registration_number: null,
      product_category: "",
      active_ingredients: [],
      label_reference: null,
      viticulture_rates: [],
    });
    expect(masterMissingFields(row)).toEqual([
      "registered_product_name",
      "registration_number",
      "product_category",
      "active_ingredients",
      "label",
      "viticulture_rates",
    ]);
  });

  it("never requires registered_uses", () => {
    expect(masterMissingFields(complete({ registered_uses: [] }))).toEqual([]);
  });

  it("treats an unusable rate as no vineyard rate", () => {
    const row = complete({ viticulture_rates: [{ basis: "per_hectare", value: 0, unit: "" }] });
    expect(masterRateCoverage(row).any).toBe(false);
    expect(masterMissingFields(row)).toContain("viticulture_rates");
  });
});

/* ------------------------------------------------------------ filtering */

describe("queue filtering", () => {
  const rows = [
    complete({ id: "ok" }),
    complete({ id: "no-rate", viticulture_rates: [] }),
    complete({ id: "no-label", label_reference: null }),
    complete({ id: "approved-ok", review_status: "approved" }),
  ];

  it("defaults to needs attention and excludes complete records", () => {
    expect(filterMasterQueue(rows, "needs_attention").map((r) => r.id)).toEqual(["no-rate", "no-label"]);
  });

  it("supports the targeted gap filters and status filters", () => {
    expect(filterMasterQueue(rows, "missing_rate").map((r) => r.id)).toEqual(["no-rate"]);
    expect(filterMasterQueue(rows, "missing_label").map((r) => r.id)).toEqual(["no-label"]);
    expect(filterMasterQueue(rows, "approved").map((r) => r.id)).toEqual(["approved-ok"]);
    expect(filterMasterQueue(rows, "all")).toHaveLength(4);
  });

  it("keeps the product-name / APVMA search", () => {
    expect(filterMasterQueue(rows, "all", "63243")).toHaveLength(4);
    expect(filterMasterQueue(rows, "all", "prosaro")).toHaveLength(4);
    expect(filterMasterQueue(rows, "all", "custodia")).toHaveLength(0);
  });
});

/* --------------------------------------------------------- label access */

describe("label link selection", () => {
  it("prefers the manufacturer label over the APVMA label", () => {
    const row = complete({
      verification_sources: [
        { kind: "manufacturer_label", name: "Bayer", reference: "https://bayer.example/prosaro-label.pdf" },
      ],
    });
    expect(primaryMasterLabelTarget(row)?.kind).toBe("manufacturer_label");
    expect(masterLabelTargets(row).map((t) => t.kind)).toContain("regulator_label");
  });

  it("falls back to the APVMA label reference", () => {
    expect(primaryMasterLabelTarget(complete())?.url).toBe(
      "https://elabels.apvma.gov.au/90279ELBL.pdf",
    );
  });

  it("never offers an SDS as a label", () => {
    const row = complete({
      label_reference: null,
      verification_sources: [
        { kind: "manufacturer_label", name: "SDS", reference: "https://x.example/prosaro-SDS.pdf" },
      ],
    });
    expect(primaryMasterLabelTarget(row)).toBeNull();
    expect(masterMissingFields(row)).toContain("label");
  });
});

/* -------------------------------------------------------------- rates */

describe("viticulture rate editing", () => {
  it("parses a range without collapsing it", () => {
    const [rate] = parseMasterViticultureRates(complete().viticulture_rates);
    expect(rate.kind).toBe("range");
    expect([rate.min_value, rate.max_value]).toEqual([240, 320]);
    expect(rate.value).toBeNull();
    expect(rate.basis).toBe("per_100_litres");
  });

  it("adds, edits and deletes rates per basis without converting between them", () => {
    let rates = parseMasterViticultureRates(complete().viticulture_rates);
    const added = { ...newMasterRate("per_hectare"), value: 2.4, unit: "L" as const };
    rates = [...rates, added];
    expect(masterRateCoverage(rates)).toEqual({ perHectare: true, per100Litres: true, any: true });

    rates = upsertMasterRate(rates, { ...added, value: 3 });
    expect(rates.find((r) => r.id === added.id)?.value).toBe(3);
    expect(rates.find((r) => r.basis === "per_100_litres")?.min_value).toBe(240);

    rates = removeMasterRate(rates, added.id);
    expect(masterRateCoverage(rates).perHectare).toBe(false);
  });

  it("does not reuse the other shape's numbers when switching single↔range", () => {
    const single = { ...newMasterRate("per_hectare"), value: 2.4, unit: "L" as const };
    const asRange = setMasterRateKind(single, "range");
    expect(asRange.min_value).toBeNull();
    expect(asRange.max_value).toBeNull();
    expect(masterRateProblems(asRange).length).toBeGreaterThan(0);
  });

  it("validates required rate numbers and units", () => {
    expect(masterRateProblems(newMasterRate("per_hectare"))).toHaveLength(2);
    expect(
      masterRateProblems({
        ...newMasterRate("per_hectare"),
        kind: "range",
        min_value: 5,
        max_value: 2,
        unit: "L",
      }),
    ).toEqual(["The maximum must be the same as or greater than the minimum."]);
  });

  it("encodes each basis separately and drops unusable rows", () => {
    const encoded = encodeMasterViticultureRates([
      ...parseMasterViticultureRates(complete().viticulture_rates),
      { ...newMasterRate("per_hectare"), value: 2.4, unit: "L" },
      newMasterRate("per_hectare"),
    ]);
    expect(encoded).toEqual([
      { basis: "per_100_litres", kind: "range", unit: "mL", value: null, min_value: 240, max_value: 320, label: null },
      { basis: "per_hectare", kind: "single", unit: "L", value: 2.4, min_value: null, max_value: null, label: null },
    ]);
  });
});

/* -------------------------------------------------------------- patches */

describe("curation patch", () => {
  it("only sends changed fields", () => {
    const row = complete({ product_category: null });
    expect(
      buildMasterCurationPatch({
        row,
        identity: { registered_product_name: "Prosaro 420 SC", product_category: "fungicide" },
        reason: "review",
      }),
    ).toEqual({ product_category: "fungicide" });
  });

  it("includes viticulture rates only when they changed", () => {
    const row = complete();
    const unchanged = parseMasterViticultureRates(row.viticulture_rates);
    expect(buildMasterCurationPatch({ row, identity: {}, rates: unchanged, reason: "r" })).toEqual({});
    const changed = [...unchanged, { ...newMasterRate("per_hectare"), value: 2.4, unit: "L" as const }];
    expect(
      buildMasterCurationPatch({ row, identity: {}, rates: changed, reason: "r" }).viticulture_rates,
    ).toHaveLength(2);
  });
});

/* ------------------------------------------------------- queue movement */

describe("Save & Next / Approve & Next movement", () => {
  const queue = [
    complete({ id: "a", viticulture_rates: [] }),
    complete({ id: "b" }),
    complete({ id: "c", label_reference: null }),
  ];

  it("Save & Next moves to the next record in the filtered queue", () => {
    expect(nextQueueId(queue, "a")).toBe("b");
    expect(nextQueueId(queue, "c")).toBeNull();
  });

  it("Approve & Next skips complete records and lands on the next gap", () => {
    expect(nextAttentionId(queue, "a")).toBe("c");
    expect(nextAttentionId(queue, "c")).toBe("a");
  });
});

/* ------------------------------------------------------ admin-only access */

vi.mock("@/lib/systemAdmin", () => ({
  useIsSystemAdmin: () => ({ isAdmin: false, loading: false }),
}));

describe("System Admin access", () => {
  it("keeps the review queue away from vineyard users", async () => {
    const { AdminGate } = await import("@/pages/admin/_shared");
    render(
      <MemoryRouter>
        <AdminGate>
          <div>Master queue</div>
        </AdminGate>
      </MemoryRouter>,
    );
    expect(screen.queryByText("Master queue")).toBeNull();
  });
});
