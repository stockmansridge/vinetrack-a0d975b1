// Rate-gate safeguard: a new registered lookup with no usable backend
// default_rate_options must offer a corrective path, never a bare disabled Save.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  MISSING_RATE_OPTIONS_MESSAGE,
  hasUsableRateOptions,
  showMissingRateOptionsRecovery,
} from "@/lib/chemicalRateOptionsRecovery";
import { MissingRateOptionsPanel } from "@/components/chemicals/MissingRateOptionsPanel";
import { lookupSaveBlocked } from "@/lib/chemicalVineyardScope";
import type { WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";

const grapeUse = {
  crop: "Grapevines",
  target_raw: "Powdery mildew",
  rates: [],
} as unknown as WriteRegisteredUse;

const show = (over: Partial<Parameters<typeof showMissingRateOptionsRecovery>[0]> = {}) =>
  showMissingRateOptionsRecovery({
    isExistingRecord: false,
    selectionMode: "registered",
    grapevineRegistered: true,
    options: null,
    ...over,
  });

describe("rate-gate safeguard visibility", () => {
  it("shows when a new registered lookup returned no options", () => {
    expect(show()).toBe(true);
    expect(show({ selectionMode: "master" })).toBe(true);
    expect(show({ options: { per_hectare: [], per_100_litres: [] } })).toBe(true);
  });

  it("hides for existing records, manual entry and usable options", () => {
    expect(show({ isExistingRecord: true })).toBe(false);
    expect(show({ selectionMode: "manual" })).toBe(false);
    expect(show({ grapevineRegistered: false })).toBe(false);
    expect(
      show({
        options: {
          per_hectare: [{ option_key: "k", basis: "per_hectare" } as any],
          per_100_litres: [],
        },
      }),
    ).toBe(false);
  });

  it("counts usable options only when the backend supplied one", () => {
    expect(hasUsableRateOptions(null)).toBe(false);
    expect(hasUsableRateOptions({ per_hectare: [], per_100_litres: [] })).toBe(false);
  });

  it("keeps the structured save gate disabled regardless of the panel", () => {
    expect(
      lookupSaveBlocked({
        isExistingRecord: false,
        selectionMode: "registered",
        uses: [grapeUse],
        defaults: null,
        staleDefaultRate: false,
      }),
    ).toBe(true);
  });
});

describe("rate-gate safeguard actions", () => {
  const setup = (over: Partial<React.ComponentProps<typeof MissingRateOptionsPanel>> = {}) => {
    const props = {
      labelUrl: "https://example.test/label.pdf",
      canRetry: true,
      onRetry: vi.fn(),
      onManual: vi.fn(),
      onChangeProduct: vi.fn(),
      ...over,
    };
    render(<MissingRateOptionsPanel {...props} />);
    return props;
  };

  it("states the exact message and offers all four actions", () => {
    setup();
    expect(screen.getByText(MISSING_RATE_OPTIONS_MESSAGE)).toBeTruthy();
    expect(screen.getByText("Retry label details")).toBeTruthy();
    expect(screen.getByText("Open official label")).toBeTruthy();
    expect(screen.getByText("Enter manually")).toBeTruthy();
    expect(screen.getByText("Change product")).toBeTruthy();
  });

  it("retries label details without re-running a search", () => {
    const p = setup();
    fireEvent.click(screen.getByText("Retry label details"));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  it("opens the official label as a plain link (no write)", () => {
    setup();
    const link = screen.getByText("Open official label").closest("a");
    expect(link?.getAttribute("href")).toBe("https://example.test/label.pdf");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("disables the label action when no label URL is known", () => {
    setup({ labelUrl: null });
    expect(screen.getByText("Open official label").closest("a")).toBeNull();
  });

  it("explains manual entry becomes an unverified record", () => {
    const p = setup();
    expect(screen.getByText(/unverified manual record/i)).toBeTruthy();
    fireEvent.click(screen.getByText("Enter manually"));
    expect(p.onManual).toHaveBeenCalledTimes(1);
  });

  it("changes product through the shared clearing path", () => {
    const p = setup();
    fireEvent.click(screen.getByText("Change product"));
    expect(p.onChangeProduct).toHaveBeenCalledTimes(1);
  });

  it("disables retry when no registration is pinned", () => {
    const p = setup({ canRetry: false });
    fireEvent.click(screen.getByText("Retry label details"));
    expect(p.onRetry).not.toHaveBeenCalled();
  });
});
