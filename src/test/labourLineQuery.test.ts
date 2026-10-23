import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: mocks }));
import { fetchLabourLinesForVineyard, softDeleteLabourLine } from "@/lib/workTasksQuery";

describe("Canonical labour-line authority", () => {
  it("fetches only the selected vineyard's rows with deleted_at IS NULL", async () => {
    const is = vi.fn(async () => ({ data: [{ id: "active" }], error: null }));
    const eq = vi.fn(() => ({ is }));
    const select = vi.fn(() => ({ eq }));
    mocks.from.mockReturnValue({ select });
    expect(await fetchLabourLinesForVineyard("vineyard-1")).toEqual([{ id: "active" }]);
    expect(mocks.from).toHaveBeenCalledWith("work_task_labour_lines");
    expect(eq).toHaveBeenCalledWith("vineyard_id", "vineyard-1");
    expect(is).toHaveBeenCalledWith("deleted_at", null);
  });
  it("uses the shared soft-delete RPC, never a hard delete", async () => {
    mocks.from.mockClear();
    mocks.rpc.mockResolvedValue({ error: null });
    await softDeleteLabourLine("line-1", "user-1");
    expect(mocks.rpc).toHaveBeenCalledWith("soft_delete_work_task_labour_line", { p_id: "line-1" });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});