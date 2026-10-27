// Multi-block mapping contract: soil_sample_block_mappings is the authority,
// one atomic RPC replaces mappings and synchronises legacy fields, and the
// Portal never writes sample_scope/paddock_id/row bounds directly for block
// coverage. Errors never render "[object Object]".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  validateBlockMappings,
  buildMappingPayload,
  mappingSummaryLabel,
  mappingSummaryLines,
  formatDataError,
  buildCompareMatrix,
  MAPPING_BLOCK_REQUIRED_MESSAGE,
  SAMPLE_SCOPE_LABEL,
  type SoilBlockMapping,
  type SoilBlockMappingInput,
} from "@/lib/soilAnalysis";

const lib = readFileSync("src/lib/soilAnalysis.ts", "utf8");
const detail = readFileSync("src/pages/admin/SoilSampleDetailPage.tsx", "utf8");
const list = readFileSync("src/components/soil-analysis/SamplesTab.tsx", "utf8");
const overview = readFileSync("src/components/soil-analysis/OverviewTab.tsx", "utf8");

const mapping = (over: Partial<SoilBlockMapping>): SoilBlockMapping =>
  ({
    id: "m1",
    sample_id: "s1",
    vineyard_id: "v1",
    paddock_id: "b1",
    mapping_scope: "whole_block",
    row_start: null,
    row_end: null,
    mapping_confidence: null,
    notes: null,
    sort_order: 0,
    block_name: "Pinot Noir",
    ...over,
  }) as SoilBlockMapping;

const legacySample = {
  sample_scope: "unmapped" as const,
  paddock_id: null as string | null,
  row_start: null as number | null,
  row_end: null as number | null,
  block_name: null as string | null,
};

describe("review page loads existing mappings", () => {
  it("detail read fetches soil_sample_block_mappings ordered by sort_order", () => {
    expect(lib).toContain('from("soil_sample_block_mappings")');
    expect(lib).toContain('.order("sort_order")');
    expect(lib).toContain("mappings,");
  });
  it("detail page populates the repeatable list from mapping rows", () => {
    expect(detail).toContain("detailQuery.data?.mappings");
    expect(detail).toContain("setMappingRows(");
  });
  it("legacy paddock_id is only a fallback when no mapping rows exist", () => {
    expect(detail).toContain("mappings.length > 0");
    expect(detail).toContain("Legacy fallback only");
  });
});

describe("mapping payloads", () => {
  it("one whole-block mapping produces a single whole_block payload row", () => {
    const payload = buildMappingPayload([
      { paddock_id: "b1", mapping_scope: "whole_block", row_start: null, row_end: null },
    ]);
    expect(payload).toEqual([
      {
        paddock_id: "b1",
        mapping_scope: "whole_block",
        row_start: null,
        row_end: null,
        mapping_confidence: null,
        notes: null,
      },
    ]);
  });
  it("one row-range mapping keeps its row bounds", () => {
    const payload = buildMappingPayload([
      { paddock_id: "b1", mapping_scope: "row_range", row_start: 30, row_end: 69 },
    ]);
    expect(payload[0]).toMatchObject({ mapping_scope: "row_range", row_start: 30, row_end: 69 });
  });
  it("two+ block mappings produce ONE payload with all rows", () => {
    const rows: SoilBlockMappingInput[] = [
      { paddock_id: "b1", mapping_scope: "row_range", row_start: 30, row_end: 69 },
      { paddock_id: "b2", mapping_scope: "whole_block", row_start: null, row_end: null },
    ];
    const payload = buildMappingPayload(rows);
    expect(payload).toHaveLength(2);
    expect(payload.map((p) => p.paddock_id)).toEqual(["b1", "b2"]);
    // The writer sends the whole array in a single RPC call.
    const start = lib.indexOf("export async function setSoilSampleBlockMappings");
    const writer = lib.slice(start, lib.indexOf("\n}", start));
    expect(writer).toContain('db.rpc("soil_analysis_set_block_mappings"');
    expect(writer).toContain("p_mappings: buildMappingPayload(rows)");
    expect(writer).not.toContain(".insert(");
  });
  it("row bounds are stripped from whole-block rows", () => {
    const payload = buildMappingPayload([
      { paddock_id: "b1", mapping_scope: "whole_block", row_start: 5, row_end: 9 },
    ]);
    expect(payload[0].row_start).toBeNull();
    expect(payload[0].row_end).toBeNull();
  });
});

describe("save flow", () => {
  const saveFn = detail.slice(detail.indexOf("const save = async"));
  it("Not mapped sends an empty mapping array", () => {
    expect(saveFn).toContain("setSoilSampleBlockMappings(sample.id, [])");
  });
  it("point mode clears block mappings then writes the point at sample level", () => {
    const clearIdx = saveFn.indexOf("setSoilSampleBlockMappings(sample.id, [])");
    const pointIdx = saveFn.indexOf('sample_scope: "point"');
    expect(clearIdx).toBeGreaterThan(-1);
    expect(pointIdx).toBeGreaterThan(clearIdx);
  });
  it("metadata save never writes sample_scope/paddock_id/row bounds before the RPC", () => {
    const metadataIdx = saveFn.indexOf("await updateSoilSample(sample.id, {");
    const rpcIdx = saveFn.indexOf("setSoilSampleBlockMappings(sample.id, mappingRows)");
    expect(rpcIdx).toBeGreaterThan(metadataIdx);
    const metadataBlock = saveFn.slice(metadataIdx, rpcIdx);
    expect(metadataBlock).not.toContain("sample_scope");
    expect(metadataBlock).not.toContain("paddock_id");
    expect(metadataBlock).not.toContain("row_start");
    expect(metadataBlock).not.toContain("row_end");
  });
  it("validation runs before any write", () => {
    const validateIdx = saveFn.indexOf("validateBlockMappings(mappingRows)");
    const writeIdx = saveFn.indexOf("await updateSoilSample(sample.id, {");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(writeIdx);
  });
  it("the sample is refetched after the RPC because scope may become multi_block", () => {
    expect(saveFn).toContain('qc.invalidateQueries({ queryKey: ["soil-analysis"] })');
  });
});

describe("client validation", () => {
  it("rejects a block-coverage row without a selected block", () => {
    expect(
      validateBlockMappings([
        { paddock_id: "", mapping_scope: "row_range", row_start: 30, row_end: 69 },
      ]),
    ).toBe(MAPPING_BLOCK_REQUIRED_MESSAGE);
    expect(MAPPING_BLOCK_REQUIRED_MESSAGE).toBe("Choose a block for each block-coverage row.");
  });
  it("rejects invalid row bounds", () => {
    const base = { paddock_id: "b1", mapping_scope: "row_range" as const };
    expect(validateBlockMappings([{ ...base, row_start: null, row_end: 69 }])).toMatch(/row numbers/);
    expect(validateBlockMappings([{ ...base, row_start: 69, row_end: 30 }])).toMatch(/row numbers/);
    expect(validateBlockMappings([{ ...base, row_start: 0, row_end: 30 }])).toMatch(/row numbers/);
    expect(validateBlockMappings([{ ...base, row_start: 30, row_end: 69 }])).toBeNull();
  });
  it("requires at least one row in block coverage mode", () => {
    expect(validateBlockMappings([])).toMatch(/at least one block-coverage row/);
  });
});

describe("Samples list / Overview display", () => {
  it("0 mappings => Unmapped", () => {
    expect(mappingSummaryLabel(legacySample, [])).toBe("Unmapped");
  });
  it("1 whole-block mapping => block name", () => {
    expect(mappingSummaryLabel(legacySample, [mapping({})])).toBe("Pinot Noir");
  });
  it("1 row-range mapping => Block · Rows X–Y", () => {
    expect(
      mappingSummaryLabel(legacySample, [
        mapping({ mapping_scope: "row_range", row_start: 30, row_end: 69 }),
      ]),
    ).toBe("Pinot Noir · Rows 30–69");
  });
  it(">1 mappings => 'N blocks' and never one arbitrary block", () => {
    const rows = [mapping({}), mapping({ id: "m2", paddock_id: "b2", block_name: "Primitivo" })];
    expect(mappingSummaryLabel(legacySample, rows)).toBe("2 blocks");
    expect(mappingSummaryLines(rows)).toEqual(["Pinot Noir · Whole block", "Primitivo · Whole block"]);
  });
  it("legacy fields are only used when no mapping rows exist", () => {
    const legacy = {
      ...legacySample,
      sample_scope: "row_range" as const,
      paddock_id: "b1",
      row_start: 30,
      row_end: 69,
      block_name: "East Bottom",
    };
    expect(mappingSummaryLabel(legacy, [])).toBe("East Bottom · Rows 30–69");
    // Mapping rows win over legacy fields.
    expect(mappingSummaryLabel(legacy, [mapping({})])).toBe("Pinot Noir");
  });
  it("the list shows the multi-block detail on hover", () => {
    expect(list).toContain("mappingSummaryLines(rows).join");
    expect(list).toContain("mappingSummaryLabel(s, rows)");
  });
  it("overview expands multi-block samples into each mapped block", () => {
    expect(overview).toContain("listBlockMappingsForSamples");
    expect(overview).toContain("blockIdsFor");
  });
});

describe("Trends / Compare use mappings, not only soil_samples.paddock_id", () => {
  it("block-filtered reads resolve sample ids through soil_sample_block_mappings", () => {
    const helper = lib.slice(lib.indexOf("async function sampleIdsForBlocks"));
    expect(helper).toContain('from("soil_sample_block_mappings")');
    // Legacy fallback is unioned in, not the only source.
    expect(helper).toContain('.from("soil_samples")');
  });
  it("compare rows carry matched_paddock_id so multi-block samples appear per block", () => {
    const period = lib.slice(lib.indexOf("export async function listBlockPeriodResults"));
    expect(period).toContain("matched_paddock_id");
  });
  it("compare matrix attributes rows by matched_paddock_id with legacy fallback", () => {
    const rows = [
      {
        id: "r1",
        analyte_key: "p",
        method: "Colwell",
        unit: "mg/kg",
        value_numeric: 42,
        sample: { id: "s1", paddock_id: null, sampled_at: "2026-01-01", created_at: "2026-01-01" },
        matched_paddock_id: "b2",
      },
    ];
    const matrix = buildCompareMatrix(rows as any, ["b1", "b2"], ["p"]);
    expect(matrix[0][0].result).toBeNull(); // b1: not matched
    expect(matrix[0][1].result?.value_numeric).toBe(42); // b2: matched via mapping
  });
});

describe("confirm and scope labels", () => {
  it("multi_block is a recognised scope with a label", () => {
    expect(SAMPLE_SCOPE_LABEL.multi_block).toBe("Multiple blocks");
  });
  it("confirm never touches sample_scope or paddock_id", () => {
    const confirmFn = lib.slice(
      lib.indexOf("export async function confirmSoilSample"),
      lib.indexOf("export async function confirmSoilSample") + 600,
    );
    expect(confirmFn).not.toContain("sample_scope");
    expect(confirmFn).not.toContain("paddock_id");
    expect(confirmFn).toContain('extraction_status: "confirmed"');
  });
});

describe("error presentation", () => {
  it("prefers error.message", () => {
    expect(formatDataError({ message: "row level security", details: "x" })).toBe("row level security");
    expect(formatDataError(new Error("plain failure"))).toBe("plain failure");
  });
  it("falls back to error.details, then safe JSON, then a generic message", () => {
    expect(formatDataError({ details: "constraint violation" })).toBe("constraint violation");
    expect(formatDataError({ code: "23505" })).toBe('{"code":"23505"}');
    expect(formatDataError({})).toBe("Something went wrong. Please try again.");
    expect(formatDataError(null)).toBe("Something went wrong. Please try again.");
  });
  it("never renders [object Object]", () => {
    for (const e of [{}, { code: "P0001" }, null, undefined, new Error("boom")]) {
      expect(formatDataError(e)).not.toContain("[object Object]");
    }
  });
  it("detail page formats every caught error through the safe formatter", () => {
    expect(detail).not.toContain("String(e)");
    expect(detail).toContain("formatDataError(e)");
  });
});

describe("preserved behaviour", () => {
  it("hard-delete guard remains intact", () => {
    const deleteFn = lib.slice(lib.indexOf("export async function deleteSoilSample"));
    expect(deleteFn).toContain('.neq("extraction_status", "confirmed")');
  });
  it("reports RPC names are unchanged", () => {
    expect(lib).toContain('db.rpc("soil_analysis_report_series"');
    expect(lib).toContain('db.rpc("soil_analysis_map_report"');
  });
  it("System Admin + feature flag gate is unchanged", () => {
    const gate = readFileSync("src/components/soil-analysis/SoilAnalysisGate.tsx", "utf8");
    expect(gate).toContain("SOIL_ANALYSIS_FLAG");
  });
});
