// Reports tab contract: confirmed-only RPC data, Total Carbon default,
// method/unit series never mixed, safe colour scale, no-data blocks render.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  pickDefaultSeries,
  seriesForAnalyte,
  seriesKey,
  summariseMapReport,
  valueScaleColor,
  labStatusMapColor,
  labStatusLabel,
  formatMapValue,
  SOIL_MAP_NO_DATA_COLOR,
  type SoilReportSeries,
  type SoilMapReportRow,
} from "@/lib/soilAnalysis";

const page = readFileSync("src/pages/admin/SoilAnalysisPage.tsx", "utf8");
const tab = readFileSync("src/components/soil-analysis/ReportsTab.tsx", "utf8");
const map = readFileSync("src/components/soil-analysis/SoilReportMap.tsx", "utf8");

const series = (over: Partial<SoilReportSeries> = {}): SoilReportSeries => ({
  analyte_key: "total_carbon",
  analyte_name: "Total Carbon",
  category: "Carbon",
  method: "Dry combustion",
  unit: "%",
  desired_direction: "higher",
  block_count: 3,
  sample_count: 5,
  first_sampled_at: "2025-01-01",
  latest_sampled_at: "2026-02-01",
  ...over,
});

const row = (over: Partial<SoilMapReportRow> = {}): SoilMapReportRow => ({
  paddock_id: "p1",
  paddock_name: "Block 1",
  polygon_points: [],
  sample_id: "s1",
  sampled_at: "2026-01-15",
  laboratory: "Lab A",
  lab_sample_id: "L-1",
  sample_depth_from_cm: 0,
  sample_depth_to_cm: 10,
  value_numeric: 1.2,
  value_text: null,
  lab_range_min: 1,
  lab_range_max: 2,
  lab_range_text: null,
  lab_status: "within_range",
  extraction_confidence: 0.9,
  previous_sample_id: "s0",
  previous_sampled_at: "2025-01-10",
  previous_value_numeric: 1.0,
  ...over,
});

describe("series selection", () => {
  it("defaults to Total Carbon when present, otherwise the first series", () => {
    const ph = series({ analyte_key: "ph", analyte_name: "pH" });
    const tc = series();
    expect(pickDefaultSeries([ph, tc])?.analyte_key).toBe("total_carbon");
    expect(pickDefaultSeries([ph])?.analyte_key).toBe("ph");
    expect(pickDefaultSeries([])).toBeNull();
  });
  it("separates method/unit variants of the same analyte", () => {
    const a = series({ method: "Walkley-Black", unit: "%" });
    const b = series({ method: "Dry combustion", unit: "%" });
    const variants = seriesForAnalyte([a, b], "total_carbon");
    expect(variants).toHaveLength(2);
    expect(seriesKey(a)).not.toBe(seriesKey(b));
  });
});

describe("value colour scale", () => {
  it("handles no values, one value and equal values without divide-by-zero", () => {
    expect(valueScaleColor(NaN, NaN, NaN)).toBe(SOIL_MAP_NO_DATA_COLOR);
    const single = valueScaleColor(1.5, 1.5, 1.5);
    expect(single).toMatch(/^#[0-9a-f]{6}$/);
    expect(valueScaleColor(2, 2, 2)).toBe(single);
  });
  it("is monotonic light → dark across a range", () => {
    const low = valueScaleColor(0, 0, 10);
    const high = valueScaleColor(10, 0, 10);
    expect(low).toBe("#e3f2e8");
    expect(high).toBe("#1b7a43");
    expect(low).not.toBe(high);
  });
  it("clamps out-of-range values instead of throwing", () => {
    expect(valueScaleColor(99, 0, 10)).toBe("#1b7a43");
  });
});

describe("map summary statistics", () => {
  it("counts blocks with data and computes min/median/max/average", () => {
    const stats = summariseMapReport([
      row({ value_numeric: 1 }),
      row({ paddock_id: "p2", value_numeric: 2 }),
      row({ paddock_id: "p3", value_numeric: 3, sampled_at: "2026-03-01" }),
      row({ paddock_id: "p4", value_numeric: null, sample_id: null, sampled_at: null }),
    ]);
    expect(stats.totalBlocks).toBe(4);
    expect(stats.withData).toBe(3);
    expect(stats.min).toBe(1);
    expect(stats.median).toBe(2);
    expect(stats.max).toBe(3);
    expect(stats.average).toBe(2);
    expect(stats.latestSampledAt).toBe("2026-03-01");
  });
  it("returns nulls when nothing is sampled", () => {
    const stats = summariseMapReport([row({ value_numeric: null, sampled_at: null })]);
    expect(stats.withData).toBe(0);
    expect(stats.min).toBeNull();
    expect(stats.median).toBeNull();
    expect(stats.average).toBeNull();
  });
});

describe("lab status mode", () => {
  it("uses only the laboratory's own status categories", () => {
    expect(labStatusMapColor("low")).not.toBe(SOIL_MAP_NO_DATA_COLOR);
    expect(labStatusMapColor("within_range")).not.toBe(SOIL_MAP_NO_DATA_COLOR);
    expect(labStatusMapColor("high")).not.toBe(SOIL_MAP_NO_DATA_COLOR);
    expect(labStatusMapColor(null)).toBe(SOIL_MAP_NO_DATA_COLOR);
    expect(labStatusMapColor("something-invented")).toBe(SOIL_MAP_NO_DATA_COLOR);
    expect(labStatusLabel(null)).toBe("Not stated");
  });
});

describe("Reports tab wiring", () => {
  it("the Reports tab is enabled on the page", () => {
    expect(page).toContain('<TabsTrigger value="reports">Reports</TabsTrigger>');
    expect(page).toContain("<ReportsTab");
    expect(page).not.toMatch(/value="reports"[^>]*disabled/);
  });
  it("uses the two confirmed-only reporting RPCs and passes the as-of date", () => {
    const lib = readFileSync("src/lib/soilAnalysis.ts", "utf8");
    expect(lib).toContain('"soil_analysis_report_series"');
    expect(lib).toContain('"soil_analysis_map_report"');
    expect(lib).toContain("p_as_of");
  });
  it("forces an explicit series choice when methods/units differ", () => {
    expect(tab).toContain("analyteSeries.length > 1");
    expect(tab).toContain("Choose a series…");
  });
  it("reuses the existing MapKit stack — no second mapping library", () => {
    expect(map).toContain('from "@/lib/mapkit"');
    expect(map).not.toMatch(/leaflet|maplibre|google\.maps/i);
  });
  it("renders no-data blocks in neutral grey and never interpolates", () => {
    expect(map).toContain("SOIL_MAP_NO_DATA_COLOR");
    const code = map
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/interpolat|heatmap/i);
  });
  it("block detail and table expose date, depth, status, previous value and the sample link", () => {
    for (const needle of [
      "Sampled",
      "Depth",
      "labStatusLabel",
      "Previous",
      "Open soil sample",
      "deltaLabel",
    ]) {
      expect(tab).toContain(needle);
    }
  });
  it("value formatting is compact and safe", () => {
    expect(formatMapValue(1.234567)).toBe("1.23");
    expect(formatMapValue(null)).toBe("—");
  });
});
