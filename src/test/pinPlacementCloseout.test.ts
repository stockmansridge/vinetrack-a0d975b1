// SQL 171 Portal closeout regressions: canonical placement drives display,
// filters/counts and exports. Nothing is derived from the base pins row.
import { describe, expect, it } from "vitest";
import { pinPlacementDisplay, type PinPlacementRow } from "@/lib/pinPlacement";
import { placementMap } from "@/lib/pinPlacementQuery";
import {
  PIN_EXPORT_PLACEMENT_COLUMNS,
  pinExportColumns,
  pinsExportCsv,
} from "@/lib/pinsExport";

const row = (p: Partial<PinPlacementRow>): PinPlacementRow => ({ pin_id: "p", ...p });

// Representative production classifications.
const POINT_COORDINATES = row({
  pin_id: "point",
  location_scope: "point",
  location_assignment_basis: "point_coordinates",
  is_location_assigned: true,
});
const SNAPPED_POINT = row({
  pin_id: "snapped",
  location_scope: "point",
  location_assignment_basis: "snapped_point",
  is_location_assigned: true,
  paddock_name: "Shiraz",
  driving_row_number: 19.5,
  pin_row_number: 19,
  pin_side: null,
});
const LEGACY_BLOCK = row({
  pin_id: "legacy",
  location_scope: "block",
  location_assignment_basis: "block",
  is_location_assigned: true,
  paddock_id: "b1",
  paddock_name: "Pinot Noir",
});
const ROW_SEGMENTS = row({
  pin_id: "rows",
  location_scope: "row",
  location_assignment_basis: "row_segments",
  is_location_assigned: true,
  paddock_name: "Chardonnay",
  row_summary: "Rows 2–3 · Row 5 (sections 1–2)",
  has_row_segments: true,
});
const METADATA_INCOMPLETE = row({
  pin_id: "incomplete",
  location_scope: "block",
  location_assignment_basis: "block",
  is_location_assigned: true,
  paddock_name: "Merlot",
  location_warning_code: "location_metadata_incomplete",
});
const GENUINELY_UNASSIGNED = row({
  pin_id: "none",
  location_scope: null,
  location_assignment_basis: null,
  is_location_assigned: false,
  location_warning_code: "unassigned_location",
});

const ALL = [
  POINT_COORDINATES,
  SNAPPED_POINT,
  LEGACY_BLOCK,
  ROW_SEGMENTS,
  METADATA_INCOMPLETE,
  GENUINELY_UNASSIGNED,
];

describe("production classification matrix", () => {
  it("coordinates-only point is assigned with no amber warning", () => {
    const d = pinPlacementDisplay(POINT_COORDINATES);
    expect(d.assigned).toBe(true);
    expect(d.showWarning).toBe(false);
    expect(d.blockLabel).toBe("Point location");
  });

  it("snapped point keeps decimal driving row and never invents a side", () => {
    const d = pinPlacementDisplay(SNAPPED_POINT);
    expect(d.assigned).toBe(true);
    expect(d.rowLabel).toContain("Driving row: 19.5");
    expect(d.rowLabel).toContain("On Row: Row 19");
    expect(d.rowLabel).not.toMatch(/side/i);
    expect(d.blockLabel).toBe("Shiraz");
  });

  it("legacy block pin is assigned, block visible, no row required", () => {
    const d = pinPlacementDisplay(LEGACY_BLOCK);
    expect(d.assigned).toBe(true);
    expect(d.showWarning).toBe(false);
    expect(d.blockLabel).toBe("Pinot Noir");
    expect(d.rowLabel).toBe("—");
  });

  it("row-segment pin shows the server row_summary verbatim", () => {
    const d = pinPlacementDisplay(ROW_SEGMENTS);
    expect(d.assigned).toBe(true);
    expect(d.rowLabel).toBe("Rows 2–3 · Row 5 (sections 1–2)");
  });

  it("location_metadata_incomplete stays assigned, keeps the block, no amber", () => {
    const d = pinPlacementDisplay(METADATA_INCOMPLETE);
    expect(d.assigned).toBe(true);
    expect(d.showWarning).toBe(false);
    expect(d.metadataIncomplete).toBe(true);
    expect(d.blockLabel).toBe("Merlot");
  });

  it("unassigned_location is the only amber warning", () => {
    const ambers = ALL.filter((r) => pinPlacementDisplay(r).showWarning).map((r) => r.pin_id);
    expect(ambers).toEqual(["none"]);
    expect(pinPlacementDisplay(GENUINELY_UNASSIGNED).blockLabel).toBe("Unassigned location");
  });

  it("a known block never disappears because the row is null", () => {
    const d = pinPlacementDisplay(row({ paddock_name: "Grenache", is_location_assigned: true }));
    expect(d.blockLabel).toBe("Grenache");
  });
});

describe("assigned / unassigned filtering and counts", () => {
  const map = placementMap(ALL);
  const ids = ALL.map((r) => r.pin_id);
  const assigned = ids.filter((id) => map.get(id)?.is_location_assigned === true);
  const unassigned = ids.filter((id) => pinPlacementDisplay(map.get(id)).showWarning);

  it("uses is_location_assigned for assigned filtering", () => {
    expect(assigned).toEqual(["point", "snapped", "legacy", "rows", "incomplete"]);
  });

  it("metadata-incomplete pins never fail the assigned filter", () => {
    expect(assigned).toContain("incomplete");
    expect(unassigned).not.toContain("incomplete");
  });

  it("counts match the canonical booleans", () => {
    expect({ assigned: assigned.length, unassigned: unassigned.length, all: ids.length }).toEqual({
      assigned: 5,
      unassigned: 1,
      all: 6,
    });
  });
});

describe("exports consume canonical placement fields", () => {
  const exportRows = [
    {
      pin_id: "rows",
      title: "Broken post",
      location_scope: "row",
      is_location_assigned: true,
      location_assignment_basis: "row_segments",
      block_id: "b1",
      block_name: "Chardonnay",
      row_summary: "Rows 2–3 · Row 5 (sections 1–2)",
      latitude: null,
      longitude: null,
      location_warning_code: null,
      created_at: "2026-01-02T00:00:00Z",
    },
    {
      pin_id: "block",
      title: "Spray note",
      location_scope: "block",
      is_location_assigned: true,
      location_assignment_basis: "block",
      block_id: "b2",
      block_name: "Pinot Noir",
      row_summary: null,
      latitude: null,
      longitude: null,
      location_warning_code: null,
      created_at: "2026-01-03T00:00:00Z",
    },
    {
      pin_id: "point",
      title: "Hazard",
      location_scope: "point",
      is_location_assigned: true,
      location_assignment_basis: "point_coordinates",
      block_id: null,
      block_name: null,
      row_summary: null,
      latitude: -33.5,
      longitude: 148.2,
      location_warning_code: null,
      created_at: "2026-01-04T00:00:00Z",
    },
  ];

  it("includes every canonical placement column", () => {
    const cols = pinExportColumns(exportRows);
    for (const c of PIN_EXPORT_PLACEMENT_COLUMNS) expect(cols).toContain(c);
    expect(cols).toContain("created_at");
  });

  it("block scope exports the block without requiring a row", () => {
    const csv = pinsExportCsv(exportRows).split("\n");
    const line = csv.find((l) => l.startsWith("block"))!;
    expect(line).toContain("Pinot Noir");
    expect(line).toContain("true");
  });

  it("row scope exports the server row_summary verbatim", () => {
    expect(pinsExportCsv(exportRows)).toContain("Rows 2–3 · Row 5 (sections 1–2)");
  });

  it("point without a block exports coordinates and stays assigned", () => {
    const line = pinsExportCsv(exportRows).split("\n").find((l) => l.startsWith("point"))!;
    expect(line).toContain("-33.5");
    expect(line).toContain("148.2");
    expect(line).toContain("true");
  });
});
