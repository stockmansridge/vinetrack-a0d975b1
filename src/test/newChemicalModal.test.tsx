// New Chemical modal — presentation contract.
//
// Covers the vineyard-first information hierarchy: candidate messaging that
// matches the ACTUAL result count, grapevine-only normal rendering with the
// other crops collapsed, separate rate bases, and manufacturer-first label
// ordering with no silent APVMA substitution.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { candidatePrompt } from "@/lib/chemicalSearchMessaging";
import type { ChemicalSearchResponse } from "@/lib/chemicalSearchFlow";
import { requiresCandidateSelection } from "@/lib/chemicalSearchFlow";
import {
  partitionRegisteredUses,
  useRateLines,
} from "@/lib/chemicalGrapevineUses";
import {
  MANUFACTURER_LABEL_UNRESOLVED,
  resolveChemicalLabelLinks,
} from "@/lib/chemicalLabelLinks";
import { GrapevineUsesCard } from "@/components/chemicals/GrapevineUsesCard";
import type { WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";

const candidate = (i: number, name: string) => ({
  index: i,
  productName: name,
  // Registered identity — messaging for name-only candidates is covered in
  // chemicalLookupBoundary.test.tsx.
  registrationNumber: `9000${i}`,
  ranking: {} as any,
  serverRanked: true,
  raw: {},
});

const res = (
  count: number,
  summary?: ChemicalSearchResponse["summary"],
): ChemicalSearchResponse => ({
  candidates: Array.from({ length: count }, (_, i) => candidate(i, `Product ${i}`)) as any,
  serverRanked: true,
  summary: summary ?? null,
  diagnostics: null,
});

describe("candidate messaging", () => {
  it("never claims multiple matches for a single candidate", () => {
    const p = candidatePrompt(res(1, { autoSelectAllowed: false }));
    expect(p.kind).toBe("confirm_single");
    expect(p.title).toBe("Possible registered product");
    expect(p.detail).toBe("Confirm this is the product you use.");
  });

  it("asks for a selection when several candidates matched", () => {
    const p = candidatePrompt(res(3));
    expect(p.title).toBe("Possible registered products");
    expect(p.detail).toBe("Select the correct registration.");
  });

  it("reports an exact backend match plainly", () => {
    expect(candidatePrompt(res(1, { autoSelectAllowed: true })).title).toBe(
      "Registered product found",
    );
    expect(candidatePrompt(res(1, { searchState: "exact" })).title).toBe(
      "Registered product found",
    );
  });

  it("offers manual entry when nothing matched", () => {
    const p = candidatePrompt(res(0));
    expect(p.title).toBe("No registered product found");
    expect(p.detail).toBe("Enter manually");
  });

  it("honours the server auto-select flag for single results", () => {
    expect(requiresCandidateSelection(res(1, { autoSelectAllowed: true }))).toBe(false);
    expect(requiresCandidateSelection(res(1, { autoSelectAllowed: false }))).toBe(true);
    expect(requiresCandidateSelection(res(1))).toBe(true);
    expect(requiresCandidateSelection(res(2, { autoSelectAllowed: true }))).toBe(true);
  });
});

const grapeUse: WriteRegisteredUse = {
  crop: "Grapevines",
  target_raw: "European Red Mite",
  rates: [
    { basis: "per_100_litres", unit: "L", value: 3, condition: "NSW / Vic / SA" },
    { basis: "per_hectare", unit: "L", value: 30 },
  ],
  withholding_period_days: 14,
  re_entry_period_hours: 12,
} as WriteRegisteredUse;

const peachUse: WriteRegisteredUse = {
  crop: "Peach",
  target_raw: "Scale",
  rates: [{ basis: "per_100_litres", unit: "L", value: 2 }],
} as WriteRegisteredUse;

describe("grapevine projection", () => {
  it("splits grapevine uses from every other crop", () => {
    const { grapevine, other } = partitionRegisteredUses([grapeUse, peachUse]);
    expect(grapevine).toHaveLength(1);
    expect(other).toHaveLength(1);
    expect(other[0].crop).toBe("Peach");
  });

  it("trusts a backend grapevine flag over the crop text", () => {
    const flagged = { ...peachUse, extra: { is_grapevine: true } } as WriteRegisteredUse;
    expect(partitionRegisteredUses([flagged]).grapevine).toHaveLength(1);
  });

  it("keeps /100 L and /ha rates separate and unconverted", () => {
    const lines = useRateLines(grapeUse);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toContain("/100 L");
    expect(lines[1].text).toContain("/ha");
  });
});

describe("GrapevineUsesCard", () => {
  it("shows grapevine uses and collapses other crops in a full-label review", () => {
    render(<GrapevineUsesCard uses={[grapeUse, peachUse]} showOtherCrops />);
    expect(screen.getByText("European Red Mite")).toBeTruthy();
    expect(screen.queryByText("Peach")).toBeNull();
    fireEvent.click(screen.getByText(/Other crops on this label \(1\)/));
    expect(screen.getByText("Peach")).toBeTruthy();
  });

  it("states clearly when no grapevine rate was resolved", () => {
    render(<GrapevineUsesCard uses={[peachUse]} />);
    expect(
      screen.getByText("No registered grapevine rate was resolved from the label."),
    ).toBeTruthy();
  });
});

describe("label links", () => {
  it("never substitutes the regulator label for a manufacturer label", () => {
    const links = resolveChemicalLabelLinks({
      sources: [
        { kind: "official_register", name: "APVMA PubCRIS", reference: "https://apvma.gov.au/33182" },
      ] as any,
      labelReference: "https://apvma.gov.au/33182",
    });
    expect(links.manufacturerLabelUrl).toBeUndefined();
    expect(links.manufacturerResolved).toBe(false);
    expect(links.regulatorLabelUrl).toBe("https://apvma.gov.au/33182");
    expect(MANUFACTURER_LABEL_UNRESOLVED).toBe("Manufacturer label not resolved");
  });

  it("prefers a real manufacturer label when the backend resolved one", () => {
    const links = resolveChemicalLabelLinks({
      sources: [
        { kind: "manufacturer_label", name: "Vicol label", reference: "https://vicchem.com/label.pdf" },
        { kind: "official_register", name: "APVMA", reference: "https://apvma.gov.au/33182" },
      ] as any,
      productUrl: "https://vicchem.com/product",
    });
    expect(links.manufacturerLabelUrl).toBe("https://vicchem.com/label.pdf");
    expect(links.regulatorLabelUrl).toBe("https://apvma.gov.au/33182");
    expect(links.productUrl).toBe("https://vicchem.com/product");
  });
});
