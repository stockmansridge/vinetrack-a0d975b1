import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

const rpcCalls: string[] = [];
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: (name: string) => { rpcCalls.push(name); return Promise.resolve({ data: null, error: null }); } },
}));

import { approveV3, rejectV3 } from "@/lib/chemicalV3";

const page = fs.readFileSync("src/pages/admin/ChemicalV3LabPage.tsx", "utf8");
beforeEach(() => { rpcCalls.length = 0; });

describe("Catalogue Review approve/reject paths", () => {
  it("Reject calls only reject_chemical_v3_revision", async () => {
    await rejectV3("r1", "wrong product");
    expect(rpcCalls).toEqual(["reject_chemical_v3_revision"]);
  });
  it("Approve calls only approve_chemical_v3_revision", async () => {
    await approveV3("r1", null);
    expect(rpcCalls).toEqual(["approve_chemical_v3_revision"]);
  });
  it("Reject still requires a nonblank note", async () => {
    await expect(rejectV3("r1", "  ")).rejects.toThrow();
    expect(rpcCalls).toEqual([]);
  });
  it("page wires Reject and Approve to independent mutations", () => {
    expect(page).toContain("mutationFn: async () => rejectV3(revisionId!, note)");
    expect(page).toContain("mutationFn: async () => approveV3(revisionId!, note)");
    expect(page).toContain("rejectMut.mutate()");
    expect(page).toContain("onClick={() => approveMut.mutate()}");
    expect(page).not.toMatch(/\?\s*approveV3\([^)]*\)\s*:\s*rejectV3/);
    expect(page).not.toContain('act.mutate("reject")');
  });
});
