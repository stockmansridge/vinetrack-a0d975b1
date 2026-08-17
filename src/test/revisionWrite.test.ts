import { describe, it, expect, vi } from "vitest";
import {
  revisionWrite,
  isRevisionConflict,
  RevisionConflictError,
  serverRevisionOf,
} from "@/lib/revisionWrite";

const ok = (row: any) => async () => ({ data: row, error: null });

describe("SQL 198 revision write helper", () => {
  it("sends base_revision as the loaded server_revision (never +1)", async () => {
    const run = vi.fn(ok({ id: "a", server_revision: 8 }) as (p: Record<string, unknown>) => Promise<{ data: any; error: null }>);
    await revisionWrite({ run, payload: { name: "x" }, baseRevision: 7 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toMatchObject({ name: "x", base_revision: 7 });
  });

  it("returns the authoritative row so the caller can replace its revision", async () => {
    const row = await revisionWrite<any>({
      run: ok({ id: "a", server_revision: 9 }),
      payload: {},
      baseRevision: 8,
    });
    expect(serverRevisionOf(row)).toBe(9);
  });

  it("omits base_revision for a new row", async () => {
    const run = vi.fn(ok({ id: "a", server_revision: 1 }) as (p: Record<string, unknown>) => Promise<{ data: any; error: null }>);
    await revisionWrite({ run, payload: { name: "x" }, baseRevision: null });
    expect(run.mock.calls[0][0]).not.toHaveProperty("base_revision");
  });

  it("classifies a stale base_revision as a revision conflict", async () => {
    const run = vi.fn(async () => ({
      data: null,
      error: { code: "PT409", message: "REVISION_CONFLICT" },
    }));
    await expect(
      revisionWrite({ run, payload: {}, baseRevision: 3 }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("treats an empty representation on a versioned update as a conflict, not success", async () => {
    await expect(
      revisionWrite({ run: ok(null), payload: {}, baseRevision: 4 }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("never auto-retries on conflict", async () => {
    const run = vi.fn(async () => ({ data: null, error: { code: "PT409" } }));
    await expect(revisionWrite({ run, payload: {}, baseRevision: 1 })).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("attaches the latest server row to the conflict without overwriting caller state", async () => {
    const latest = { id: "a", server_revision: 12 };
    const err = await revisionWrite({
      run: async () => ({ data: null, error: { code: "PT409" } }),
      payload: {},
      baseRevision: 1,
      refetch: async () => latest,
    }).catch((e) => e as RevisionConflictError);
    expect(err).toBeInstanceOf(RevisionConflictError);
    expect((err as RevisionConflictError).latest).toEqual(latest);
  });

  it("does not classify an unrelated 409 (23505 unique_violation) as a revision conflict", async () => {
    const error = { code: "23505", message: "duplicate key value violates unique constraint" };
    expect(isRevisionConflict(error)).toBe(false);
    await expect(revisionWrite({ run: async () => ({ data: null, error }), payload: {}, baseRevision: 2 }))
      .rejects.toMatchObject({ code: "23505" });
  });

  it("keeps auth and permission errors intact", async () => {
    for (const error of [
      { code: "401", message: "JWT expired" },
      { code: "42501", message: "permission denied for table" },
    ]) {
      expect(isRevisionConflict(error)).toBe(false);
      await expect(
        revisionWrite({ run: async () => ({ data: null, error }), payload: {}, baseRevision: 1 }),
      ).rejects.toMatchObject({ code: error.code });
    }
  });

  it("keeps 5xx server errors intact", async () => {
    const error = { code: "500", message: "Internal Server Error" };
    expect(isRevisionConflict(error)).toBe(false);
    await expect(
      revisionWrite({ run: async () => ({ data: null, error }), payload: {}, baseRevision: 1 }),
    ).rejects.toMatchObject({ code: "500" });
  });

  it("ignores the browser clock entirely — only revisions decide staleness", async () => {
    const run = vi.fn(ok({ id: "a", server_revision: 6 }) as (p: Record<string, unknown>) => Promise<{ data: any; error: null }>);
    const skewed = new Date(Date.now() - 86_400_000).toISOString();
    await revisionWrite({
      run,
      payload: { client_updated_at: skewed },
      baseRevision: 5,
    });
    // Sent as metadata, but base_revision is what the server judges.
    expect(run.mock.calls[0][0]).toMatchObject({ client_updated_at: skewed, base_revision: 5 });
  });

  it("serverRevisionOf never invents a revision", () => {
    expect(serverRevisionOf({ server_revision: 3 })).toBe(3);
    expect(serverRevisionOf({ server_revision: "4" })).toBe(4);
    expect(serverRevisionOf({})).toBeNull();
    expect(serverRevisionOf(null)).toBeNull();
  });
});
