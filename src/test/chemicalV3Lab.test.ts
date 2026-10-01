import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

const calls: { rpc: any[]; from: string[]; fn: any[]; storage: any[] } = { rpc: [], from: [], fn: [], storage: [] };
let rpcReply: Record<string, any> = {};
let fnReply: any = { error: null };

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: any) => { calls.rpc.push([name, args]); return Promise.resolve(rpcReply[name] ?? { data: [], error: null }); },
    from: (t: string) => { calls.from.push(t); const b: any = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: { id: "j1", status: "running", stage: "finding_manufacturer_label", progress_percent: 60 }, error: null }) }; return b; },
    functions: { invoke: (n: string, o: any) => { calls.fn.push([n, o]); return Promise.resolve(fnReply); } },
    storage: { from: (b: string) => ({
      createSignedUrl: (p: string) => { calls.storage.push(["sign", b, p]); return Promise.resolve({ data: { signedUrl: "signed://x" }, error: null }); },
      upload: (p: string) => { calls.storage.push(["upload", b, p]); return Promise.resolve({ error: null }); },
      getPublicUrl: () => { throw new Error("public URL must not be used"); },
    }) },
  },
}));

import * as v3 from "@/lib/chemicalV3";

beforeEach(() => { calls.rpc = []; calls.from = []; calls.fn = []; calls.storage = []; rpcReply = {}; fnReply = { error: null }; });

describe("Chemical Lookup V3 Lab", () => {
  it("never references master_chemicals or V1/V2 search", () => {
    for (const f of ["src/lib/chemicalV3.ts", "src/pages/admin/ChemicalV3LabPage.tsx"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src).not.toMatch(/master_chemicals|search_master_chemicals|saved_chemicals|chemical-info-lookup|AddChemicalV2/);
    }
  });
  it("search uses the V3 RPC", async () => {
    await v3.searchV3("Weedmaster DUO", "AU");
    expect(calls.rpc).toEqual([["search_chemical_v3_catalogue", { p_query: "Weedmaster DUO", p_country_code: "AU", p_limit: 20 }]]);
  });
  it("discovery uses the V3 start RPC then the V3 backend", async () => {
    rpcReply.start_chemical_v3_discovery = { data: [{ job_id: "j1", reused: false, status: "queued" }], error: null };
    const r = await v3.startV3Discovery({ query: "X", countryCode: null, inputKind: "text", photoPath: null });
    expect(calls.rpc[0]).toEqual(["start_chemical_v3_discovery", { p_query: "X", p_country_code: null, p_input_kind: "text", p_photo_path: null }]);
    expect(calls.fn[0]).toEqual(["chemical-lookup-v3", { body: { action: "start", job_id: "j1" } }]);
    expect(r.backendMissing).toBe(false);
  });
  it("reused job does not start the backend again", async () => {
    rpcReply.start_chemical_v3_discovery = { data: { job_id: "j1", reused: true, status: "running" }, error: null };
    const r = await v3.startV3Discovery({ query: "X", countryCode: "AU", inputKind: "text", photoPath: null });
    expect(r.reused).toBe(true);
    expect(calls.fn).toHaveLength(0);
    expect(v3.V3_REUSED_MESSAGE).toMatch(/already started/);
  });
  it("missing backend is reported, job not failed", async () => {
    rpcReply.start_chemical_v3_discovery = { data: { job_id: "j1", reused: false }, error: null };
    fnReply = { error: { message: "not found", context: { status: 404 } } };
    const r = await v3.startV3Discovery({ query: "X", countryCode: "AU", inputKind: "text", photoPath: null });
    expect(r.backendMissing).toBe(true);
    expect(calls.rpc.map((c) => c[0])).not.toContain("finish_refresh_job");
  });
  it("progress reads the V3 jobs table", async () => {
    const job = await v3.fetchV3Job("j1");
    expect(calls.from).toEqual(["chemical_v3_discovery_jobs"]);
    expect(job?.progress_percent).toBe(60);
  });
  it("pending rows are never treated as approved", () => {
    expect(v3.isApprovedResult({ review_status: "pending_review" })).toBe(false);
    expect(v3.isApprovedResult({ review_status: "approved" })).toBe(true);
  });
  it("front label uses a signed private URL", async () => {
    expect(await v3.signedV3MediaUrl("labels/a.jpg")).toBe("signed://x");
    expect(calls.storage[0]).toEqual(["sign", "chemical-v3-media", "labels/a.jpg"]);
  });
  it("queue, approve and reject use V3 RPCs; reject requires a note", async () => {
    await v3.v3ReviewQueue();
    await v3.approveV3("r1", "");
    await expect(v3.rejectV3("r1", " ")).rejects.toThrow();
    await v3.rejectV3("r1", "wrong label");
    expect(calls.rpc.map((c) => c[0])).toEqual(["chemical_v3_admin_review_queue", "approve_chemical_v3_revision", "reject_chemical_v3_revision"]);
  });
  it("approval refusal surfaces", async () => {
    rpcReply.approve_chemical_v3_revision = { error: { message: "core fields incomplete" } };
    await expect(v3.approveV3("r1", null)).rejects.toMatchObject({ message: "core fields incomplete" });
  });
  it("aging and stale notes", () => {
    expect(v3.freshnessNote(v3.freshnessOf({ freshness_status: "aging" }))).toBe("Refresh recommended");
    expect(v3.freshnessNote(v3.freshnessOf({ freshness_status: "stale" }))).toMatch(/latest manufacturer information/);
    expect(v3.freshnessNote(v3.freshnessOf({ freshness_status: "fresh" }))).toBeNull();
  });
  it("photo search stores under search-inputs/<user> and starts a photo discovery", async () => {
    expect(v3.photoInputPath("u1", "a.PNG", "abc")).toBe("search-inputs/u1/abc.png");
    const path = await v3.uploadV3SearchPhoto("u1", new File(["x"], "p.jpg", { type: "image/jpeg" }));
    expect(path.startsWith("search-inputs/u1/")).toBe(true);
    rpcReply.start_chemical_v3_discovery = { data: { job_id: "j2", reused: false }, error: null };
    await v3.startV3Discovery({ query: null, countryCode: "AU", inputKind: "photo", photoPath: path });
    expect(calls.rpc.at(-1)).toEqual(["start_chemical_v3_discovery", { p_query: null, p_country_code: "AU", p_input_kind: "photo", p_photo_path: path }]);
  });
  it("rates stay split by basis", () => {
    const s = v3.splitRates([{ basis: "per_ha", rate_text: "1 L" }, { basis: "per 100 L", rate_text: "100 mL" }]);
    expect(s.perHa).toHaveLength(1);
    expect(s.per100L).toHaveLength(1);
  });
});
