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
  EXTRACTION_FAILED_MESSAGE,
  cleanExtractionDetail,
  type SoilSample,
  type SoilSampleResult,
} from "@/lib/soilAnalysis";

const result = (over: Partial<SoilSampleResult>): SoilSampleResult =>
  ({
    id: "r1",
    sample_id: "s1",
    analyte_key: "p",
    original_analyte_name: "Phosphorus",
    display_name: "Phosphorus (Colwell)",
    method: "Colwell",
    unit: "mg/kg",
    source_value_numeric: 42,
    source_value_text: null,
    value_numeric: 42,
    value_text: null,
    lab_range_min: 20,
    lab_range_max: 60,
    lab_range_text: null,
    lab_status: "within_range",
    desired_value_numeric: null,
    source_page: 1,
    source_section: null,
    extraction_confidence: 0.9,
    is_user_verified: false,
    is_user_corrected: false,
    notes: null,
    sort_order: 1,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...over,
  }) as SoilSampleResult;

const sample = (over: Partial<SoilSample>): SoilSample =>
  ({
    id: "s1",
    vineyard_id: "v1",
    paddock_id: "b1",
    lab_paddock_name: "Back Paddock",
    sample_scope: "whole_block",
    row_start: null,
    row_end: null,
    latitude: null,
    longitude: null,
    sampled_at: "2026-01-15",
    received_at: null,
    reported_at: null,
    sample_depth_from_cm: 0,
    sample_depth_to_cm: 10,
    laboratory: "Lab A",
    lab_code: null,
    order_number: null,
    lab_sample_id: "L-1",
    client_agronomist: null,
    crop: null,
    soil_type: null,
    notes: null,
    extraction_status: "pending",
    extraction_confidence: null,
    mapping_confidence: null,
    created_by: null,
    verified_by: null,
    verified_at: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    deleted_at: null,
    ...over,
  }) as SoilSample;

describe("upload validation", () => {
  it("accepts PDF and image reports", () => {
    expect(validateSoilUpload({ name: "report.pdf", type: "application/pdf", size: 1024 })).toBeNull();
    expect(validateSoilUpload({ name: "scan.JPG", type: "image/jpeg", size: 1024 })).toBeNull();
    expect(validateSoilUpload({ name: "scan.webp", type: "image/webp", size: 1024 })).toBeNull();
  });
  it("rejects other file types and files over 15 MB", () => {
    expect(validateSoilUpload({ name: "data.xlsx", type: "application/vnd.ms-excel", size: 1024 })).toMatch(/PDF, JPG, PNG or WebP/);
    expect(validateSoilUpload({ name: "big.pdf", type: "application/pdf", size: 16 * 1024 * 1024 })).toMatch(/15 MB/);
  });
});

describe("review edit payloads preserve provenance", () => {
  it("sample patch keeps only editable metadata/mapping fields", () => {
    const patch = buildSamplePatch({
      laboratory: "Lab B",
      sample_scope: "row_range",
      row_start: 3,
      row_end: 7,
      extraction_status: "confirmed", // lifecycle is not portal-editable via patch
      created_by: "someone",
      id: "hack",
    });
    expect(patch).toEqual({ laboratory: "Lab B", sample_scope: "row_range", row_start: 3, row_end: 7 });
  });

  it("result patch strips provenance keys and marks user correction", () => {
    const patch = buildResultPatch({
      value_numeric: 45,
      analyte_key: "p_colwell",
      is_user_verified: true,
      source_value_numeric: 99, // provenance — must be dropped
      source_value_text: "99",
      original_analyte_name: "Hacked",
      source_page: 9,
    });
    expect(patch).toEqual({
      value_numeric: 45,
      analyte_key: "p_colwell",
      is_user_verified: true,
      is_user_corrected: true,
    });
  });

  it("result patch cannot overwrite method, unit, lab range or lab status", () => {
    const patch = buildResultPatch({
      value_numeric: 45,
      method: "Mehlich 3",
      unit: "%",
      lab_range_min: 1,
      lab_range_max: 9,
      lab_status: "high",
    });
    expect(patch).toEqual({ value_numeric: 45, is_user_corrected: true });
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
  it("classifies direction only from catalogue desired_direction", () => {
    expect(classifyChange(10, 14, "context_only").direction).toBe("not_classified");
    expect(classifyChange(10, 14, "range").direction).toBe("not_classified");
    expect(classifyChange(10, 14, null).direction).toBe("not_classified");
    expect(classifyChange(10, 14, "higher").direction).toBe("improving");
    expect(classifyChange(10, 14, "lower").direction).toBe("declining");
    expect(classifyChange(10, 10, "higher").direction).toBe("steady");
  });
});

describe("compare matrix", () => {
  it("flags mixed methods across blocks and keeps latest result per block", () => {
    const rows = [
      { ...result({ method: "Colwell" }), sample: sample({ paddock_id: "b1", sampled_at: "2026-01-01" }) },
      { ...result({ id: "r2", method: "Colwell", value_numeric: 50 }), sample: sample({ id: "s2", paddock_id: "b1", sampled_at: "2026-02-01" }) },
      { ...result({ id: "r3", method: "Mehlich 3" }), sample: sample({ id: "s3", paddock_id: "b2", sampled_at: "2026-01-20" }) },
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

describe("extraction failure presentation", () => {
  const RAW_OPENAI_ERROR = `Edge function returned 500: Error, {"error":"extraction_failed","detail":"openai_400:{\n  \"error\": {\n    \"message\": \"Invalid 'input[0].content[1].file_data'.\",\n    \"type\": \"invalid_request_error\"\n  }\n}"}`;

  it("keeps one concise main message for every failure", () => {
    expect(EXTRACTION_FAILED_MESSAGE).toBe(
      "Extraction failed. The report is preserved — retry when ready.",
    );
  });

  it("extracts the human message from a nested OpenAI/edge error", () => {
    expect(cleanExtractionDetail(RAW_OPENAI_ERROR)).toBe(
      "Invalid 'input[0].content[1].file_data'.",
    );
  });

  it("cleans a prefixed provider detail without an outer edge wrapper", () => {
    const raw = `openai_400:{"error":{"message":"The report file could not be read."}}`;
    expect(cleanExtractionDetail(raw)).toBe("The report file could not be read.");
  });

  it("keeps a plain human detail as one line", () => {
    expect(cleanExtractionDetail("OpenAI quota exceeded for the organisation.")).toBe(
      "OpenAI quota exceeded for the organisation.",
    );
  });

  it("collapses embedded newlines and runs of whitespace", () => {
    expect(cleanExtractionDetail("Parser could not\n  read  page 1 of the report.")).toBe(
      "Parser could not read page 1 of the report.",
    );
  });

  it("returns null for codes, raw JSON and empty values — main message only", () => {
    expect(cleanExtractionDetail("extraction_failed")).toBeNull();
    expect(cleanExtractionDetail('{"error":"extraction_failed"}')).toBeNull();
    expect(cleanExtractionDetail("")).toBeNull();
    expect(cleanExtractionDetail(null)).toBeNull();
    expect(cleanExtractionDetail(undefined)).toBeNull();
  });
});
