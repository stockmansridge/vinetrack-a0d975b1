// Screenshot-correction acceptance for the Chemical portal presentation.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { GrapevineUsesCard, groupGrapevineDirections } from "@/components/chemicals/GrapevineUsesCard";
import { VERIFICATION_LABEL, VERIFICATION_TOOLTIP, toChemicalIntelligence, activityGroupSummary } from "@/lib/chemicalIntelligence";
import {
  ACTIVITY_GROUP_TABLE_VERSION,
  canonicalActivityGroupCode,
  lookupActivityGroup,
} from "@/lib/activityGroupReference";
import { detectActivityGroupConflicts } from "@/lib/chemicalIntelligenceWrite";
import { resolveChemicalLabelLinks } from "@/lib/chemicalLabelLinks";
import type { WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";

const use = (o: Partial<WriteRegisteredUse> & Record<string, unknown>): WriteRegisteredUse =>
  ({ crop: "Grapevines", rates: [], ...o }) as WriteRegisteredUse;

const rated = (directionId: string, target: string): WriteRegisteredUse =>
  use({
    target_raw: target,
    extra: { direction_id: directionId },
    withholding_period_days: 14,
    re_entry_period_hours: 12,
    rates: [{ amount: { value: 2 }, unit: "L", basis: "per_hectare" } as any],
  });

describe("grapevine uses presentation", () => {
  it("starts collapsed with a target count and expands on demand", () => {
    render(<GrapevineUsesCard uses={[rated("d1", "Powdery mildew"), rated("d2", "Botrytis")]} />);
    expect(screen.getByText(/Grapevine uses & rates · 2 targets/)).toBeTruthy();
    expect(screen.queryByText(/Powdery mildew/)).toBeNull();
    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getByText(/Powdery mildew/)).toBeTruthy();
  });

  it("merges identical direction_id targets and never merges different ones", () => {
    const blocks = groupGrapevineDirections([
      rated("d1", "Powdery mildew"),
      rated("d1", "Downy mildew"),
      rated("d2", "Botrytis"),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].targets).toEqual(["Powdery mildew", "Downy mildew"]);
    expect(blocks[1].targets).toEqual(["Botrytis"]);
  });

  it("shows the missing-rate message once and no per-target Not resolved noise", () => {
    render(
      <GrapevineUsesCard
        uses={[use({ target_raw: "Powdery mildew" }), use({ target_raw: "Botrytis" })]}
      />,
    );
    expect(screen.getAllByText(/No registered grapevine rate was resolved/)).toHaveLength(1);
    fireEvent.click(screen.getByText("Show details"));
    expect(screen.queryByText(/Not resolved/)).toBeNull();
  });

  it("shows shared WHP/re-entry once and never other crops", () => {
    const { container } = render(
      <GrapevineUsesCard
        uses={[
          rated("d1", "Powdery mildew"),
          rated("d2", "Botrytis"),
          use({ crop: "Citrus", target_raw: "Scale" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByText("Show details"));
    expect(within(container).getAllByText(/WHP: 14 days/)).toHaveLength(1);
    expect(within(container).getAllByText(/Re-entry: 12 hours/)).toHaveLength(1);
    expect(screen.queryByText(/Citrus/)).toBeNull();
  });
});

describe("verification wording", () => {
  it("uses the customer-facing labels", () => {
    expect(VERIFICATION_LABEL).toEqual({
      verified: "Official label checked",
      partially_verified: "Label checked — details unavailable",
      needs_match: "Not checked",
      conflict: "Review required",
      unverified: "Not checked",
    });
    expect(VERIFICATION_TOOLTIP.partially_verified).toBe(
      "VineTrack checked official product information, but some label details were unavailable.",
    );
  });
});

describe("activity group reference v2 — flumioxazin", () => {
  const active = (code: string) => [
    {
      name: "Flumioxazin",
      activity_group: { scheme: "hrac" as const, code },
      group_source: "ai_interpretation" as const,
    },
  ];

  it("is table version 2 and classifies flumioxazin as HRAC 14", () => {
    expect(ACTIVITY_GROUP_TABLE_VERSION).toBe(2);
    expect(lookupActivityGroup("Flumioxazin")).toMatchObject({ scheme: "hrac", code: "14" });
  });

  it("treats legacy E, Australian legacy G and 14 as equivalent", () => {
    for (const code of ["E", "G", "14"]) {
      expect(canonicalActivityGroupCode("hrac", code)).toBe("14");
      expect(detectActivityGroupConflicts(active(code) as any)).toEqual([]);
    }
  });

  it("still reports an incorrect group as a conflict", () => {
    expect(detectActivityGroupConflicts(active("2") as any)).toHaveLength(1);
  });

  it("displays HRAC 14 for a stored legacy E, pre-save and post-save alike", () => {
    const beforeSave = toChemicalIntelligence({
      id: "c1",
      active_ingredients: [{ name: "Flumioxazin", activity_group: "HRAC E" }],
      verification_status: "partially_verified",
    });
    const afterSave = toChemicalIntelligence({
      id: "c1",
      active_ingredients: [{ name: "Flumioxazin", activity_group: "HRAC 14" }],
      verification_status: "partially_verified",
    });
    expect(activityGroupSummary(beforeSave)).toBe("HRAC 14");
    expect(activityGroupSummary(afterSave)).toBe("HRAC 14");
    expect(beforeSave.verification.status).toBe(afterSave.verification.status);
  });
});

describe("label links", () => {
  it("never presents a gazette/register citation as the product label", () => {
    const links = resolveChemicalLabelLinks({
      labelUrl: null,
      labelReference: "https://portal.apvma.gov.au/pubcris?number=33182",
      sources: [
        { kind: "official_register", reference: "https://portal.apvma.gov.au/pubcris?number=33182" } as any,
      ],
      productUrl: "https://maker.example/product",
    });
    expect(links.regulatorLabelUrl).toBeUndefined();
    expect(links.registrationSourceUrl).toBe("https://portal.apvma.gov.au/pubcris?number=33182");
    expect(links.productUrl).toBe("https://maker.example/product");
  });

  it("uses label_url as the actual regulator eLabel", () => {
    const links = resolveChemicalLabelLinks({
      labelUrl: "https://apvma.example/labels/33182.pdf",
      labelReference: "https://portal.apvma.gov.au/pubcris?number=33182",
    });
    expect(links.regulatorLabelUrl).toBe("https://apvma.example/labels/33182.pdf");
    expect(links.registrationSourceUrl).toBe("https://portal.apvma.gov.au/pubcris?number=33182");
  });
});
