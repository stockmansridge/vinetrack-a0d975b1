import { afterEach, describe, expect, it, vi } from "vitest";
import { MutationCache, QueryClient } from "@tanstack/react-query";
import {
  ALLOW_READ_ONLY,
  ReadOnlyBlockedError,
  guardMutation,
  handleMutationError,
  isReadOnlyError,
  readOnlyStore,
  resolveVineyardWriteAccess,
} from "@/lib/vineyardWriteAccess";

const base = {
  can_enter_vineyard: true,
  can_write: true,
  read_only_reason: null,
  is_trial: false,
  vineyard_access_reason: null,
  membership_role: "owner",
};

afterEach(() => {
  readOnlyStore.setReadOnly(false);
  readOnlyStore.closePrompt();
});

describe("vineyard write access", () => {
  it("paid / legacy / manual / team rows keep writing", () => {
    for (const role of ["owner", "manager", "supervisor", "operator"])
      expect(resolveVineyardWriteAccess({ ...base, membership_role: role })).toEqual({
        canEnter: true, canWrite: true, readOnlyReason: null,
      });
  });
  it("missing can_write defaults to writable (older backend)", () => {
    const { can_write: _omit, ...row } = base;
    expect(resolveVineyardWriteAccess({ ...(row as any), can_write: undefined }).canWrite).toBe(true);
  });
  it("server expired trial: enter, read-only", () => {
    expect(
      resolveVineyardWriteAccess({ ...base, is_trial: true, can_write: false, read_only_reason: "trial_expired" }),
    ).toEqual({ canEnter: true, canWrite: false, readOnlyReason: "trial_expired" });
  });
  it("transitional: denied expired trial with membership becomes read-only", () => {
    expect(
      resolveVineyardWriteAccess({ ...base, can_enter_vineyard: false, is_trial: true, vineyard_access_reason: "expired" }),
    ).toEqual({ canEnter: true, canWrite: false, readOnlyReason: "trial_expired" });
  });
  it("revoked, unfunded, non-trial expired or role-less rows stay blocked", () => {
    const denied = { ...base, can_enter_vineyard: false };
    expect(resolveVineyardWriteAccess({ ...denied, vineyard_access_reason: "revoked", is_trial: true }).canEnter).toBe(false);
    expect(resolveVineyardWriteAccess({ ...denied, vineyard_access_reason: "no_vineyard_entitlement" }).canEnter).toBe(false);
    expect(resolveVineyardWriteAccess({ ...denied, vineyard_access_reason: "expired" }).canEnter).toBe(false);
    expect(
      resolveVineyardWriteAccess({ ...denied, vineyard_access_reason: "expired", is_trial: true, membership_role: null }).canEnter,
    ).toBe(false);
    expect(resolveVineyardWriteAccess(null).canEnter).toBe(false);
  });

  it("guard blocks writes before they run and opens the prompt", async () => {
    const qc = new QueryClient({
      mutationCache: new MutationCache({
        onMutate: (_v, m) => guardMutation(m.meta as any),
        onError: (e) => handleMutationError(e),
      }),
    });
    readOnlyStore.setReadOnly(true, "trial_expired");
    const fn = vi.fn(async () => "saved");
    const m = qc.getMutationCache().build(qc, { mutationFn: fn });
    await expect(m.execute(undefined)).rejects.toBeInstanceOf(ReadOnlyBlockedError);
    expect(fn).not.toHaveBeenCalled();
    expect(readOnlyStore.get().promptOpen).toBe(true);
  });
  it("allow-listed mutations (billing, invites) still run in read-only mode", async () => {
    const qc = new QueryClient({
      mutationCache: new MutationCache({ onMutate: (_v, m) => guardMutation(m.meta as any) }),
    });
    readOnlyStore.setReadOnly(true, "trial_expired");
    const fn = vi.fn(async () => "ok");
    await qc.getMutationCache().build(qc, { mutationFn: fn, meta: ALLOW_READ_ONLY }).execute(undefined);
    expect(fn).toHaveBeenCalledOnce();
  });
  it("writable vineyards are never blocked", () => {
    expect(() => guardMutation(undefined)).not.toThrow();
  });
  it("server VT_READ_ONLY denial opens the same prompt", () => {
    expect(isReadOnlyError({ code: "P0001", message: "VT_READ_ONLY: trial_expired" })).toBe(true);
    expect(isReadOnlyError({ code: "42501", message: "permission denied" })).toBe(false);
    handleMutationError({ hint: "VT_READ_ONLY" });
    expect(readOnlyStore.get().promptOpen).toBe(true);
  });
});
