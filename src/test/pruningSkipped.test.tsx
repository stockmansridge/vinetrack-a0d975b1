// SQL 168 — "Mark as skipped" now lives inside the single Record Pruning
// workflow (PruningActivityDialog). Skipped pruning counts towards progress
// but never towards labour, cost, vines pruned or productivity, and never
// creates a Work Task.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import PruningActivityDialog from "@/components/pruning/PruningActivityDialog";
import { calculatePruningSummary } from "@/lib/pruningSummaryCalc";
import { buildRowCompletion } from "@/lib/pruningCalc";
import type { PruningRowSegment } from "@/lib/pruningQuery";
import type { PruningActivityRow } from "@/lib/pruningActivityQuery";
import { recordSkippedPruningEntry, ensurePruningSeasonId } from "@/lib/pruningQuery";
import { allocationKey, type BlockAllocationDraft } from "@/lib/pruningActivityContract";

const saveActivity = vi.fn(async () => ({ error: null, stale: false, conflicts: [], activity: null }));

vi.mock("@/lib/pruningActivityApi", () => ({
  usePruningActivityDetail: () => ({ data: null, isLoading: false, error: null }),
  useSavePruningActivity: () => ({ mutateAsync: saveActivity, isPending: false }),
}));
vi.mock("@/lib/pruningQuery", () => ({
  recordSkippedPruningEntry: vi.fn(async () => ({ entry_id: "e1", requested: 1, attributed: 1 })),
  ensurePruningSeasonId: vi.fn(async () => "season-1"),
}));
vi.mock("@/hooks/useTeamLookup", () => ({ useTeamLookup: () => ({ resolve: () => null }) }));
vi.mock("@/components/pruning/ActivityWorkTaskField", () => ({
  default: () => <div>Work Task</div>,
}));

// Stand-in for the real allocation editor: the row/quarter controls stay in
// the same place, we just drive them deterministically here.
vi.mock("@/components/pruning/MultiBlockAllocationEditor", () => ({
  default: ({ value, onChange }: any) => {
    const add = (paddockId: string, row: number, segment: number) => {
      const existing: BlockAllocationDraft = value[paddockId] ?? {
        paddockId, paddockName: `Block ${paddockId}`, variety: "Shiraz",
        quarters: {}, seasonId: null,
      };
      onChange({
        ...value,
        [paddockId]: {
          ...existing,
          quarters: {
            ...existing.quarters,
            [allocationKey(row, segment)]: {
              rowNumber: row, segmentNumber: segment,
              paddockRowId: `row-${row}`, rowLabel: String(row), vines: 20,
            },
          },
        },
      });
    };
    return (
      <div>
        <div>Blocks and rows</div>
        <button onClick={() => add("p1", 68, 1)}>Row 68 quarter 1</button>
        <button onClick={() => add("p1", 68, 2)}>Row 68 quarter 2</button>
        <button onClick={() => add("p2", 5, 1)}>Block 2 row 5 quarter 1</button>
      </div>
    );
  },
}));

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PruningActivityDialog
        open
        onOpenChange={() => {}}
        vineyardId="v1"
        seasonYear={2026}
      />
    </QueryClientProvider>,
  );
}

const toggleSkip = () => fireEvent.click(screen.getByLabelText("Mark selected rows as skipped"));

describe("Record Pruning dialog — skipped mode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the skipped toggle in the activity dialog", () => {
    renderDialog();
    expect(screen.getByLabelText("Mark selected rows as skipped")).toBeTruthy();
    expect(screen.getByText("Record activity")).toBeTruthy();
  });

  it("hides worker, method, times and Work Task when skipped is on", () => {
    renderDialog();
    expect(screen.getByText("Worker / crew")).toBeTruthy();
    toggleSkip();
    expect(screen.queryByText("Worker / crew")).toBeNull();
    expect(screen.queryByText("Method")).toBeNull();
    expect(screen.queryByText("Start")).toBeNull();
    expect(screen.queryByText("Finish")).toBeNull();
    expect(screen.queryByText("Work Task")).toBeNull();
  });

  it("keeps date, notes and the block/row selector visible, and renames the button", () => {
    renderDialog();
    toggleSkip();
    expect(screen.getByText("Date")).toBeTruthy();
    expect(screen.getByText("Notes")).toBeTruthy();
    expect(screen.getByText("Blocks and rows")).toBeTruthy();
    expect(screen.getByText("Row 68 quarter 1")).toBeTruthy();
    expect(screen.getByText("Mark skipped")).toBeTruthy();
    expect(screen.queryByText("Record activity")).toBeNull();
  });

  it("requires at least one selected row section", async () => {
    renderDialog();
    toggleSkip();
    fireEvent.click(screen.getByText("Mark skipped"));
    await waitFor(() =>
      expect(screen.getByText("Select at least one row or row section to mark as skipped.")).toBeTruthy());
    expect(recordSkippedPruningEntry).not.toHaveBeenCalled();
  });

  it("confirms, then saves one canonical segment payload per block", async () => {
    renderDialog();
    toggleSkip();
    fireEvent.click(screen.getByText("Row 68 quarter 1"));
    fireEvent.click(screen.getByText("Row 68 quarter 2"));
    fireEvent.click(screen.getByText("Mark skipped"));

    await waitFor(() => expect(screen.getByText("Mark selected rows as skipped?")).toBeTruthy());
    fireEvent.click(screen.getByText("Mark Skipped"));

    await waitFor(() => expect(recordSkippedPruningEntry).toHaveBeenCalledTimes(1));
    const payload = (recordSkippedPruningEntry as any).mock.calls[0][0];
    expect(payload.paddockId).toBe("p1");
    expect(payload.seasonId).toBe("season-1");
    expect(payload.seasonYear).toBe(2026);
    expect(payload.segments.map((s: any) => [s.rowNumber, s.segmentNumber])).toEqual([[68, 1], [68, 2]]);
    expect(payload).not.toHaveProperty("labourHours");
    expect(payload).not.toHaveProperty("workTaskId");
    expect(ensurePruningSeasonId).toHaveBeenCalled();
    expect(saveActivity).not.toHaveBeenCalled();
  });

  it("saves multiple blocks as one user action, one skipped entry per block", async () => {
    renderDialog();
    toggleSkip();
    fireEvent.click(screen.getByText("Row 68 quarter 1"));
    fireEvent.click(screen.getByText("Block 2 row 5 quarter 1"));
    fireEvent.click(screen.getByText("Mark skipped"));
    await waitFor(() => expect(screen.getByText("Mark selected rows as skipped?")).toBeTruthy());
    fireEvent.click(screen.getByText("Mark Skipped"));

    await waitFor(() => expect(recordSkippedPruningEntry).toHaveBeenCalledTimes(2));
    const blocks = (recordSkippedPruningEntry as any).mock.calls.map((c: any[]) => c[0].paddockId);
    expect(blocks.sort()).toEqual(["p1", "p2"]);
  });

  it("normal mode still uses the parent activity save path", async () => {
    renderDialog();
    fireEvent.click(screen.getByText("Row 68 quarter 1"));
    fireEvent.click(screen.getByText("Record activity"));
    await waitFor(() => expect(saveActivity).toHaveBeenCalledTimes(1));
    expect(recordSkippedPruningEntry).not.toHaveBeenCalled();
  });
});

describe("Pruning block page controls", () => {
  const src = readFileSync("src/pages/tools/PruningTrackerPage.tsx", "utf8");

  it("no longer shows Settings or Add pruning entry on the block page", () => {
    expect(src).not.toContain("Add pruning entry");
    expect(src).not.toContain("CompleteTodayDialog");
    expect(src).not.toContain("SeasonDialog");
    expect(src).not.toMatch(/>\s*Settings\s*</);
  });

  it("keeps a single Record Pruning action", () => {
    expect(src.match(/label="Record Pruning"/g)?.length).toBe(1);
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

  const identities = (nums: number[]) => nums.map((n, idx) => ({
    paddockRowId: `row-${n}`, rowNumber: n, rowLabel: String(n),
    order: idx, lengthM: 100, estimatedVines: 80,
  }));

  it("counts skipped quarters as complete but marks them separately", () => {
    const completion = buildRowCompletion(
      identities([1, 2]) as any,
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
    const completion = buildRowCompletion(
      identities([1]) as any, [segment(1, 1, "skip-1", false)], new Set(["skip-1"]),
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
