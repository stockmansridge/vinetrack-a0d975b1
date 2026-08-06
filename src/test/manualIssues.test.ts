import { describe, expect, it } from "vitest";
import {
  ACTIVE_STATUSES,
  applyScopeChange,
  buildCreateArgs,
  buildSegments,
  buildUpdateArgs,
  categoryLabel,
  countByStatus,
  emptyIssueForm,
  filterIssues,
  formFromIssue,
  isManualIssuePin,
  isOverdue,
  locationSummary,
  MANUAL_ISSUE_PIN_MODE,
  manualIssueErrorMessage,
  manualIssueMarkerColour,
  parseRowSelection,
  summariseSegments,
  validateIssueForm,
  type ManualIssue,
} from "@/lib/manualIssues";
import { manualIssueExportRows, manualIssuesCsv } from "@/lib/manualIssuesExport";
import { normaliseIssue } from "@/lib/manualIssuesQuery";
import { pinStyle } from "@/lib/pinStyle";

function issue(patch: Partial<ManualIssue> = {}): ManualIssue {
  return {
    id: patch.id ?? "i1",
    vineyard_id: "v1",
    paddock_id: null,
    title: "Broken post",
    description: null,
    category: "infrastructure",
    priority: "high",
    status: "open",
    location_scope: "point",
    latitude: -33.5,
    longitude: 151.2,
    original_latitude: null,
    original_longitude: null,
    snapped_latitude: null,
    snapped_longitude: null,
    driving_row_number: null,
    pin_row_number: null,
    pin_side: null,
    along_row_distance_m: null,
    snapped_to_row: null,
    assigned_user_id: null,
    due_date: null,
    linked_work_task_id: null,
    photo_path: null,
    created_by: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: null,
    client_updated_at: null,
    deleted_at: null,
    completed_at: null,
    completed_by: null,
    completed_by_user_id: null,
    segments: null,
    ...patch,
  };
}

describe("row selection", () => {
  it("parses lists and ranges, deduped and sorted", () => {
    expect(parseRowSelection("8-9, 12, 8")).toEqual([8, 9, 12]);
    expect(parseRowSelection("")).toEqual([]);
  });

  it("builds one segment per row × section", () => {
    expect(buildSegments([5], [1, 2])).toEqual([
      { row: 5, segment: 1 },
      { row: 5, segment: 2 },
    ]);
    expect(buildSegments([5, 6], [1, 2, 3, 4])).toHaveLength(8);
  });

  it("summarises segments in customer wording", () => {
    expect(summariseSegments(buildSegments([8, 9], [1, 2, 3, 4]))).toBe("Rows 8–9 (all sections)");
    expect(summariseSegments(buildSegments([5], [1, 2]))).toBe("Row 5 (sections 1, 2)");
    expect(summariseSegments([])).toBeNull();
  });
});

describe("form validation and scope changes", () => {
  it("requires a title", () => {
    expect(validateIssueForm({ ...emptyIssueForm(), latitude: 1, longitude: 1 })).toMatch(/Title/);
  });

  it("requires coordinates for point issues", () => {
    const f = { ...emptyIssueForm(), title: "x" };
    expect(validateIssueForm(f)).toMatch(/location on the map/);
  });

  it("requires a block for block scope and rows for row scope", () => {
    const block = applyScopeChange({ ...emptyIssueForm(), title: "x" }, "block");
    expect(validateIssueForm(block)).toMatch(/block/);
    const row = { ...applyScopeChange({ ...emptyIssueForm(), title: "x" }, "row"), paddockId: "p1" };
    expect(validateIssueForm(row)).toMatch(/row/i);
    expect(validateIssueForm({ ...row, rowSelection: "3" })).toBeNull();
  });

  it("clears obsolete location state when the scope changes", () => {
    const point = { ...emptyIssueForm(), title: "x", latitude: -33, longitude: 151, drivingRowNumber: 4 };
    const asRow = applyScopeChange(point, "row");
    expect(asRow.latitude).toBeNull();
    expect(asRow.drivingRowNumber).toBeNull();
    const back = applyScopeChange({ ...asRow, rowSelection: "3-4" }, "point");
    expect(back.rowSelection).toBe("");
  });
});

describe("RPC argument builders", () => {
  const base = { ...emptyIssueForm(), title: "  Broken post  ", latitude: -33.5, longitude: 151.2 };

  it("always sends p_id and p_client_updated_at on create", () => {
    const args = buildCreateArgs(base, { vineyardId: "v1", id: "id-1" });
    expect(args.p_id).toBe("id-1");
    expect(args.p_vineyard_id).toBe("v1");
    expect(args.p_title).toBe("Broken post");
    expect(args.p_location_scope).toBe("point");
    expect(typeof args.p_client_updated_at).toBe("string");
    expect(args.p_category).toBe("general");
    expect(args.p_priority).toBe("normal");
    expect(args.p_segments).toBeNull();
  });

  it("always sends p_id and p_client_updated_at on update", () => {
    const args = buildUpdateArgs(base, { id: "id-1" });
    expect(args.p_id).toBe("id-1");
    expect(args.p_client_updated_at).toBeTruthy();
    expect((args as any).p_vineyard_id).toBeUndefined();
  });

  it("nulls point fields for row scope and sends segments", () => {
    const row = {
      ...applyScopeChange(base, "row"),
      paddockId: "p1",
      rowSelection: "8-9",
      rowSections: [1, 2],
    };
    const args = buildCreateArgs(row, { vineyardId: "v1", id: "id-2" });
    expect(args.p_latitude).toBeNull();
    expect(args.p_segments).toEqual([
      { row: 8, segment: 1 },
      { row: 8, segment: 2 },
      { row: 9, segment: 1 },
      { row: 9, segment: 2 },
    ]);
  });

  it("round-trips a stored issue back into the form", () => {
    const form = formFromIssue(
      issue({ location_scope: "row", segments: [{ row: 4, segment: 1 }, { row: 5, segment: 1 }] }),
    );
    expect(form.rowSelection).toBe("4, 5");
    expect(form.rowSections).toEqual([1]);
  });
});

describe("filters and counts", () => {
  const rows = [
    issue({ id: "a", status: "open", priority: "high", paddock_id: "p1" }),
    issue({ id: "b", status: "completed", priority: "low", title: "Weeds" }),
    issue({ id: "c", status: "in_progress", assigned_user_id: "u1" }),
    issue({ id: "d", status: "open", deleted_at: "2026-08-02T00:00:00Z" }),
  ];

  it("hides soft-deleted issues", () => {
    expect(filterIssues(rows, {}).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by status, block, priority, assignee and text", () => {
    expect(filterIssues(rows, { statuses: [...ACTIVE_STATUSES] }).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterIssues(rows, { paddockId: "p1" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterIssues(rows, { priority: "low" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterIssues(rows, { assignedUserId: "u1" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterIssues(rows, { search: "weeds" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("counts by status excluding deleted", () => {
    expect(countByStatus(rows)).toEqual({ open: 1, in_progress: 1, completed: 1, cancelled: 0 });
  });

  it("treats past due dates as overdue only while active", () => {
    const now = new Date("2026-08-10T00:00:00Z");
    expect(isOverdue(issue({ due_date: "2026-08-01" }), now)).toBe(true);
    expect(isOverdue(issue({ due_date: "2026-08-01", status: "completed" }), now)).toBe(false);
    expect(isOverdue(issue({ due_date: null }), now)).toBe(false);
  });
});

describe("presentation", () => {
  it("describes locations without raw field names", () => {
    expect(locationSummary(issue({ driving_row_number: 19.5 }))).toBe("On row 19.5");
    expect(locationSummary(issue({ location_scope: "block" }))).toBe("Whole block");
    expect(
      locationSummary(issue({ location_scope: "row", segments: [{ row: 8, segment: 1 }] })),
    ).toContain("Row 8");
  });

  it("labels categories", () => {
    expect(categoryLabel("action_required")).toBe("Action required");
    expect(categoryLabel(null)).toBe("General");
  });

  it("uses amber markers, muted once closed", () => {
    expect(manualIssueMarkerColour("open")).toBe("#FF9500");
    expect(manualIssueMarkerColour("completed")).not.toBe("#FF9500");
    expect(pinStyle(MANUAL_ISSUE_PIN_MODE, null, null).hex).toBe("#FF9500");
    expect(isManualIssuePin({ mode: "ManualIssue" })).toBe(true);
    expect(isManualIssuePin({ mode: "Repair" })).toBe(false);
  });

  it("maps backend error codes to safe copy", () => {
    expect(manualIssueErrorMessage(new Error("PERMISSION_DENIED: nope"))).toMatch(/permission/i);
    expect(manualIssueErrorMessage(new Error("CONFLICT: stale"))).toMatch(/another device/i);
    expect(manualIssueErrorMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });
});

describe("normalisation and exports", () => {
  it("normalises RPC rows including segments", () => {
    const n = normaliseIssue({
      id: "x",
      vineyard_id: "v1",
      title: "T",
      latitude: "-33.5",
      segments: [{ row_number: 3, segment_number: 2 }],
    });
    expect(n.latitude).toBe(-33.5);
    expect(n.segments).toEqual([{ row: 3, segment: 2 }]);
    expect(n.status).toBe("open");
  });

  it("exports one row per issue with a stable header", () => {
    const ctx = {
      vineyardName: "Stockmans Ridge",
      paddockName: () => "Block A",
      memberName: () => "Sam",
      formatDate: (v: string | null) => v ?? "",
    };
    const rows = manualIssueExportRows([issue()], ctx);
    expect(rows[0][0]).toBe("Broken post");
    expect(rows[0][1]).toBe("Open");
    const csv = manualIssuesCsv([issue({ title: 'Post, "broken"' })], ctx);
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain('"Post, ""broken"""');
  });
});
