// Exact VineTrack row selection for soil block coverage: rows come from the
// live paddocks.rows array, are ticked (never typed), canonicalise to
// whole_block / selected_rows, and summaries never fill gaps.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  blockRowNumbers,
  compactRowList,
  rowSelectionSummary,
  initialSelection,
  validateBlockMappings,
  buildMappingPayload,
  mappingSummaryLabel,
  mappingSummaryLines,
  parseReportRowRange,
  suggestMappingsFromRange,
  SAMPLE_SCOPE_LABEL,
  MAPPING_ROWS_REQUIRED_MESSAGE,
  MAPPING_NO_CONFIGURED_ROWS_MESSAGE,
  MAPPING_DUPLICATE_BLOCK_MESSAGE,
  MAPPING_BLOCK_REQUIRED_MESSAGE,
  type SoilBlockMapping,
} from "@/lib/soilAnalysis";

const detail = readFileSync("src/pages/admin/SoilSampleDetailPage.tsx", "utf8");
const rowsJson = (nums: number[]) =>
  nums.map((n) => ({ id: `r${n}`, number: n, startPoint: {}, endPoint: {} }));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// Mirrors the Stockman's Ridge layout shape only as test fixtures.
const blocks = [
  { id: "gru", rows: rowsJson(range(1, 14)) },
  { id: "shz", rows: rowsJson(range(15, 30)) },
  { id: "pri", rows: rowsJson(range(31, 37)) },
  { id: "cbf", rows: rowsJson(range(38, 44)) },
  { id: "mer", rows: rowsJson(range(45, 51)) },
  { id: "pgr", rows: rowsJson(range(52, 57)) },
  { id: "sbl", rows: rowsJson(range(58, 68)) },
  { id: "pno", rows: rowsJson(range(69, 108)) },
];

const m = (over: Partial<SoilBlockMapping>): SoilBlockMapping =>
  ({
    id: "m", sample_id: "s", vineyard_id: "v", paddock_id: "pri", mapping_scope: "whole_block",
    row_start: null, row_end: null, row_numbers: null, row_ids: null,
    mapping_confidence: null, notes: null, sort_order: 0, block_name: "Primitivo", ...over,
  }) as SoilBlockMapping;

const known = new Map([["pri", range(31, 37)], ["empty", [] as number[]]]);
const noLegacy = { sample_scope: "unmapped" as const, paddock_id: null, row_start: null, row_end: null, block_name: null };

describe("block rows from paddocks.rows", () => {
  it("1. loads row numbers from paddock.rows", () => {
    expect(blockRowNumbers(rowsJson([31, 32, 33]))).toEqual([31, 32, 33]);
  });
  it("2. sorts ascending even if JSON is descending", () => {
    expect(blockRowNumbers(rowsJson([37, 36, 31, 34]))).toEqual([31, 34, 36, 37]);
  });
  it("detail page queries paddocks with rows", () => {
    expect(detail).toContain('.select("id, name, rows, variety_allocations")');
  });
  it("3. no row text inputs in block coverage UI", () => {
    expect(detail).not.toContain("Row from");
    expect(detail).not.toContain("Row to");
    expect(detail).not.toContain('<option value="row_range"');
    expect(detail).toContain("Select all rows");
    expect(detail).toContain("Clear");
  });
});

describe("canonical payload", () => {
  it("4. select all => whole_block", () => {
    expect(buildMappingPayload([{ paddock_id: "pri", selected: range(31, 37) }], known)[0]).toEqual({
      paddock_id: "pri", mapping_scope: "whole_block", mapping_confidence: null, notes: null,
    });
  });
  it("5. subset => selected_rows with exact sorted unique row_numbers", () => {
    expect(buildMappingPayload([{ paddock_id: "pri", selected: [33, 31, 33, 32] }], known)[0]).toEqual({
      paddock_id: "pri", mapping_scope: "selected_rows", row_numbers: [31, 32, 33], mapping_confidence: null, notes: null,
    });
  });
  it("6. non-contiguous stays non-contiguous in payload and summary", () => {
    const p = buildMappingPayload([{ paddock_id: "pri", selected: [31, 32, 33, 35, 37] }], known)[0];
    expect(p.row_numbers).toEqual([31, 32, 33, 35, 37]);
    expect(rowSelectionSummary([31, 32, 33, 35, 37])).toBe("Rows 31–33, 35, 37");
  });
  it("UI never generates row_range", () => {
    const out = buildMappingPayload([{ paddock_id: "pri", selected: [31] }], known);
    expect(out.every((p) => p.mapping_scope !== "row_range")).toBe(true);
  });
});

describe("validation", () => {
  it("7. zero selection blocked", () => {
    expect(validateBlockMappings([{ paddock_id: "pri", selected: [] }], known)).toBe(MAPPING_ROWS_REQUIRED_MESSAGE);
    expect(MAPPING_ROWS_REQUIRED_MESSAGE).toBe("Select at least one row for each selected block, or choose All rows.");
  });
  it("8. block with no rows blocked with setup message", () => {
    expect(validateBlockMappings([{ paddock_id: "empty", selected: [] }], known)).toBe(MAPPING_NO_CONFIGURED_ROWS_MESSAGE);
    expect(MAPPING_NO_CONFIGURED_ROWS_MESSAGE).toBe("No configured VineTrack rows for this block. Update Block & Row setup first.");
  });
  it("9. duplicate block blocked", () => {
    expect(
      validateBlockMappings([{ paddock_id: "pri", selected: [31] }, { paddock_id: "pri", selected: [32] }], known),
    ).toBe(MAPPING_DUPLICATE_BLOCK_MESSAGE);
  });
  it("missing block blocked; valid passes", () => {
    expect(validateBlockMappings([{ paddock_id: "", selected: [] }], known)).toBe(MAPPING_BLOCK_REQUIRED_MESSAGE);
    expect(validateBlockMappings([{ paddock_id: "pri", selected: [31, 35] }], known)).toBeNull();
  });
});

describe("loading existing mappings", () => {
  const k = range(31, 37);
  it("10. legacy row_range prefers stored row_numbers, else falls back to range", () => {
    expect(initialSelection(m({ mapping_scope: "row_range", row_start: 30, row_end: 69, row_numbers: [31, 32] }), k)).toEqual([31, 32]);
    expect(initialSelection(m({ mapping_scope: "row_range", row_start: 33, row_end: 40 }), k)).toEqual([33, 34, 35, 36, 37]);
  });
  it("11. selected_rows reload with exact ticks; whole_block ticks all", () => {
    expect(initialSelection(m({ mapping_scope: "selected_rows", row_numbers: [37, 31, 35] }), k)).toEqual([31, 35, 37]);
    expect(initialSelection(m({ mapping_scope: "whole_block" }), k)).toEqual(k);
  });
});

describe("summaries", () => {
  it("12. compacts contiguous sequences without filling gaps", () => {
    expect(compactRowList([37, 31, 32, 33, 35])).toBe("31–33, 35, 37");
    expect(compactRowList([30])).toBe("30");
    expect(mappingSummaryLabel(noLegacy, [m({})])).toBe("Primitivo · All rows");
    expect(mappingSummaryLabel(noLegacy, [m({ mapping_scope: "selected_rows", row_numbers: range(31, 37) })])).toBe("Primitivo · Rows 31–37");
    expect(mappingSummaryLabel(noLegacy, [m({ mapping_scope: "selected_rows", row_numbers: [31, 37] })])).toBe("Primitivo · Rows 31, 37");
    const multi = [m({}), m({ id: "m2", block_name: "Shiraz", mapping_scope: "selected_rows", row_numbers: [30] })];
    expect(mappingSummaryLabel(noLegacy, multi)).toBe("2 blocks");
    expect(mappingSummaryLines(multi)).toEqual(["Primitivo · All rows", "Shiraz · Row 30"]);
    expect(SAMPLE_SCOPE_LABEL.row_selection).toBe("Selected rows");
  });
});

describe("report row suggestion", () => {
  it("parses unambiguous ranges only", () => {
    expect(parseReportRowRange("ROWS 30-69 EAST BOT")).toEqual({ from: 30, to: 69 });
    expect(parseReportRowRange("ROW 70-109 WEST PINOT")).toEqual({ from: 70, to: 109 });
    expect(parseReportRowRange("ROWS 1-5 AND ROWS 8-9")).toBeNull();
    expect(parseReportRowRange("EAST BOTTOM")).toBeNull();
    expect(parseReportRowRange("ROWS 69-30")).toBeNull();
  });
  it("13. maps a global range across several blocks", () => {
    const s = suggestMappingsFromRange({ from: 30, to: 69 }, blocks);
    expect(s.mappings).toEqual([
      { paddock_id: "shz", selected: [30] },
      { paddock_id: "pri", selected: range(31, 37) },
      { paddock_id: "cbf", selected: range(38, 44) },
      { paddock_id: "mer", selected: range(45, 51) },
      { paddock_id: "pgr", selected: range(52, 57) },
      { paddock_id: "sbl", selected: range(58, 68) },
      { paddock_id: "pno", selected: [69] },
    ]);
    expect(s.missing).toEqual([]);
  });
  it("14. missing current row is reported, not invented", () => {
    const s = suggestMappingsFromRange({ from: 70, to: 109 }, blocks);
    expect(s.missing).toEqual([109]);
    expect(s.mappings).toEqual([{ paddock_id: "pno", selected: range(70, 108) }]);
    expect(detail).toContain("not present in the current VineTrack row configuration.");
  });
  it("suggestion never saves or confirms", () => {
    const fn = detail.slice(detail.indexOf("const applySuggestion"), detail.indexOf("const applySuggestion") + 400);
    expect(fn).not.toContain("setSoilSampleBlockMappings");
    expect(fn).not.toContain("confirmSoilSample");
  });
});

describe("15. save uses one atomic RPC", () => {
  it("block coverage writes via a single RPC call", () => {
    const saveFn = detail.slice(detail.indexOf("const save = async"), detail.indexOf("const confirm = async"));
    expect(saveFn.match(/setSoilSampleBlockMappings\(sample\.id, mappingRows, knownRows\)/g)).toHaveLength(1);
  });
});
