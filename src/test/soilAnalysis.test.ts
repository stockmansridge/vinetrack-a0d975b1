// Soil Analysis Stage 1 — provenance, upload validation and comparability.
import { describe, it, expect } from "vitest";
import {
  validateSoilUpload,
  buildSamplePatch,
  buildResultPatch,
  areResultsComparable,
  buildTrendGroups,
  classifyChange,
  buildCompareMatrix,
  isOutsideLabRange,
  labStatusLabel,
  type SoilSample,
  type SoilSampleResult,
} from "@/lib/soilAnalysis";

const result = (over: Partial<SoilSampleResult>): SoilSampleResult =>
  ({
    id: "r1",
    sample_id: "s1",
    source_analyte: "Phosphorus",
    source_method: "Colwell",
    source_unit: "mg/kg",
    source_value: "42",
    source_range_low: 20,
    source_range_high: 60,
    source_lab_status: "within_range",
    source_page: 1,
    analyte_key: "p",
    method: "Colwell",
    unit: "mg/kg",
    value_numeric: 42,
    value_text: null,
    lab_range_low: 20,
    lab_range_high: 60,
    lab_status: "within_range",
    confidence: 0.9,
    is_verified: false,
    is_user_corrected: false,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...over,
  }) as SoilSampleResult;

const sample = (over: Partial<SoilSample>): SoilSample =>
  ({
    id: "s1",
    vineyard_id: "v1",
    paddock_id: "b1",
    mapping_type: "block",
    row_from: null,
    row_to: null,
    point_lat: null,
    point_lng: null,
    sample_date: "2026-01-15",
    laboratory: "Lab A",
    lab_sample_id: "L-1",
    lab_paddock_name: "Back Paddock",
    depth_from_cm: 0,
    depth_to_cm: 10,
    status: "pending",
    extraction_status: "awaiting_extraction",
    notes: null,
    created_by: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...over,
  }) as SoilSample;

describe("upload validation", () => {
  it("accepts PDF and image reports", () => {
    expect(validateSoilUpload({ name: "report.pdf", type: "application/pdf", size: 1024 })).toBeNull();
    expect(validateSoilUpload({ name: "scan.JPG", type: "image/jpeg", size: 1024 })).toBeNull();
    expect(validateSoilUpload({ name: "scan.webp", type: "image/webp", size: 1024 })).toBeNull();
  });
  it("rejects other file types and oversized files", () => {
    expect(validateSoilUpload({ name: "data.xlsx", type: "application/vnd.ms-excel", size: 1024 })).toMatch(/PDF, JPG, PNG or WebP/);
    expect(validateSoilUpload({ name: "big.pdf", type: "application/pdf", size: 21 * 1024 * 1024 })).toMatch(/20 MB/);
  });
});

describe("review edit payloads preserve provenance", () => {
  it("sample patch keeps only editable metadata/mapping fields", () => {
    const patch = buildSamplePatch({
      laboratory: "Lab B",
      mapping_type: "row_range",
      row_from: 3,
      row_to: 7,
      extraction_status: "extracted", // not portal-editable
      created_by: "someone",
      id: "hack",
    });
    expect(patch).toEqual({ laboratory: "Lab B", mapping_type: "row_range", row_from: 3, row_to: 7 });
  });

  it("result patch strips source_* keys and marks user correction", () => {
    const patch = buildResultPatch({
      value_numeric: 45,
      analyte_key: "p_colwell",
      is_verified: true,
      source_value: "99", // provenance — must be dropped
      source_analyte: "Hacked",
      source_page: 9,
    });
    expect(patch).toEqual({
      value_numeric: 45,
      analyte_key: "p_colwell",
      is_verified: true,
      is_user_corrected: true,
    });
    expect(Object.keys(patch).some((k) => k.startsWith("source_"))).toBe(false);
  });
});

describe("comparability", () => {
  it("accepts same analyte, method and unit", () => {
    expect(areResultsComparable(result({}), result({ id: "r2" })).comparable).toBe(true);
  });
  it("refuses Colwell P vs Mehlich P", () => {
    const a = result({ method: "Colwell" });
    const b = result({ id: "r2", method: "Mehlich 3" });
    const c = areResultsComparable(a, b);
    expect(c.comparable).toBe(false);
    expect(c.reason).toMatch(/Different methods|Incompatible methods/);
  });
  it("refuses DTPA micronutrients vs other extractions", () => {
    const a = result({ analyte_key: "zn", method: "DTPA" });
    const b = result({ id: "r2", analyte_key: "zn", method: "HCl" });
    expect(areResultsComparable(a, b).comparable).toBe(false);
  });
  it("refuses unlike units and missing methods", () => {
    expect(
      areResultsComparable(result({ unit: "mg/kg" }), result({ id: "r2", unit: "%" })).comparable,
    ).toBe(false);
    expect(
      areResultsComparable(result({ method: null }), result({ id: "r2" })).comparable,
    ).toBe(false);
  });
  it("treats mg/kg and ppm as the same unit", () => {
    expect(
      areResultsComparable(result({ unit: "mg/kg" }), result({ id: "r2", unit: "ppm" })).comparable,
    ).toBe(true);
  });
});

describe("trend grouping and classification", () => {
  it("splits incompatible methods into separate series", () => {
    const points = [
      { result: result({ method: "Colwell" }), sample: sample({}) },
      { result: result({ id: "r2", method: "Mehlich 3" }), sample: sample({ id: "s2" }) },
      { result: result({ id: "r3", method: "Colwell" }), sample: sample({ id: "s3" }) },
    ];
    const groups = buildTrendGroups(points);
    expect(groups).toHaveLength(2);
    expect(groups[0].points).toHaveLength(2);
    expect(groups[1].points).toHaveLength(1);
  });
  it("classifies direction only with catalogue metadata", () => {
    expect(classifyChange(10, 14, null).direction).toBe("not_classified");
    expect(classifyChange(10, 14, true).direction).toBe("improving");
    expect(classifyChange(10, 14, false).direction).toBe("declining");
    expect(classifyChange(10, 10, true).direction).toBe("steady");
  });
});

describe("compare matrix", () => {
  it("flags mixed methods across blocks and keeps latest result per block", () => {
    const rows = [
      { ...result({ method: "Colwell" }), sample: sample({ paddock_id: "b1", sample_date: "2026-01-01" }) },
      { ...result({ id: "r2", method: "Colwell", value_numeric: 50 }), sample: sample({ id: "s2", paddock_id: "b1", sample_date: "2026-02-01" }) },
      { ...result({ id: "r3", method: "Mehlich 3" }), sample: sample({ id: "s3", paddock_id: "b2", sample_date: "2026-01-20" }) },
    ];
    const matrix = buildCompareMatrix(rows as any, ["b1", "b2"], ["p"]);
    expect(matrix).toHaveLength(1);
    const [row] = matrix;
    expect(row[0].result?.value_numeric).toBe(50); // latest for b1
    expect(row[0].mixedMethods).toBe(true);
    expect(row[1].result?.method).toBe("Mehlich 3");
  });
});

describe("lab status language", () => {
  it("labels green as within lab range, never a guarantee", () => {
    expect(labStatusLabel("within_range")).toBe("Within lab range");
    expect(isOutsideLabRange("low")).toBe(true);
    expect(isOutsideLabRange("high")).toBe(true);
    expect(isOutsideLabRange("within_range")).toBe(false);
  });
});
