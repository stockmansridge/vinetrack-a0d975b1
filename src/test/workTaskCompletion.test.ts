import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: { table: string; payload: any; id?: string }[] = [];
vi.mock("@/integrations/ios-supabase/client", () => {
  const builder = (table: string) => {
    const rec: any = { table };
    const chain: any = {
      update: (p: any) => { rec.payload = p; calls.push(rec); return chain; },
      eq: (_c: string, id: string) => { rec.id = id; return chain; },
      select: () => chain,
      single: async () => ({ data: { id: rec.id, ...rec.payload }, error: null }),
    };
    return chain;
  };
  return { supabase: { from: builder } };
});

import {
  completeWorkTask,
  reopenWorkTask,
  setWorkTaskCompletedDate,
  updateWorkTask,
} from "@/lib/workTasksQuery";
import {
  completionLabel,
  displayCompletedDate,
  validateCompletedDate,
} from "@/lib/workTaskCompletion";
import { readFileSync } from "node:fs";

beforeEach(() => { calls.length = 0; });
const task = { id: "t1", sync_version: 3 };

describe("Work Task completion", () => {
  it("1. Complete writes is_finalized, end_date, finalized_at (real now) and finalized_by in one write", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-10-05T03:00:00Z"));
    await completeWorkTask(task, "2026-09-30", "u1");
    vi.useRealTimers();
    expect(calls).toHaveLength(1);
    const p = calls[0].payload;
    expect(p.is_finalized).toBe(true);
    expect(p.end_date).toBe("2026-09-30");
    expect(p.finalized_at).toBe("2026-10-05T03:00:00.000Z");
    expect(p.finalized_by).toBe("u1");
    expect(p.sync_version).toBe(4);
    expect("start_date" in p || "date" in p).toBe(false);
  });

  it("2. backdated Completed Date validation", () => {
    expect(validateCompletedDate("2026-09-30", "2026-09-28", "2026-10-05")).toBeNull();
    expect(validateCompletedDate("2026-09-27", "2026-09-28", "2026-10-05")).toMatch(/before the Work Date/);
    expect(validateCompletedDate("2026-10-06", "2026-09-28", "2026-10-05")).toMatch(/future/);
  });

  it("2b. editing Completed Date preserves audit fields", async () => {
    await setWorkTaskCompletedDate(task, "2026-09-29", "u2");
    const p = calls[0].payload;
    expect(p).toMatchObject({ is_finalized: true, end_date: "2026-09-29" });
    expect("finalized_at" in p).toBe(false);
    expect("finalized_by" in p).toBe(false);
  });

  it("3. Reopen clears completion fields only", async () => {
    await reopenWorkTask(task, "u1");
    const p = calls[0].payload;
    expect(p).toMatchObject({ is_finalized: false, end_date: null, finalized_at: null, finalized_by: null });
    for (const k of ["start_date", "date", "description", "notes", "paddock_id", "costing_method"]) {
      expect(k in p).toBe(false);
    }
  });

  it("4. Android-created completed record shows end_date, not the audit date", () => {
    const t = { is_finalized: true, end_date: "2026-09-30", finalized_at: "2026-10-05T03:00:00Z", start_date: "2026-09-28" };
    expect(completionLabel(t)).toBe("Completed");
    expect(displayCompletedDate(t)).toBe("2026-09-30");
    expect(displayCompletedDate({ ...t, end_date: null }, "Australia/Sydney")).toBe("2026-10-05");
    expect(displayCompletedDate({ ...t, end_date: null, finalized_at: null })).toBeNull();
    expect(completionLabel({ is_finalized: false })).toBe("To do");
  });

  it("ordinary edit never writes completion fields", async () => {
    await updateWorkTask({ id: "t1", vineyard_id: "v", start_date: "2026-09-28", end_date: null, is_finalized: false } as any);
    const p = calls[0].payload;
    for (const k of ["is_finalized", "end_date", "finalized_at", "finalized_by"]) expect(k in p).toBe(false);
  });

  it("5. save-first resources wording", () => {
    const src = readFileSync("src/pages/setup/WorkTasksPage.tsx", "utf8");
    expect(src).toContain("Save this Work Task first. You can then add Labour, Machine Work and Materials.");
    expect(src).toContain("Work Task saved. You can now add Labour, Machine Work and Materials below.");
    expect(src).toContain("Save & add resources");
    expect(src).toContain('label="Work Date"');
    expect(src).not.toContain("Task created. Add labour and machine resources");
    expect(src).not.toContain('"in_progress"');
  });
});
