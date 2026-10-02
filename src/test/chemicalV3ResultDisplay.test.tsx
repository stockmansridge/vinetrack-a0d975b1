import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { splitRates, formatRateOption, textOf } from "@/lib/chemicalV3";
import { RateColumn, V3Warnings, VineyardUseCard, V3DataSummary } from "@/components/chemicals/V3ReviewData";
import fs from "node:fs";

const opt = (i: number, basis: string) => ({ id: `${basis}-${i}`, basis, min_value: 3, max_value: 6, unit: basis === "per_hectare" ? "L/ha" : "mL/100 L", targets: ["Phalaris"], methods: ["Handgun"], condition: "Use lower rate where only knockdown is required" });
const record = {
  default_rate_options: {
    per_hectare: Array.from({ length: 12 }, (_, i) => opt(i, "per_hectare")),
    per_100_litres: Array.from({ length: 9 }, (_, i) => opt(i, "per_100_litres")),
  },
  vineyard_rates: [{ basis: "per_ha", rate_text: "legacy" }],
};

describe("V3 first live result display", () => {
  it("ReviewSheet reads default_rate_options before legacy names", () => {
    const src = fs.readFileSync("src/pages/admin/ChemicalV3LabPage.tsx", "utf8");
    expect(src).toContain('pick(r, "default_rate_options", "vineyard_rates", "rates")');
    expect(src).not.toMatch(/uses\.map\(\(u, i\) => <li key=\{i\}>\{labelOf/);
  });
  it("renders 12 per-hectare and 9 per-100 L cards", () => {
    const rates = splitRates(record.default_rate_options);
    render(<><V3DataSummary uses={2} perHa={rates.perHa.length} per100L={rates.per100L.length} /><RateColumn title="Per hectare" items={rates.perHa} testId="ha" /><RateColumn title="Per 100 litres" items={rates.per100L} testId="l" /></>);
    expect(within(screen.getByTestId("ha")).getAllByTestId("v3-rate-card")).toHaveLength(12);
    expect(within(screen.getByTestId("l")).getAllByTestId("v3-rate-card")).toHaveLength(9);
    expect(screen.getByTestId("v3-data-summary").textContent).toContain("Per hectare options: 12");
  });
  it("vineyard uses never render JSON and targets collapse behind Show all", () => {
    const targets = Array.from({ length: 35 }, (_, i) => `Weed ${i + 1}`);
    const { container } = render(<VineyardUseCard use={{ crop: "Vineyards", targets, application_directions: "Apply as a directed or shielded spray", restrictions: "DO NOT apply near vines less than 3 years old", withholding_statement: "WITHHOLDING PERIOD: NOT REQUIRED WHEN USED AS DIRECTED", rates: [{ value: 1 }] }} />);
    expect(container.textContent).not.toMatch(/[{}"]/);
    expect(container.textContent).toContain("+30 more");
    expect(screen.queryByText(/Weed 6\b/)).toBeNull();
    expect(container.textContent).not.toContain("NOT REQUIRED WHEN USED AS DIRECTED");
    fireEvent.click(screen.getByText("Show all 35"));
    fireEvent.click(screen.getByText("Withholding / re-entry"));
    expect(container.textContent).toContain("Weed 35");
    expect(container.textContent).toContain("NOT REQUIRED WHEN USED AS DIRECTED");
  });
  it("formats range, value and raw_text", () => {
    expect(formatRateOption({ min_value: 500, max_value: 1000, unit: "mL/100 L" })).toBe("500–1000 mL/100 L");
    expect(formatRateOption({ value: 3, unit: "L/ha" })).toBe("3 L/ha");
    expect(formatRateOption({ raw_text: "See label for rate" })).toBe("See label for rate");
    expect(textOf({ foo: 1 })).toBe("");
  });
  it("rate cards keep rate, target, short method visible and collapse long text", () => {
    const { container } = render(<RateColumn title="Per hectare" items={[opt(1, "per_hectare"), { ...opt(2, "per_hectare"), condition: "" }]} />);
    const [a, b] = screen.getAllByTestId("v3-rate-card");
    expect(a.textContent).toContain("3–6 L/ha");
    expect(a.textContent).toContain("Phalaris");
    expect(a.textContent).toContain("Handgun");
    expect(container.textContent).not.toContain("knockdown");
    expect(within(b).queryByText("Restrictions / conditions")).toBeNull();
    fireEvent.click(within(a).getByText("Restrictions / conditions"));
    expect(a.textContent).toContain("knockdown");
    expect(b.textContent).not.toContain("knockdown");
  });
  it("long method moves into collapsed Application instructions", () => {
    const long = "Apply as a directed spray using a shielded boom avoiding vine contact";
    render(<RateColumn title="x" items={[{ ...opt(1, "per_hectare"), methods: [long] }]} />);
    expect(screen.queryByText(long)).toBeNull();
    fireEvent.click(screen.getByText("Application instructions"));
    expect(screen.getByText(long)).toBeTruthy();
  });
  it("warnings stay visible in amber", () => {
    render(<V3Warnings warnings={[{ message: "Perennial-rate transcription may be partial" }, "Second warning"]} />);
    const w = screen.getByTestId("v3-warnings");
    expect(w.className).toContain("bg-warning/10");
    expect(w.textContent).toContain("Perennial-rate transcription may be partial");
    expect(w.textContent).toContain("Second warning");
  });
});
