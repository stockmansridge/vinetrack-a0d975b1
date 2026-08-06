// SQL 168 — "Mark as skipped" portal contract.
//
// Skipped pruning counts towards progress but never towards labour, cost,
// vines pruned or productivity, and never creates a Work Task. These tests
// pin the portal to the same behaviour as iOS and Android.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import CompleteTodayDialog from "@/components/pruning/CompleteTodayDialog";
import type { PruningSeason, PruningRowSegment } from "@/lib/pruningQuery";
import { buildRowCompletion, type RowCompletionState } from "@/lib/pruningCalc";
import { calculatePruningSummary } from "@/lib/pruningSummaryCalc";
import type { PruningActivityRow } from "@/lib/pruningActivityQuery";
import { createWorkTask, createLabourLine } from "@/lib/workTasksQuery";

const recordSkipped = vi.fn(async () => ({ entry_id: "e-skip", requested: 4, attributed: 4 }));
const recordNormal = vi.fn(async () => ({ entry_id: "e1", requested: 4, attributed: 4 }));

vi.mock("@/lib/pruningQuery", async () => {
  const actual = await vi.importActual<any>("@/lib/pruningQuery");
  return {
    ...actual,
    useRecordPruningEntry: () => ({ mutateAsync: recordNormal, isPending: false }),
    useRecordSkippedPruningEntry: () => ({ mutateAsync: recordSkipped, isPending: false }),
  };
});
vi.mock("@/lib/workTasksQuery", () => ({
  createWorkTask: vi.fn(),
  createLabourLine: vi.fn(),
  syncWorkTaskPaddocks: vi.fn(),
  fetchWorkTaskPaddocksForVineyard: vi.fn(async () => []),
}));
vi.mock("@/lib/operatorCategoriesQuery", () => ({
  fetchOperatorCategoriesForVineyard: vi.fn(async () => ({ categories: [] })),
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ currentRole: "owner" }) }));
vi.mock("@/lib/permissions", () => ({ useCanSeeCosts: () => true }));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: false, loading: false }) }));

const season: PruningSeason = {
  id: "s1", vineyard_id: "v1", paddock_id: "p1", season_year: 2026,
  start_date: null, due_date: null, pruning_method: "spur", assigned_crew: "",
  working_days: [1, 2, 3, 4, 5], manual_row_count: null, estimated_labour_hours: null,
  notes: "", status: "active", created_at: "", updated_at: "", deleted_at: null,
};

function rows(nums: number[]): RowCompletionState[] {
  return nums.map((n, idx) => ({
    identity: {
      paddockRowId: `row-${n}`, rowNumber: n, rowLabel: String(n),
      order: idx, lengthM: 100, estimatedVines: 80,
    },
    completed: new Set<number>(),
    skipped: new Set<number>(),
  }));
}

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CompleteTodayDialog
        open
        onOpenChange={() => {}}
        season={season}
        vineyardId="v1"
        paddockId="p1"
        paddockName="Block A"
        rows={rows([1, 2])}
      />
    </QueryClientProvider>,
  );
}

const toggleSkip = () => fireEvent.click(screen.getByLabelText("Mark as skipped"));

describe("skipped pruning entry form", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hides labour, worker, method and Work Task fields when skipped is on", () => {
    renderDialog();
    expect(screen.getByText("Worker or crew")).toBeTruthy();
    toggleSkip();
    expect(screen.queryByText("Worker or crew")).toBeNull();
    expect(screen.queryByText("Labour hours")).toBeNull();
    expect(screen.queryByText("Method")).toBeNull();
    expect(screen.queryByText("Create a Work Task for this pruning work")).toBeNull();
  });

  it("keeps date and the existing row-selection controls available", () => {
    renderDialog();
    toggleSkip();
    expect(screen.getByText("Date")).toBeTruthy();
    expect(screen.getByPlaceholderText(/Row ranges/)).toBeTruthy();
    expect(screen.getByText("Select all incomplete")).toBeTruthy();
    expect(screen.getByLabelText("Row 1 quarter 1")).toBeTruthy();
  });

  it("saves a skipped entry with no Work Task, labour or cost", async () => {
    renderDialog();
    toggleSkip();
    fireEvent.click(screen.getByLabelText("Row 1 quarter 1"));
    fireEvent.click(screen.getByText(/Mark 1 quarter skipped/));

    await waitFor(() => expect(recordSkipped).toHaveBeenCalledTimes(1));
    const payload = recordSkipped.mock.calls[0][0] as any;
    expect(payload.segments).toHaveLength(1);
    expect(payload.paddockId).toBe("p1");
    expect(payload).not.toHaveProperty("labourHours");
    expect(payload).not.toHaveProperty("workTaskId");
    expect(recordNormal).not.toHaveBeenCalled();
    expect(createWorkTask).not.toHaveBeenCalled();
    expect(createLabourLine).not.toHaveBeenCalled();
  });
});

describe("skipped quarters in progress and statistics", () => {
  const segment = (
    row: number, seg: number, entryId: string, completed = true,
  ): PruningRowSegment => ({
    id: `${row}-${seg}`, pruning_entry_id: entryId, pruning_season_id: "s1",
    vineyard_id: "v1", paddock_id: "p1", paddock_row_id: `row-${row}`,
    row_number: row, segment_number: seg, row_label: String(row),
    completed, completed_at: null, completed_by: null, created_at: "",
  });

  it("counts skipped quarters as complete but marks them separately", () => {
    const identities = rows([1, 2]).map((r) => r.identity);
    const completion = buildRowCompletion(
      identities,
      [segment(1, 1, "pruned"), segment(2, 1, "skip-1"), segment(2, 2, "skip-1")],
      new Set(["skip-1"]),
    );
    const [rowOne, rowTwo] = completion;
    expect(rowOne.completed.size).toBe(1);
    expect(rowOne.skipped.size).toBe(0);
    expect(rowTwo.completed.size).toBe(2); // progress still counts them
    expect([...rowTwo.skipped].sort()).toEqual([1, 2]);
  });

  it("drops skipped quarters again after reversal", () => {
    const identities = rows([1]).map((r) => r.identity);
    const completion = buildRowCompletion(
      identities, [segment(1, 1, "skip-1", false)], new Set(["skip-1"]),
    );
    expect(completion[0].completed.size).toBe(0);
    expect(completion[0].skipped.size).toBe(0);
  });

  const activityRow = (over: Partial<PruningActivityRow>): PruningActivityRow => ({
    id: "r", entry: {} as any, activityId: null, date: "2026-08-04", seasonYear: 2026,
    pruningSeasonId: "s1", hasSeasonLink: true, expectedSeasonYear: 2026,
    seasonIssues: [], seasonMismatch: false, sourcePlatform: null, vintageYear: 2027,
    paddockId: "p1", blockName: "Block A", variety: "Shiraz", worker: "Sam",
    method: "spur", rowNumbers: [1], rowsLabel: "1", rowCount: 1, quarters: 4,
    rowEquivalents: 1, vines: 100, labourHours: 2, startTime: null, finishTime: null,
    durationMinutes: null, vinesPerHour: null, rowEqPerHour: null, workTaskId: "t1",
    workTaskLabel: "Pruning", workTaskStatus: "completed", workTaskMissing: false,
    activityTitle: null, labourCost: 100, hourlyRate: 50, notes: "",
    createdById: null, createdAt: null, updatedAt: null, isReversed: false,
    isSkipped: false, groupKey: "r", activityBlockCount: 1, allocationIndex: 1,
    isPrimaryAllocation: true, allocationShare: 1, allocatedHours: 2,
    allocatedCost: 100, activityHours: 2, activityCost: 100,
    activityLabel: "Pruning", activityLabelKind: "task",
    ...over,
  });

  it("excludes skipped allocations from vines, labour, cost and productivity", () => {
    const pruned = activityRow({ id: "a", groupKey: "a" });
    const skipped = activityRow({
      id: "b", groupKey: "b", isSkipped: true, vines: 0, labourHours: null,
      labourCost: null, activityHours: null, activityCost: null,
      allocatedHours: 0, allocatedCost: null, activityLabel: "Skipped",
    });

    const withSkip = calculatePruningSummary([pruned, skipped]);
    const without = calculatePruningSummary([pruned]);

    expect(withSkip.vines).toBe(without.vines);
    expect(withSkip.labourHours).toBe(without.labourHours);
    expect(withSkip.labourCost).toBe(without.labourCost);
    expect(withSkip.vinesPerLabourHour).toBe(without.vinesPerLabourHour);
    expect(withSkip.activities).toBe(1);
    expect(withSkip.skippedCount).toBe(1);
    expect(withSkip.skippedQuarters).toBe(4);
  });
});
