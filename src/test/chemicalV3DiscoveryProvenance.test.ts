import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

const calls: { rpc: any[]; fn: any[] } = { rpc: [], fn: [] };
let rpcReply: Record<string, any> = {};

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: any) => { calls.rpc.push([name, args]); return Promise.resolve(rpcReply[name] ?? { data: null, error: { message: `missing ${name}` } }); },
    from: () => { throw new Error("no table access expected"); },
    functions: { invoke: (n: string, o: any) => { calls.fn.push([n, o]); return Promise.resolve({ error: null }); } },
  },
}));

import * as v3 from "@/lib/chemicalV3";

beforeEach(() => { calls.rpc = []; calls.fn = []; rpcReply = {}; });

const base = { countryCode: "AU", photoPath: null } as const;

describe("Chemical V3 discovery vineyard provenance", () => {
  it("text discovery sends the selected vineyard ID to the V2 RPC", async () => {
    rpcReply.start_chemical_v3_discovery_v2 = { data: [{ job_id: "j1", reused: false, status: "queued" }], error: null };
    await v3.startV3Discovery({ ...base, query: "Roundup", inputKind: "text", vineyardId: "vy-1" });
    expect(calls.rpc[0][0]).toBe("start_chemical_v3_discovery_v2");
    expect(calls.rpc[0][1].p_vineyard_id).toBe("vy-1");
  });

  it("photo discovery sends the selected vineyard ID", async () => {
    rpcReply.start_chemical_v3_discovery_v2 = { data: { job_id: "j2", reused: false }, error: null };
    await v3.startV3Discovery({ query: null, countryCode: "AU", inputKind: "photo", photoPath: "u/p.jpg", vineyardId: "vy-2" });
    expect(calls.rpc[0]).toEqual(["start_chemical_v3_discovery_v2", { p_query: null, p_country_code: "AU", p_input_kind: "photo", p_photo_path: "u/p.jpg", p_vineyard_id: "vy-2" }]);
  });

  it("null vineyard (System Admin with none selected) is sent as null", async () => {
    rpcReply.start_chemical_v3_discovery_v2 = { data: { job_id: "j3", reused: false }, error: null };
    await v3.startV3Discovery({ ...base, query: "X", inputKind: "text", vineyardId: null });
    expect(calls.rpc[0][1].p_vineyard_id).toBeNull();
  });

  it("never calls the V1 RPC, even when V2 fails", async () => {
    await expect(v3.startV3Discovery({ ...base, query: "X", inputKind: "text", vineyardId: "vy" })).rejects.toBeTruthy();
    expect(calls.rpc.map((c) => c[0])).toEqual(["start_chemical_v3_discovery_v2"]);
  });

  it("reused job: no backend invocation, reused flag preserved", async () => {
    rpcReply.start_chemical_v3_discovery_v2 = { data: { job_id: "j4", reused: true, status: "running" }, error: null };
    const r = await v3.startV3Discovery({ ...base, query: "X", inputKind: "text", vineyardId: "vy" });
    expect(r.reused).toBe(true);
    expect(calls.fn).toHaveLength(0);
  });

  it("new job: backend invoked exactly once", async () => {
    rpcReply.start_chemical_v3_discovery_v2 = { data: { job_id: "j5", reused: false }, error: null };
    await v3.startV3Discovery({ ...base, query: "X", inputKind: "text", vineyardId: "vy" });
    expect(calls.fn).toHaveLength(1);
  });

  it("customer dialog and System Admin lab pass the selected vineyard, never a default", () => {
    const dialog = fs.readFileSync("src/components/chemicals/ChemicalSearchDialog.tsx", "utf8");
    const lab = fs.readFileSync("src/pages/admin/ChemicalV3LabPage.tsx", "utf8");
    expect(dialog.match(/begin\(\{[^}]*vineyardId: vineyardId \?\? null \}/g)?.length).toBe(2);
    expect(lab.match(/begin\(\{[^}]*vineyardId: selectedVineyardId \?\? null \}/g)?.length).toBe(2);
    for (const src of [dialog, lab]) expect(src).not.toMatch(/defaultVineyard|default_vineyard/);
  });

  it("no client-side writes to chemical_v3_job_requests; requester display has no vineyard substitution", () => {
    for (const f of ["src/lib/chemicalV3.ts", "src/components/chemicals/ChemicalSearchDialog.tsx", "src/pages/admin/ChemicalV3LabPage.tsx"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src).not.toMatch(/from\(["']chemical_v3_job_requests["']\)/);
    }
    const lib = fs.readFileSync("src/lib/chemicalV3.ts", "utf8");
    expect(lib).not.toMatch(/selectedVineyard/);
  });
});
