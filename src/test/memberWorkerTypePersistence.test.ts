import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const fromRow = vi.fn();
const update = vi.fn();

vi.mock("@/integrations/ios-supabase/client", () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => fromRow(),
    update: (...a: unknown[]) => { update(...a); return chain; },
  };
  return { supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => chain } };
});

import { updateMemberWorkerType, updateMemberRole } from "@/lib/memberManagementQuery";

const key = { vineyardId: "v1", userId: "u1" };
const row = (o: object) => ({ vineyard_id: "v1", user_id: "u1", role: "operator", worker_type_id: "wt1", ...o });

beforeEach(() => { rpc.mockReset(); fromRow.mockReset(); update.mockReset(); });

describe("worker type assignment", () => {
  it("calls the live RPC signature", async () => {
    rpc.mockResolvedValue({ data: row({}), error: null });
    await updateMemberWorkerType(key, "wt1");
    expect(rpc).toHaveBeenCalledWith("update_member_worker_type", {
      p_vineyard_id: "v1", p_user_id: "u1", p_worker_type_id: "wt1",
    });
  });

  it("reassignment and explicit clearing are verified", async () => {
    rpc.mockResolvedValue({ data: [row({ worker_type_id: "wt2" })], error: null });
    await expect(updateMemberWorkerType(key, "wt2")).resolves.toMatchObject({ worker_type_id: "wt2" });
    rpc.mockResolvedValue({ data: row({ worker_type_id: null }), error: null });
    await expect(updateMemberWorkerType(key, null)).resolves.toMatchObject({ worker_type_id: null });
  });

  it("mismatched result is a failure", async () => {
    rpc.mockResolvedValue({ data: row({ worker_type_id: "other" }), error: null });
    await expect(updateMemberWorkerType(key, "wt1")).rejects.toThrow(/doesn't match/);
  });

  it("different membership returned is a failure", async () => {
    rpc.mockResolvedValue({ data: row({ user_id: "u2" }), error: null });
    await expect(updateMemberWorkerType(key, "wt1")).rejects.toThrow(/different membership/);
  });

  it("void result is confirmed by re-reading; missing row fails", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    fromRow.mockResolvedValue({ data: row({}), error: null });
    await expect(updateMemberWorkerType(key, "wt1")).resolves.toBeTruthy();
    fromRow.mockResolvedValue({ data: null, error: null });
    await expect(updateMemberWorkerType(key, "wt1")).rejects.toThrow(/not found/);
  });

  it("rejected writes and missing functions surface; never falls back to a table update", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    await expect(updateMemberWorkerType(key, "wt1")).rejects.toMatchObject({ code: "PGRST202" });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(updateMemberWorkerType(key, "wt1")).rejects.toMatchObject({ code: "42501" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("role-only change", () => {
  it("uses the live signature and never touches the worker type", async () => {
    rpc.mockResolvedValue({ data: row({ role: "supervisor", worker_type_id: "wt1" }), error: null });
    const saved = await updateMemberRole(key, "supervisor");
    expect(rpc).toHaveBeenCalledWith("update_member_role", { p_vineyard_id: "v1", p_user_id: "u1", p_role: "supervisor" });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_worker_type_id");
    expect(saved.worker_type_id).toBe("wt1");
    expect(update).not.toHaveBeenCalled();
  });
});
