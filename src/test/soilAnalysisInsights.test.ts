// Trend/Compare visual series policy, measured summaries, compare values and
// MapKit label priority for Soil Analysis.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  areResultsComparable,
  buildTrendSeries,
  buildDateAverages,
  summariseTrend,
  percentChange,
  labRangeChanged,
  compareSeriesOptions,
  buildValueComparison,
  sortValueComparison,
  summariseValueComparison,
  buildCompareMatrix,
  filterCompareMatrix,
  visualSeriesKey,
  soilMapLabelSpec,
  DEFAULT_SOIL_MAP_LABEL_MODE,
  TREND_PROVISIONAL_BADGE,
  COMPARE_PROVISIONAL_BADGE,
} from "@/lib/soilAnalysis";

let n = 0;
const pt = (over: { value: number; date: string; method?: string | null; unit?: string; key?: string; status?: string; min?: number | null; max?: number | null; name?: string; block?: string }) => {
  n++;
  const sample: any = {
    id: `s${n}`, paddock_id: null, sampled_at: over.date, created_at: over.date,
    lab_paddock_name: over.name ?? null, lab_sample_id: `L${n}`,
    sample_depth_from_cm: 0, sample_depth_to_cm: 15, laboratory: "Lab",
  };
  const result: any = {
    id: `r${n}`, sample_id: sample.id, analyte_key: over.key ?? "calcium_ppm",
    method: over.method ?? null, unit: over.unit ?? "ppm", value_numeric: over.value, value_text: null,
    lab_range_min: over.min ?? null, lab_range_max: over.max ?? null, lab_range_text: null,
    lab_status: over.status ?? "low",
  };
  return { result, sample, matched_paddock_id: over.block };
};
const live = () => [
  pt({ value: 1460, date: "2021-05-11", name: "PINOT NOIR #1" }),
  pt({ value: 1624, date: "2021-05-11", name: "PINOT NOIR #2" }),
  pt({ value: 1440, date: "2025-04-10", name: "ROW 70-109 WEST PINOT" }),
];

describe("trend series policy", () => {
  it("strict comparability is unchanged for null methods", () => {
    const [a, b] = live();
    expect(areResultsComparable(a.result, b.result).comparable).toBe(false);
  });
  it("three live-style calcium points with null method => ONE provisional group", () => {
    const groups = buildTrendSeries(live());
    expect(groups).toHaveLength(1);
    expect(groups[0].provisional).toBe(true);
    expect(groups[0].points).toHaveLength(3);
    expect(TREND_PROVISIONAL_BADGE).toBe("Method not recorded — visual trend only");
  });
  it("known method + null method remain separate", () => {
    const g = buildTrendSeries([pt({ value: 1, date: "2021-01-01", method: "Ammonium acetate" }), pt({ value: 2, date: "2022-01-01" })]);
    expect(g).toHaveLength(2);
  });
  it("different known methods remain separate", () => {
    expect(buildTrendSeries([pt({ value: 1, date: "2021-01-01", method: "Colwell" }), pt({ value: 2, date: "2022-01-01", method: "Mehlich" })])).toHaveLength(2);
  });
  it("different units remain separate", () => {
    expect(buildTrendSeries([pt({ value: 1, date: "2021-01-01", unit: "ppm" }), pt({ value: 2, date: "2022-01-01", unit: "cmol/kg" })])).toHaveLength(2);
  });
  it("same-date results stay two raw points and produce one average point", () => {
    const g = buildTrendSeries(live())[0];
    const avgs = buildDateAverages(g.points);
    expect(g.points.filter((p) => p.sample.sampled_at === "2021-05-11")).toHaveLength(2);
    expect(avgs).toEqual([
      { date: "2021-05-11", average: 1542, count: 2 },
      { date: "2025-04-10", average: 1440, count: 1 },
    ]);
  });
  it("percent change and summary sentence use measured language", () => {
    expect(percentChange(1542, 1440)).toBeCloseTo(-6.61, 2);
    expect(percentChange(0, 5)).toBeNull();
    const s = summariseTrend(buildTrendSeries(live())[0], "Calcium", "range");
    expect(s.delta).toBe(-102);
    const text = s.sentences.join(" ");
    expect(text).toContain("Latest Calcium value is 1440 ppm.");
    expect(text).toContain("The 2021 same-date average was 1542 ppm, so the measured value is 102 ppm lower (-6.6%).");
    expect(text).toContain("The latest laboratory status is Below lab range.");
    expect(text).toContain("Method was not recorded on these reports; treat the visual trend as provisional.");
  });
  it("range/context_only never say improving/declining", () => {
    for (const dir of ["range", "context_only", null] as const) {
      const text = summariseTrend(buildTrendSeries(live())[0], "Calcium", dir).sentences.join(" ").toLowerCase();
      expect(text).not.toContain("improving");
      expect(text).not.toContain("declining");
    }
  });
  it("reference range change is detected", () => {
    const pts = [pt({ value: 1, date: "2021-01-01", min: 1000, max: 2000 }), pt({ value: 2, date: "2022-01-01", min: 1200, max: 2400 })];
    expect(labRangeChanged(pts)).toBe(true);
    expect(summariseTrend(buildTrendSeries(pts)[0], "Ca", "range").sentences).toContain("Laboratory reference range changed between reports.");
    expect(labRangeChanged([pts[0], pt({ value: 3, date: "2023-01-01", min: 1000, max: 2000 })])).toBe(false);
  });
  it("only the selected series chart renders", () => {
    const trends = readFileSync("src/components/soil-analysis/TrendsTab.tsx", "utf8");
    expect(trends).not.toContain("groups.map(");
    expect(trends).not.toContain("Separate series — methods/units are not comparable");
    expect(trends.match(/<ComposedChart/g)).toHaveLength(1);
    expect(trends).toContain('aria-label="Trend series"');
    expect(trends).toContain("VineTrack-derived");
  });
});

describe("compare values", () => {
  const rows = () => [
    pt({ value: 10, date: "2025-01-01", block: "a" }),
    pt({ value: 30, date: "2025-01-02", block: "b" }),
    pt({ value: 20, date: "2024-01-01", block: "b" }),
    pt({ value: 99, date: "2025-01-01", block: "a", method: "Known" }),
  ].map((r) => ({ ...r.result, sample: r.sample, matched_paddock_id: r.matched_paddock_id }));
  it("Values is the default mode", () => {
    const src = readFileSync("src/components/soil-analysis/CompareTab.tsx", "utf8");
    expect(src).toContain('DEFAULT_COMPARE_MODE: CompareMode = "values"');
    expect(src).toContain("useState<CompareMode>(DEFAULT_COMPARE_MODE)");
    expect(src).toContain("Status overview");
    expect(src).toContain("Outside lab range only");
  });
  it("strict/provisional series never mix known and missing methods", () => {
    const opts = compareSeriesOptions(rows(), "calcium_ppm");
    expect(opts).toHaveLength(2);
    expect(opts[0].provisional).toBe(true);
    expect(COMPARE_PROVISIONAL_BADGE).toBe("Method not recorded — comparison is provisional");
  });
  it("one row per selected block, latest in series, no-result block retained", () => {
    const key = visualSeriesKey({ analyte_key: "calcium_ppm", method: null, unit: "ppm" });
    const out = buildValueComparison(rows(), ["a", "b", "c"], key);
    expect(out.map((r) => r.paddockId)).toEqual(["a", "b", "c"]);
    expect(out[0].result?.value_numeric).toBe(10);
    expect(out[1].result?.value_numeric).toBe(30);
    expect(out[2].result).toBeNull();
    const sorted = sortValueComparison(out, "value", (id) => id);
    expect(sorted.map((r) => r.paddockId)).toEqual(["b", "a", "c"]);
    const s = summariseValueComparison(out);
    expect(s).toMatchObject({ withData: 2, selected: 3, spread: 20 });
    expect(s.highest).toEqual({ paddockId: "b", value: 30 });
    expect(s.lowest).toEqual({ paddockId: "a", value: 10 });
  });
  it("status overview matrix is retained and filterable", () => {
    const r = [
      pt({ value: 1, date: "2025-01-01", block: "a", key: "ca", status: "within_range" }),
      pt({ value: 1, date: "2025-01-01", block: "a", key: "mg", status: "high" }),
    ].map((x) => ({ ...x.result, sample: x.sample, matched_paddock_id: x.matched_paddock_id }));
    const m = buildCompareMatrix(r, ["a"], ["ca", "mg"]);
    expect(filterCompareMatrix(m, { outsideOnly: true }).map((row) => row[0].analyteKey)).toEqual(["mg"]);
    expect(filterCompareMatrix(m, { category: "Cations", categoryOf: (k) => (k === "ca" ? "Cations" : "Other") }).map((row) => row[0].analyteKey)).toEqual(["ca"]);
  });
  it("multi-block mapping: one sample appears in each matched block", () => {
    const base = pt({ value: 5, date: "2025-01-01" });
    const r = ["a", "b"].map((block) => ({ ...base.result, sample: base.sample, matched_paddock_id: block }));
    const key = visualSeriesKey(base.result);
    expect(buildValueComparison(r, ["a", "b"], key).every((x) => x.result?.value_numeric === 5)).toBe(true);
  });
});

describe("map labels", () => {
  const map = readFileSync("src/components/soil-analysis/SoilReportMap.tsx", "utf8");
  const row = { paddock_name: "Primitivo", value_numeric: 0.534 };
  it("Smart is default", () => {
    expect(DEFAULT_SOIL_MAP_LABEL_MODE).toBe("smart");
    expect(map).toContain("labelMode = DEFAULT_SOIL_MAP_LABEL_MODE");
  });
  it("Smart uses short value labels at low priority with rectangle collision", () => {
    expect(soilMapLabelSpec(row, { mode: "smart", selected: false, unit: "%" })).toEqual({
      text: "0.53", priority: "low", collision: "rectangle", selected: false,
    });
    expect(map).toContain("mapkit.Annotation.CollisionMode.Rectangle");
    expect(map).toContain("mapkit.Annotation.DisplayPriority.Low");
  });
  it("selected uses Required priority and the full label", () => {
    expect(soilMapLabelSpec(row, { mode: "smart", selected: true, unit: "%" })).toMatchObject({ text: "Primitivo · 0.53 %", priority: "required" });
    expect(soilMapLabelSpec({ paddock_name: "Merlot", value_numeric: null }, { mode: "smart", selected: true, unit: "%" })?.text).toBe("Merlot · No confirmed value");
    expect(map).toContain("mapkit.Annotation.DisplayPriority.Required");
  });
  it("Off creates no labels; All creates required short labels; no-data omitted", () => {
    expect(soilMapLabelSpec(row, { mode: "off", selected: true, unit: "%" })).toBeNull();
    expect(soilMapLabelSpec(row, { mode: "all", selected: false, unit: "%" })).toMatchObject({ text: "0.53", priority: "required" });
    expect(soilMapLabelSpec({ paddock_name: "X", value_numeric: null }, { mode: "all", selected: false, unit: null })).toBeNull();
  });
  it("polygon click still selects when labels are hidden; no clustering", () => {
    const polyIdx = map.indexOf('poly.addEventListener("select"');
    const specIdx = map.indexOf("const spec = soilMapLabelSpec");
    expect(polyIdx).toBeGreaterThan(-1);
    expect(polyIdx).toBeLessThan(specIdx);
    expect(map).not.toMatch(/clusteringIdentifier/);
    expect(map).toContain("valueScaleColor(row.value_numeric, min, max)");
  });
});
