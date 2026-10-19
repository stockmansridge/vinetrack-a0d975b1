import { beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateParticipants, fetchActionParticipants, reconcileParticipants } from "./adminActionParticipants";
const api = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/ios-supabase/client", () => ({ iosSupabase: { from: api.from } }));
function response(result: object) {
  const q: any = { select: vi.fn(() => q), order: vi.fn(() => q), range: vi.fn(() => q), gte: vi.fn(() => q), abortSignal: vi.fn(() => q), then: (resolve: any) => Promise.resolve(result).then(resolve) };
  return q;
}
beforeEach(() => vi.clearAllMocks());
describe("Admin activity participants", () => {
  it("counts distinct identities without inventing missing creators", () => {
    expect(aggregateParticipants([{ created_by: "a" }, { created_by: "a" }, { created_by: "b" }, { created_by: null }], "created_by")).toEqual([{ id: "a", records: 2 }, { id: "b", records: 1 }]);
  });
  it("rejects silent RLS empty lists for nonzero dashboard counts", () => {
    expect(() => reconcileParticipants([], 8)).toThrow("do not match");
  });
  it("uses the creation window, not edit time, for a seven-day cohort", async () => {
    const q = response({ data: [{ vineyard_id: "v" }], count: 1 }); api.from.mockReturnValue(q);
    const now = Date.now(); await fetchActionParticipants("trips", "vineyards", 7, 1);
    expect(q.select).toHaveBeenCalledWith("vineyard_id", { count: "exact" });
    expect(q.gte.mock.calls[0][0]).toBe("created_at");
    expect(Math.abs(Date.parse(q.gte.mock.calls[0][1]) - (now - 7 * 86400000))).toBeLessThan(1000);
  });
  it("uses creator precedence and only falls back for absent columns", async () => {
    const missing = response({ error: { code: "42703" } });
    const available = response({ data: [{ created_by_user_id: "u" }], count: 1 });
    api.from.mockReturnValueOnce(missing).mockReturnValueOnce(available);
    expect(await fetchActionParticipants("trips", "users", null, 1)).toEqual([{ id: "u", records: 1 }]);
    expect(missing.select).toHaveBeenCalledWith("created_by", { count: "exact" });
    expect(available.select).toHaveBeenCalledWith("created_by_user_id", { count: "exact" });
    expect(available.gte).not.toHaveBeenCalled();
  });
  it("does not fall back to a different identity when access is denied", async () => {
    api.from.mockReturnValue(response({ error: { code: "42501" } }));
    await expect(fetchActionParticipants("trips", "users", 1, 2)).rejects.toThrow("current access");
    expect(api.from).toHaveBeenCalledTimes(1);
  });
  it("rejects truncated lists even when distinct counts happen to match", async () => {
    api.from.mockReturnValue(response({ data: [{ vineyard_id: "v" }], count: 2000 }));
    await expect(fetchActionParticipants("trips", "vineyards", 1, 1)).rejects.toThrow("incomplete");
  });
  it("paginates complete data and forwards cancellation", async () => {
    const first = response({ data: Array.from({ length: 1000 }, () => ({ vineyard_id: "v" })), count: 1001 });
    const last = response({ data: [{ vineyard_id: "v" }], count: 1001 });
    api.from.mockReturnValueOnce(first).mockReturnValueOnce(last);
    const signal = new AbortController().signal;
    expect(await fetchActionParticipants("trips", "vineyards", null, 1, signal)).toEqual([{ id: "v", records: 1001 }]);
    expect(last.range).toHaveBeenCalledWith(1000, 1999); expect(last.abortSignal).toHaveBeenCalledWith(signal);
  });
  it("rejects arbitrary tables", async () => {
    await expect(fetchActionParticipants("profiles", "users", 1, 1)).rejects.toThrow("not supported");
    expect(api.from).not.toHaveBeenCalled();
  });
});