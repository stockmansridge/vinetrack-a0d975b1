// Chemical Store parity: saved Chemical Detail must expose the persisted
// intelligence, and WHP/REI/restrictions must never be inferred or zeroed.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  NOT_RESOLVED_LABEL,
  reEntryDisplayForUse,
  withholdingDisplayForUse,
  restrictionsDisplayForUse,
} from "@/lib/chemicalSafetyDisplay";
import { toChemicalIntelligence } from "@/lib/chemicalIntelligence";
import { ChemicalIntelligenceDetail } from "@/components/chemicals/ChemicalIntelligenceDialog";

const use = (o: Record<string, unknown>) => ({
  withholdingDays: null,
  withholdingText: null,
  withholdingPeriod: null,
  reEntryHours: null,
  reEntryPeriod: null,
  restrictions: null,
  ...o,
}) as any;

describe("WHP / REI honesty", () => {
  it("never turns a missing period into zero", () => {
    expect(withholdingDisplayForUse(use({}))).toBe(NOT_RESOLVED_LABEL);
    expect(reEntryDisplayForUse(use({}))).toBe(NOT_RESOLVED_LABEL);
  });

  it("treats an unsupported zero as unresolved", () => {
    expect(withholdingDisplayForUse(use({ withholdingDays: 0 }))).toBe(NOT_RESOLVED_LABEL);
    expect(reEntryDisplayForUse(use({ reEntryHours: 0 }))).toBe(NOT_RESOLVED_LABEL);
  });

  it("shows the label statement for an evidenced zero", () => {
    expect(
      withholdingDisplayForUse(
        use({ withholdingDays: 0, restrictions: "NOT REQUIRED WHEN USED AS DIRECTED" }),
      ),
    ).toBe("Not required when used as directed");
  });

  it("shows authoritative periods", () => {
    expect(withholdingDisplayForUse(use({ withholdingDays: 14 }))).toBe("14 days");
    expect(reEntryDisplayForUse(use({ reEntryHours: 1 }))).toBe("1 hour");
  });

  it("does not copy WHP into REI", () => {
    expect(reEntryDisplayForUse(use({ withholdingDays: 14 } as any))).toBe(NOT_RESOLVED_LABEL);
  });

  it("never invents 'no restrictions'", () => {
    expect(restrictionsDisplayForUse(use({}))).toBeNull();
    expect(restrictionsDisplayForUse(use({ restrictions: "Max 3 applications" }))).toBe(
      "Max 3 applications",
    );
  });
});

const ROW = {
  id: "c1",
  name: "Thiovit Jet",
  use: "Fungicide",
  manufacturer: "Syngenta",
  registration_number: "53904",
  registration_scheme: "apvma",
  registrant: "Syngenta Australia",
  verification_status: "verified",
  label_url: "https://example.com/label.pdf",
  product_url: "https://example.com/product",
  restrictions: "Do not graze treated areas.",
  active_ingredients: [{ name: "Sulfur", concentration: 800, unit: "g/kg", group: "FRAC M02" }],
  registered_uses: [
    {
      crop: "Grapevines",
      target: "Powdery mildew",
      rates: [
        { min: 100, max: 200, unit: "g", basis: "range_per_100_litres" },
        { min: 200, max: 600, unit: "g", basis: "range_per_100_litres" },
      ],
      withholding_period_days: 14,
      re_entry_period_hours: 12,
      restrictions: "Do not apply more than 6 times per season.",
    },
    { crop: "Grapevines", target: "Mites", rates: [] },
  ],
};

describe("Saved Chemical Detail", () => {
  it("shows identity, chemistry, uses, safety and documents", () => {
    render(<ChemicalIntelligenceDetail chem={toChemicalIntelligence(ROW)} />);

    expect(screen.getAllByText(/Thiovit Jet/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fungicide/).length).toBeGreaterThan(0);
    expect(screen.getByText(/APVMA 53904/)).toBeTruthy();
    expect(screen.getByText("Sulfur")).toBeTruthy();
    expect(screen.getByText(/800/)).toBeTruthy();
    expect(screen.getByText("Powdery mildew")).toBeTruthy();
    expect(screen.getByText("14 days")).toBeTruthy();
    expect(screen.getByText("12 hours")).toBeTruthy();
    expect(screen.getByText(/Do not graze treated areas/)).toBeTruthy();
    expect(screen.getByText("Product label / SDS")).toBeTruthy();
    expect(screen.getByText("Manufacturer product page")).toBeTruthy();
  });

  it("keeps distinct label ranges instead of merging them", () => {
    render(<ChemicalIntelligenceDetail chem={toChemicalIntelligence(ROW)} />);
    const rateCell = screen.getByText(/100–200/);
    expect(rateCell.textContent).toContain("200–600");
    expect(rateCell.textContent).not.toContain("100–600");
  });

  it("marks a use with no resolved rate or periods as unresolved, not zero", () => {
    render(<ChemicalIntelligenceDetail chem={toChemicalIntelligence(ROW)} />);
    expect(screen.getAllByText(NOT_RESOLVED_LABEL).length).toBeGreaterThan(0);
    expect(screen.queryByText("0 days")).toBeNull();
    expect(screen.queryByText("0 hours")).toBeNull();
  });
});
