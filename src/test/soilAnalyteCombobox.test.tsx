// Searchable analyte combobox shared by Trends, Compare and Reports.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  SoilAnalyteCombobox,
  analyteMatches,
  ANALYTE_NO_RESULTS,
  type SoilAnalyteOption,
} from "@/components/soil-analysis/SoilAnalyteCombobox";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView ??= () => {};
});

const options: SoilAnalyteOption[] = [
  { key: "calcium_ppm", name: "Calcium", category: "Cations" },
  { key: "magnesium_ppm", name: "Magnesium", category: "Cations" },
  { key: "total_carbon_pct", name: "Total Carbon", category: "Organic matter" },
  { key: "ph_cacl2", name: "pH (CaCl2)", category: "Acidity" },
];

const open = (onChange = vi.fn()) => {
  render(<SoilAnalyteCombobox options={options} value="calcium_ppm" onChange={onChange} ariaLabel="Test analyte" />);
  fireEvent.click(screen.getByRole("combobox", { name: "Test analyte" }));
  return { onChange, input: screen.getByPlaceholderText("Search analytes…") };
};
const visible = () => screen.queryAllByRole("option").map((o) => o.textContent);

describe("SoilAnalyteCombobox", () => {
  it("trigger shows selected name or placeholder", () => {
    const { rerender } = render(<SoilAnalyteCombobox options={options} value="" onChange={() => {}} ariaLabel="A" />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Choose an analyte…");
    rerender(<SoilAnalyteCombobox options={options} value="total_carbon_pct" onChange={() => {}} ariaLabel="A" />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Total Carbon");
  });
  it("renders the search input at the top", () => {
    const { input } = open();
    expect(input).toBeInTheDocument();
  });
  it("filters by display name", () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: "magn" } });
    expect(visible()).toEqual(["Magnesium"]);
  });
  it("filters by canonical key", () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: "carbon_pct" } });
    expect(visible()).toEqual(["Total Carbon"]);
  });
  it("filters by category", () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: "CATIONS" } });
    expect(visible()).toEqual(["Calcium", "Magnesium"]);
  });
  it("keeps category grouping", () => {
    open();
    for (const h of ["Cations", "Organic matter", "Acidity"]) expect(screen.getByText(h)).toBeInTheDocument();
  });
  it("selection returns the exact analyte key", () => {
    const { onChange } = open();
    fireEvent.click(screen.getByRole("option", { name: /pH \(CaCl2\)/ }));
    expect(onChange).toHaveBeenCalledWith("ph_cacl2");
  });
  it("shows the no-results message", () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(screen.getByText(ANALYTE_NO_RESULTS)).toBeInTheDocument();
    expect(ANALYTE_NO_RESULTS).toBe("No matching analytes.");
  });
  it("matcher is case-insensitive", () => {
    expect(analyteMatches(options[0], "CALCIUM")).toBe(true);
    expect(analyteMatches(options[0], "calcium ppm")).toBe(true);
  });
});

describe("tabs use the searchable picker", () => {
  for (const [file, label] of [
    ["TrendsTab", "Trend analyte"],
    ["CompareTab", "Compare analyte"],
    ["ReportsTab", "Report analyte"],
  ]) {
    it(`${file} uses SoilAnalyteCombobox, not a plain analyte select`, () => {
      const src = readFileSync(`src/components/soil-analysis/${file}.tsx`, "utf8");
      expect(src).toContain("<SoilAnalyteCombobox");
      expect(src).toContain(`ariaLabel="${label}"`);
      expect(src).not.toMatch(/<select[^>]*aria-label="(Trend|Compare|Report) analyte"/);
    });
  }
  it("Compare still uses presentAnalytes", () => {
    const src = readFileSync("src/components/soil-analysis/CompareTab.tsx", "utf8");
    expect(src).toContain("options={presentAnalytes.map(");
  });
});
