// Label-link parity + manual-rate coexistence regressions.
//
// One resolved official-label URL per selected product. "Open official label"
// (recovery panel) and "Open APVMA label" (Labels & references) must always be
// the SAME href, and a `label_reference` must never become `label_url`.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import {
  OPEN_MANUFACTURER_LABEL,
  OPEN_PRODUCT_PAGE,
  OPEN_REGISTRATION_SOURCE,
  OPEN_REGULATOR_LABEL,
  resolveChemicalLabelLinks,
} from "@/lib/chemicalLabelLinks";
import { MissingRateOptionsPanel } from "@/components/chemicals/MissingRateOptionsPanel";
import { ManualRateEditor } from "@/components/chemicals/ManualRateEditor";
import { emptyManualRateDraft } from "@/lib/chemicalManualRate";

const REGULATOR = "https://portal.apvma.gov.au/elabel/12345.pdf";
const REFERENCE = "https://portal.apvma.gov.au/pubcris?registration=33182";
const MANUFACTURER_LABEL = "https://maker.test/labels/product.pdf";
const PRODUCT_PAGE = "https://maker.test/products/product";

const links = (over: Parameters<typeof resolveChemicalLabelLinks>[0] = {}) =>
  resolveChemicalLabelLinks({
    labelUrl: REGULATOR,
    labelReference: REFERENCE,
    manufacturerLabelUrl: MANUFACTURER_LABEL,
    productUrl: PRODUCT_PAGE,
    ...over,
  });

/** Mirrors the sheet: ONE resolved link set feeds both surfaces. */
function LabelSurfaces({
  resolved,
  manualOpen = false,
}: {
  resolved: ReturnType<typeof resolveChemicalLabelLinks>;
  manualOpen?: boolean;
}) {
  return (
    <div>
      <MissingRateOptionsPanel
        labelUrl={resolved.regulatorLabelUrl ?? null}
        canRetry
        manualOpen={manualOpen}
        onRetry={vi.fn()}
        onManual={vi.fn()}
        onChangeProduct={vi.fn()}
      />
      {manualOpen && (
        <ManualRateEditor draft={{ ...emptyManualRateDraft(), open: true }} onChange={vi.fn()} onCancel={vi.fn()} />
      )}
      {resolved.regulatorLabelUrl && (
        <a href={resolved.regulatorLabelUrl}>{OPEN_REGULATOR_LABEL}</a>
      )}
      {resolved.manufacturerLabelUrl && (
        <a href={resolved.manufacturerLabelUrl}>{OPEN_MANUFACTURER_LABEL}</a>
      )}
      {resolved.registrationSourceUrl && (
        <a href={resolved.registrationSourceUrl}>{OPEN_REGISTRATION_SOURCE}</a>
      )}
      {resolved.productUrl && <a href={resolved.productUrl}>{OPEN_PRODUCT_PAGE}</a>}
    </div>
  );
}

const href = (text: string) => screen.getByText(text).closest("a")?.getAttribute("href");

describe("one authoritative official-label URL", () => {
  it("gives Open official label and Open APVMA label identical hrefs", () => {
    render(<LabelSurfaces resolved={links()} />);
    expect(href("Open official label")).toBe(REGULATOR);
    expect(href("Open official label")).toBe(href(OPEN_REGULATOR_LABEL));
  });

  it("keeps manufacturer label, registration source and product page separate", () => {
    render(<LabelSurfaces resolved={links()} />);
    expect(href(OPEN_MANUFACTURER_LABEL)).toBe(MANUFACTURER_LABEL);
    expect(href(OPEN_REGISTRATION_SOURCE)).toBe(REFERENCE);
    expect(href(OPEN_PRODUCT_PAGE)).toBe(PRODUCT_PAGE);
    expect(href(OPEN_MANUFACTURER_LABEL)).not.toBe(REGULATOR);
    expect(href(OPEN_REGISTRATION_SOURCE)).not.toBe(REGULATOR);
  });

  it("never fabricates or relabels an APVMA label when none was resolved", () => {
    render(<LabelSurfaces resolved={links({ labelUrl: null })} />);
    expect(screen.queryByText(OPEN_REGULATOR_LABEL)).toBeNull();
    expect(screen.getByText("Open official label").closest("a")).toBeNull();
    // The reference stays a reference — it is never promoted to a label.
    expect(href(OPEN_REGISTRATION_SOURCE)).toBe(REFERENCE);
  });

  it("never promotes label_reference into the regulator label URL", () => {
    expect(links({ labelUrl: null }).regulatorLabelUrl).toBeUndefined();
    const source = readFileSync("src/components/chemicals/ChemicalEditorSheet.tsx", "utf8");
    expect(source).not.toMatch(/label_url:\s*\n?\s*r\.fields\.regulatorLabelUrl\s*\?\?\s*\(?r?\.?fields\.labelReference/);
    expect(source).not.toMatch(/label_url:[\s\S]{0,120}label_reference/);
  });
});

describe("manual rate entry keeps the label controls", () => {
  it("retains retry, official label and change product while typing a rate", () => {
    render(<LabelSurfaces resolved={links()} manualOpen />);
    expect(screen.getByText("Retry label details")).toBeTruthy();
    expect(screen.getByText("Open official label")).toBeTruthy();
    expect(screen.getByText("Change product")).toBeTruthy();
    expect(screen.getByText("Enter the rate manually")).toBeTruthy();
  });

  it("does not alter any resolved URL when manual entry opens", () => {
    const resolved = links();
    const closed = render(<LabelSurfaces resolved={resolved} />);
    const before = href("Open official label");
    closed.unmount();
    render(<LabelSurfaces resolved={resolved} manualOpen />);
    expect(href("Open official label")).toBe(before);
    expect(href(OPEN_REGULATOR_LABEL)).toBe(REGULATOR);
    expect(href(OPEN_MANUFACTURER_LABEL)).toBe(MANUFACTURER_LABEL);
    expect(href(OPEN_REGISTRATION_SOURCE)).toBe(REFERENCE);
    expect(href(OPEN_PRODUCT_PAGE)).toBe(PRODUCT_PAGE);
  });

  it("drops every Product A URL before Product B is applied", () => {
    const cleared = resolveChemicalLabelLinks({
      labelUrl: null,
      labelReference: null,
      manufacturerLabelUrl: null,
      productUrl: null,
    });
    expect(cleared).toMatchObject({
      regulatorLabelUrl: undefined,
      manufacturerLabelUrl: undefined,
      registrationSourceUrl: undefined,
      productUrl: undefined,
      manufacturerResolved: false,
    });
  });
});
