import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { pinPlacementDisplay, type PinPlacementRow } from "@/lib/pinPlacement";
import { placementMap } from "@/lib/pinPlacementQuery";
import { pinDisplayStyle } from "@/lib/pinStyle";
import { pinDisplayCoords } from "@/lib/pinStyle";

const base = (patch: Partial<PinPlacementRow> = {}): PinPlacementRow => ({
  pin_id: "p1",
  location_scope: "point",
  is_location_assigned: true,
  location_assignment_basis: "point_coordinates",
  paddock_id: null,
  paddock_name: null,
  row_summary: null,
  location_warning_code: null,
  ...patch,
});

describe("SQL 171 placement contract", () => {
  it("coordinate-only point pin is assigned and shows Point location / —", () => {
    const d = pinPlacementDisplay(base());
    expect(d.assigned).toBe(true);
    expect(d.blockLabel).toBe("Point location");
    expect(d.rowLabel).toBe("—");
  });

  it("coordinate-only point pin does not show the amber warning", () => {
    expect(pinPlacementDisplay(base()).showWarning).toBe(false);
  });

  it("snapped point without a block is assigned", () => {
    const d = pinPlacementDisplay(base({ location_assignment_basis: "snapped_point", snapped_to_row: true }));
    expect(d.assigned).toBe(true);
    expect(d.showWarning).toBe(false);
    expect(d.blockLabel).toBe("Point location");
  });

  it("block-only placement shows the block name with no row", () => {
    const d = pinPlacementDisplay(
      base({ location_scope: "block", location_assignment_basis: "block", paddock_id: "b1", paddock_name: "Pinot Noir" }),
    );
    expect(d.assigned).toBe(true);
    expect(d.blockLabel).toBe("Pinot Noir");
    expect(d.rowLabel).toBe("—");
  });

  it("row placement uses row_summary verbatim", () => {
    const d = pinPlacementDisplay(
      base({
        location_scope: "row",
        location_assignment_basis: "row_segments",
        paddock_name: "Pinot Noir",
        row_summary: "Rows 41–43",
        has_row_segments: true,
      }),
    );
    expect(d.rowLabel).toBe("Rows 41–43");
    expect(d.blockLabel).toBe("Pinot Noir");
  });

  it("truly unassigned placement shows amber unassigned", () => {
    const d = pinPlacementDisplay(
      base({ is_location_assigned: false, location_assignment_basis: null, location_warning_code: "unassigned_location" }),
    );
    expect(d.showWarning).toBe(true);
    expect(d.blockLabel).toBe("Unassigned location");
    expect(d.assignmentLabel).toBe("Unassigned location");
  });

  it("location_metadata_incomplete never shows amber", () => {
    const d = pinPlacementDisplay(base({ location_warning_code: "location_metadata_incomplete" }));
    expect(d.showWarning).toBe(false);
    expect(d.metadataIncomplete).toBe(true);
    expect(d.assigned).toBe(true);
  });

  it("missing placement rows are neutral, never amber", () => {
    const d = pinPlacementDisplay(undefined);
    expect(d.showWarning).toBe(false);
    expect(d.blockLabel).toBe("—");
  });

  it("table and drawer read the same placement object", () => {
    const rows = [base({ pin_id: "p1", paddock_name: "Pinot Noir", row_summary: "Rows 41–43" })];
    const map = placementMap(rows);
    const fromTable = pinPlacementDisplay(map.get("p1"));
    const fromDrawer = pinPlacementDisplay(map.get("p1"));
    expect(fromTable).toEqual(fromDrawer);
  });
});

describe("placement never affects colour or mapping", () => {
  it("a point-without-block Vine Issue keeps its category colour", () => {
    const pin = { category_id: "vine_issue", paddock_id: null, latitude: -33.5, longitude: 148.2 };
    expect(pinDisplayStyle(pin as any).hex).toBe("#34C759");
  });

  it("a point without a block is still a valid map marker", () => {
    const coords = pinDisplayCoords({ paddock_id: null, latitude: -33.5, longitude: 148.2 } as any);
    expect(coords?.lat).toBe(-33.5);
    expect(coords?.lng).toBe(148.2);
  });

  it("renders the map dot with the category colour regardless of placement", () => {
    const style = pinDisplayStyle({ category_id: "irrigation", paddock_id: null } as any);
    render(<span data-testid="dot" style={{ background: style.hex }} />);
    expect(screen.getByTestId("dot").getAttribute("style")).toContain("rgb(0, 122, 255)");
  });
});

// --- SQL 171 row-field regression (row_summary vs pin/driving row numbers) ---
describe("placement row information", () => {
  it("displays row_summary verbatim", () => {
    const d = pinPlacementDisplay({ pin_id: "1", row_summary: "Rows 41–43", location_scope: "row", is_location_assigned: true } as any);
    expect(d.rowLabel).toBe("Rows 41–43");
  });

  it("displays attached row when row_summary is null", () => {
    const d = pinPlacementDisplay({ pin_id: "2", paddock_name: "Pinot Noir", row_summary: null, pin_row_number: 87, pin_side: "Left", location_scope: "point", location_assignment_basis: "snapped_point", is_location_assigned: true } as any);
    expect(d.rowLabel).not.toBe("—");
    expect(d.rowLabel).toContain("On Row: Row 87");
    expect(d.rowLabel).toContain("Side: Left hand side");
    expect(d.blockLabel).toBe("Pinot Noir");
  });

  it("preserves fractional row numbers and shows the driving row", () => {
    const d = pinPlacementDisplay({ pin_id: "3", pin_row_number: 87.5, driving_row_number: 87, pin_side: "right", is_location_assigned: true } as any);
    expect(d.rowLabel).toContain("On Row: Row 87.5");
    expect(d.rowLabel).toContain("Driving row: 87");
    expect(d.rowLabel).toContain("Side: Right hand side");
  });

  it("block-only pin shows an em dash row", () => {
    const d = pinPlacementDisplay({ pin_id: "4", paddock_name: "Pinot Noir", location_scope: "block", is_location_assigned: true } as any);
    expect(d.rowLabel).toBe("—");
    expect(d.blockLabel).toBe("Pinot Noir");
  });

  it("coordinate-only point shows Point location with em dash row", () => {
    const d = pinPlacementDisplay({ pin_id: "5", location_scope: "point", location_assignment_basis: "point_coordinates", is_location_assigned: true } as any);
    expect(d.blockLabel).toBe("Point location");
    expect(d.rowLabel).toBe("—");
  });
});
