import { scheduleCell } from "@/lib/workTaskSchedule";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";

// In-memory work_tasks table with filter-aware update (supports sync_version guard).
const db = vi.hoisted(() => ({ rows: new Map<string, any>(), updates: [] as any[] }));
vi.mock("@/integrations/ios-supabase/client", () => {
  const from = (_table: string) => {
    const filters: [string, any][] = [];
    let patch: any = null;
    const match = () =>
      [...db.rows.values()].find((r) => filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)));
    const run = () => {
      const row = match();
      if (patch) {
        if (!row) return { data: null, error: null };
        Object.assign(row, patch);
        db.updates.push(patch);
      }
      return { data: row ? { ...row } : null, error: null };
    };
    const chain: any = {
      select: () => chain,
      update: (p: any) => { patch = p; return chain; },
      eq: (k: string, v: any) => { filters.push([k, v]); return chain; },
      is: (k: string, v: any) => { filters.push([k, v]); return chain; },
      single: async () => run(),
      maybeSingle: async () => run(),
    };
    return chain;
  };
  return { supabase: { from } };
});
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import {
  completeWorkTask,
  reopenWorkTask,
  setWorkTaskCompletedDate,
  updateWorkTask,
  WorkTaskCompletionConflictError,
  type WorkTask,
} from "@/lib/workTasksQuery";
import {
  calendarDate,
  completionLabel,
  displayCompletedDate,
  todayLocal,
  validateCompletedDate,
  workDateOf,
} from "@/lib/workTaskCompletion";
import { WorkTaskCompletionSection } from "@/components/work-tasks/WorkTaskCompletionSection";

const seed = (over: Partial<WorkTask> = {}) => {
  const row = {
    id: "t1", vineyard_id: "v", sync_version: 3, start_date: "2026-09-28T00:00:00+00:00",
    date: "2026-09-28T00:00:00+00:00", end_date: null, is_finalized: false,
    finalized_at: null, finalized_by: null, deleted_at: null, ...over,
  };
  db.rows.set(row.id, row);
  return { ...row } as WorkTask;
};
beforeEach(() => { db.rows.clear(); db.updates.length = 0; });

describe("calendar dates", () => {
  it("1. full timestamp Work Date normalises to YYYY-MM-DD", () => {
    expect(calendarDate("2026-09-28T00:00:00+00:00")).toBe("2026-09-28");
    expect(calendarDate("2026-09-28")).toBe("2026-09-28");
    expect(calendarDate("garbage")).toBeNull();
    expect(workDateOf({ start_date: "2026-09-28T00:00:00+00:00" })).toBe("2026-09-28");
  });

  it("2. same-day completion is valid against a timestamp Work Date", () => {
    expect(validateCompletedDate("2026-09-28", "2026-09-28T00:00:00+00:00", "2026-10-05")).toBeNull();
    expect(validateCompletedDate("2026-09-27", "2026-09-28T00:00:00+00:00", "2026-10-05")).toMatch(/before/);
    expect(validateCompletedDate("2026-10-06", "2026-09-28", "2026-10-05")).toMatch(/future/);
  });

  it("3. same-day range displays one date; multi-day shows a range", () => {
    const src = readFileSync("src/pages/setup/WorkTasksPage.tsx", "utf8");
    const body = src.slice(src.indexOf("const mkDateRangeLabel"), src.indexOf("const effectiveStart"));
    // Re-evaluate the real label function with a trivial formatter.
    const factory = new Function(
      "mkFmtDate", "scheduleCell",
      body.replace(/: RegionFormatters/g, "").replace(/, timeZone\?: string \| null/, ", timeZone")
        .replace(/\(t: WorkTask\)/g, "(t)") + "; return mkDateRangeLabel;",
    );
    const mk = factory(
      () => (v: string) => v, scheduleCell,
    );
    const label = mk({}, "Australia/Sydney");
    const base = { start_date: "2026-09-28T00:00:00+00:00", is_finalized: true };
    expect(label({ ...base, end_date: "2026-09-28" })).toBe("2026-09-28");
    expect(label({ ...base, end_date: "2026-09-30T00:00:00+00:00" })).toBe("2026-09-28 → 2026-09-30");
  });

  it("4. today uses the vineyard timezone", () => {
    const now = new Date("2026-10-05T14:30:00Z"); // 01:30 6 Oct in Sydney
    expect(todayLocal("Australia/Sydney", now)).toBe("2026-10-06");
    expect(todayLocal("America/Los_Angeles", now)).toBe("2026-10-05");
  });

  it("5. legacy finalized_at fallback uses the vineyard-local day", () => {
    const t = { is_finalized: true, end_date: null, finalized_at: "2026-10-05T14:30:00Z" };
    expect(displayCompletedDate(t, "Australia/Sydney")).toBe("2026-10-06");
    expect(displayCompletedDate(t, "America/Los_Angeles")).toBe("2026-10-05");
    expect(displayCompletedDate({ ...t, finalized_at: null })).toBeNull();
    expect(displayCompletedDate({ is_finalized: true, end_date: "2026-09-30T00:00:00+00:00", finalized_at: t.finalized_at }, "Australia/Sydney")).toBe("2026-09-30");
  });
});

describe("completion writes", () => {
  it("Complete writes all four fields; date edit keeps audit; reopen clears", async () => {
    const t = seed();
    const done = await completeWorkTask(t, "2026-09-30", "u1");
    expect(done).toMatchObject({ is_finalized: true, end_date: "2026-09-30", finalized_by: "u1", sync_version: 4 });
    expect(done.finalized_at).toBeTruthy();
    expect(done.start_date).toBe(t.start_date);
    const audit = done.finalized_at;
    const edited = await setWorkTaskCompletedDate(done, "2026-09-29", "u2");
    expect(edited).toMatchObject({ end_date: "2026-09-29", finalized_at: audit, finalized_by: "u1" });
    const reopened = await reopenWorkTask(edited, "u1");
    expect(reopened).toMatchObject({ is_finalized: false, end_date: null, finalized_at: null, finalized_by: null });
    expect(reopened.start_date).toBe(t.start_date);
  });

  it("7. stale sync_version never overwrites a newer version", async () => {
    const stale = seed({ sync_version: 3 });
    db.rows.get("t1").sync_version = 9; // Android edited meanwhile, still To do
    const saved = await completeWorkTask(stale, "2026-09-30", "u1");
    expect(saved.sync_version).toBe(10);

    // Android already completed it → Portal Complete must refuse, not overwrite.
    seed({ sync_version: 12, is_finalized: true, end_date: "2026-09-30" });
    await expect(completeWorkTask({ id: "t1", sync_version: 3 }, "2026-10-01", "u1"))
      .rejects.toBeInstanceOf(WorkTaskCompletionConflictError);
    expect(db.rows.get("t1")).toMatchObject({ sync_version: 12, end_date: "2026-09-30" });
  });

  it("ordinary edit never writes completion fields", async () => {
    seed({ is_finalized: true, end_date: "2026-09-30", finalized_at: "x", finalized_by: "u1" });
    await updateWorkTask({ id: "t1", vineyard_id: "v", start_date: "2026-09-28", end_date: null, is_finalized: false } as any);
    expect(db.rows.get("t1")).toMatchObject({ is_finalized: true, end_date: "2026-09-30", finalized_at: "x", finalized_by: "u1" });
  });
});

describe("6. open drawer adopts the saved row", () => {
  function Harness({ initial }: { initial: WorkTask }) {
    // Mirrors WorkTasksPage: drawer driven by `selected`, onSaved adopts saved row.
    const [selected, setSelected] = useState<WorkTask | null>(initial);
    return selected ? (
      <WorkTaskCompletionSection
        task={selected}
        userId="u1"
        timeZone="Australia/Sydney"
        fmtDate={(v) => v ?? "—"}
        onSaved={(saved) => { if (saved) setSelected((c) => (c && c.id === saved.id ? saved : c)); }}
      />
    ) : null;
  }

  it("Complete then Reopen update the open drawer without closing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(new Date("2026-10-05T03:00:00Z"));
    const t = seed();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Harness initial={t} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("To do")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    fireEvent.change(screen.getByLabelText("Completed Date"), { target: { value: "2026-09-30" } });
    const confirm = screen.getAllByRole("button", { name: "Complete" }).pop()!;
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-09-30")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(screen.getByText("To do")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Complete" })).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("page wiring", () => {
  it("first save transitions to Save changes, never a second create; timezone passed", () => {
    const src = readFileSync("src/pages/setup/WorkTasksPage.tsx", "utf8");
    expect(src).toContain("isNew && !savedTaskId\n        ? await createWorkTask(input)");
    expect(src).toContain('isNew && !savedTaskId ? "Save & add resources" : "Save changes"');
    expect(src).toContain("Work Task saved. You can now add Labour, Machine Work and Materials below.");
    expect(src).toContain("timeZone={vineyardTimeZone}");
    expect(src).toContain("setSelected((cur) => (cur && cur.id === saved.id ? saved : cur))");
    expect(completionLabel({ is_finalized: false })).toBe("To do");
  });
});
