// Gate D4B-P2B — DefaultRatesCard renders backend canonical options only.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DefaultRatesCard } from "@/components/chemicals/DefaultRatesCard";
import { decodeCanonicalDefaultRateOptions } from "@/lib/chemicalDefaultRatesContract";
import {
  emptyPersistedDefaultRates,
  matchDefaultRateSlots,
  selectionFromCanonicalOption,
  withBasisSelection,
} from "@/lib/chemicalDefaultRateSelection";
import vicol from "./fixtures/d4b-vicol-au.json";

const canonical = decodeCanonicalDefaultRateOptions((vicol as any).default_rate_options)!;
const threeL = canonical.per_100_litres[1];

describe("DefaultRatesCard (D4B-P2B)", () => {
  it("shows both /100 L options with nothing selected after a lookup", () => {
    render(
      <DefaultRatesCard
        options={canonical}
        slots={matchDefaultRateSlots(emptyPersistedDefaultRates(), canonical)}
        onSelect={() => {}}
        onClear={() => {}}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios.some((r) => r.getAttribute("aria-checked") === "true")).toBe(false);
    expect(screen.getByText(/3 L \/100 L/)).toBeTruthy();
  });

  it("reports the clicked option and its basis using the backend option_key", () => {
    const onSelect = vi.fn();
    render(
      <DefaultRatesCard
        options={canonical}
        slots={matchDefaultRateSlots(emptyPersistedDefaultRates(), canonical)}
        onSelect={onSelect}
        onClear={() => {}}
      />,
    );
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ option_key: threeL.option_key }),
      "per_100_litres",
    );
  });

  it("selects the matched option and offers a per-basis clear", () => {
    const onClear = vi.fn();
    const defaults = withBasisSelection(
      null,
      "per_100_litres",
      selectionFromCanonicalOption(threeL, {
        source: "operator",
        selectedAt: "2026-08-26T00:00:00.000Z",
        labelVersion: null,
      }),
    );
    render(
      <DefaultRatesCard
        options={canonical}
        slots={matchDefaultRateSlots(defaults, canonical)}
        onSelect={() => {}}
        onClear={onClear}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /clear saved default/i }));
    expect(onClear).toHaveBeenCalledWith("per_100_litres");
  });

  it("shows the saved snapshot without selecting anything when unavailable", () => {
    const defaults = withBasisSelection(
      null,
      "per_100_litres",
      selectionFromCanonicalOption(threeL, {
        source: "operator",
        selectedAt: null,
        labelVersion: null,
      }),
    );
    render(
      <DefaultRatesCard
        options={null}
        slots={matchDefaultRateSlots(defaults, null)}
        onSelect={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText(/not rechecked against the current label/i)).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("warns without substituting when the saved default no longer matches", () => {
    const defaults = withBasisSelection(
      null,
      "per_100_litres",
      selectionFromCanonicalOption(
        { ...threeL, option_key: "default_option_v1_ffffffffffffffffffffffffffffffff" },
        { source: "operator", selectedAt: null, labelVersion: null },
      ),
    );
    render(
      <DefaultRatesCard
        options={canonical}
        slots={matchDefaultRateSlots(defaults, canonical)}
        onSelect={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText(/no longer matches the current resolved label options/i)).toBeTruthy();
    expect(
      screen.getAllByRole("radio").some((r) => r.getAttribute("aria-checked") === "true"),
    ).toBe(false);
  });
});
