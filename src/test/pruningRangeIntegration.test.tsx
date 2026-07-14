import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CompleteTodayDialog from "@/components/pruning/CompleteTodayDialog";
import type { RowCompletionState } from "@/lib/pruningCalc";
import type { PruningSeason } from "@/lib/pruningQuery";

// Mocks — the dialog imports Supabase-backed mutations and auth context.
vi.mock("@/lib/pruningQuery", async () => {
  const actual = await vi.importActual<any>("@/lib/pruningQuery");
  return { ...actual, useRecordPruningEntry: () => ({ mutateAsync: vi.fn(), isPending: false }) };
});
vi.mock("@/lib/workTasksQuery", () => ({ createWorkTask: vi.fn() }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

function makeRows(nums: number[]): RowCompletionState[] {
  return nums.map((n, idx) => ({
    identity: {
      paddockRowId: `row-${n}`,
      rowNumber: n,
      rowLabel: String(n),
      order: idx,
      lengthM: 100,
      estimatedVines: 80,
    },
    completed: new Set<number>(),
  }));
}

const season: PruningSeason = {
  id: "s1", vineyard_id: "v1", paddock_id: "p1", season_year: 2026,
  start_date: null, due_date: null, pruning_method: "spur", assigned_crew: "",
  working_days: [1, 2, 3, 4, 5], manual_row_count: null, estimated_labour_hours: null,
  notes: "", status: "active", created_at: "", updated_at: "", deleted_at: null,
};

function renderDialog(rows: RowCompletionState[]) {
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
        rows={rows}
      />
    </QueryClientProvider>,
  );
}

describe("CompleteTodayDialog — Apply range integration", () => {
  it("selects every incomplete quarter for rows 44-50", () => {
    const rows = makeRows([44, 45, 46, 47, 48, 49, 50]);
    renderDialog(rows);

    const input = screen.getByPlaceholderText(/Row ranges/i);
    fireEvent.change(input, { target: { value: "44-50" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply range/i }));

    // Footer summary should read 28 quarters / 7.00 row equivalents.
    expect(screen.getByText(/28/).textContent).toContain("28");
    expect(screen.getByText(/7\.00/)).toBeTruthy();

    // Each of the 7 rows should have all 4 quarter buttons in the "selected" state
    // (aria-pressed=true and NOT already completed).
    for (const rn of [44, 45, 46, 47, 48, 49, 50]) {
      for (const q of [1, 2, 3, 4]) {
        const btn = screen.getByLabelText(new RegExp(`Row ${rn} quarter ${q}`));
        expect(btn.getAttribute("aria-pressed")).toBe("true");
      }
    }
  });

  it("descending range 50-44 selects the same rows", () => {
    const rows = makeRows([44, 45, 46, 47, 48, 49, 50]);
    renderDialog(rows);
    fireEvent.change(screen.getByPlaceholderText(/Row ranges/i), { target: { value: "50-44" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply range/i }));
    expect(screen.getByText(/7\.00/)).toBeTruthy();
  });

  it("non-sequential configured rows never invents missing rows", () => {
    const rows = makeRows([44, 45, 47, 50]);
    renderDialog(rows);
    fireEvent.change(screen.getByPlaceholderText(/Row ranges/i), { target: { value: "44-50" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply range/i }));
    // 4 rows × 4 quarters = 16 quarters, 4.00 row equivalents
    expect(screen.getByText(/4\.00/)).toBeTruthy();
    for (const rn of [44, 45, 47, 50]) {
      const btn = screen.getByLabelText(new RegExp(`Row ${rn} quarter 1`));
      expect(btn.getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("skips already-completed quarters", () => {
    const rows = makeRows([44, 45, 46]);
    rows[1].completed = new Set([1, 2]); // row 45 Q1, Q2 done
    renderDialog(rows);
    fireEvent.change(screen.getByPlaceholderText(/Row ranges/i), { target: { value: "44-46" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply range/i }));
    // 3 rows × 4 - 2 = 10 quarters, 2.50 row equivalents
    expect(screen.getByText(/2\.50/)).toBeTruthy();
  });

  it("merges with existing selection", () => {
    const rows = makeRows([44, 45, 46, 47]);
    renderDialog(rows);
    // Pre-select row 47 Q1 by clicking it
    fireEvent.click(screen.getByLabelText(/Row 47 quarter 1/));
    fireEvent.change(screen.getByPlaceholderText(/Row ranges/i), { target: { value: "44-46" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply range/i }));
    // 3×4 + 1 = 13 quarters
    const footer = screen.getByText(/quarters/).closest("div");
    expect(footer?.textContent).toMatch(/13/);
  });
});
