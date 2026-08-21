// Stage 4 evidence UI verification — AU official-label payload, APVMA 91636.
//
// Read-only verification: the fixture mirrors the live Stage 4 production
// payload shape (official-label WHP + grape claims, rates and re-entry left
// unresolved, label_reference null, record still a candidate). No production
// code is changed by this file.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MasterEvidencePanel } from "@/components/chemicals/MasterEvidencePanel";
import { masterEvidenceFields, masterEvidenceSources } from "@/lib/masterEvidence";
import { masterChemicalDraft, type MasterChemicalRow } from "@/lib/masterChemicals";

const ROW: MasterChemicalRow = {
  id: "m-91636",
  registration_country: "AU",
  registration_scheme: "APVMA",
  registration_number: "91636",
  registration_identity_key: "AU:APVMA:91636",
  registered_product_name: "Custodia Forte Fungicide",
  registrant: "ADAMA Australia Pty Limited",
  review_status: "candidate",
  verification_status: "partially_verified",
  active_ingredients: [
    {
      name: "Azoxystrobin",
      concentration: 120,
      concentration_unit: "g/L",
      identity_source: "official_register",
      group_source: "authoritative_classification",
      activity_group: { scheme: "frac", code: "11" },
    },
    {
      name: "Tebuconazole",
      concentration: 200,
      concentration_unit: "g/L",
      identity_source: "official_register",
      group_source: "authoritative_classification",
      activity_group: { scheme: "frac", code: "3" },
    },
  ],
  registered_uses: [
    { crop: "Grapevines", target_raw: "Powdery mildew", rates: [], withholding_period_days: 28 },
    { crop: "Grapevines", target_raw: "Botrytis (bunch rot)", rates: [], withholding_period_days: 28 },
    { crop: "Grapevines", target_raw: "Downy mildew", rates: [], withholding_period_days: 28 },
  ],
  label_reference: null,
  label_version: null,
  catalogue_version: 3,
  verification_sources: [
    {
      kind: "official_register",
      name: "APVMA PUBCRIS registration 91636",
      reference: "https://portal.apvma.gov.au/pubcris?p_=91636",
      retrieved_at: "2026-08-19T00:00:00Z",
    },
    {
      kind: "manufacturer_label",
      name: "Approved product label — Custodia Forte Fungicide",
      retrieved_at: "2026-08-19T00:00:00Z",
    },
  ],
  verification_conflicts: [],
  verification_unresolved_fields: ["rates", "re_entry_period_hours"],
};

describe("Stage 4 evidence UI — APVMA 91636", () => {
  it("keeps the grape Powdery/Botrytis/Downy claims in the decoded record", () => {
    const draft = masterChemicalDraft(ROW);
    expect(draft.registeredUses.map((u) => u.target_raw)).toEqual([
      "Powdery mildew",
      "Botrytis (bunch rot)",
      "Downy mildew",
    ]);
    expect(draft.registeredUses.every((u) => u.crop === "Grapevines")).toBe(true);
    expect(draft.registeredUses.map((u) => u.target)).toEqual([
      "powdery_mildew",
      "botrytis",
      "downy_mildew",
    ]);
  });

  it("shows WHP as 28 days, sourced from the official label", () => {
    const f = masterEvidenceFields(ROW).find((x) => x.key === "withholding_period_days")!;
    expect(f.level).toBe("official_label");
    expect(f.value).toBe("28 days");
  });

  it("shows the grape claims as official-label evidence", () => {
    const f = masterEvidenceFields(ROW).find((x) => x.key === "registered_uses")!;
    expect(f.value).toBe("3 registered use(s)");
    expect(f.level).toBe("official_label");
  });

  it("shows rates and re-entry as unresolved, never as verified values", () => {
    const fields = masterEvidenceFields(ROW);
    const rates = fields.find((x) => x.key === "rates")!;
    const rei = fields.find((x) => x.key === "re_entry_period_hours")!;
    expect(rates.level).toBe("unresolved");
    expect(rates.value).toBeNull();
    expect(rei.level).toBe("unresolved");
    expect(rei.value).toBeNull();
  });

  it("renders a null label_reference as unresolved text with no link", () => {
    const { container } = render(<MasterEvidencePanel row={ROW} />);
    const label = masterEvidenceFields(ROW).find((x) => x.key === "label_reference")!;
    expect(label.value).toBeNull();
    expect(label.level).toBe("unresolved");
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs.every((h) => !!h && h.startsWith("http"))).toBe(true);
  });

  it("lists readable evidence sources with their provenance level", () => {
    const sources = masterEvidenceSources(ROW);
    expect(sources.map((s) => s.level)).toEqual(["official_register", "official_label"]);
    render(<MasterEvidencePanel row={ROW} />);
    expect(screen.getAllByText(/APVMA PUBCRIS registration 91636/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Approved product label — Custodia Forte Fungicide/).length,
    ).toBeGreaterThan(0);
  });

  it("surfaces unresolved fields without declaring the whole record invalid", () => {
    render(<MasterEvidencePanel row={ROW} />);
    expect(screen.getByText(/Unresolved fields \(2\)/)).toBeTruthy();
    expect(screen.getAllByText(/rates/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/re_entry_period_hours/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No evidence sources recorded/)).toBeNull();
  });
});
