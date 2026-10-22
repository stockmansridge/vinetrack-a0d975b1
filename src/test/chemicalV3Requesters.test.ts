import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

const calls: string[] = [];
let replies: Record<string, any> = {};
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: (n: string) => { calls.push(n); return Promise.resolve(replies[n] ?? { data: [], error: null }); } },
}));
import { v3ReviewQueue, fetchV3RequesterInfo, __resetRequesterProbe } from "@/lib/chemicalV3";

const sql = fs.readFileSync("sql/260_chemical_v3_review_queue_requesters.sql", "utf8");
const page = fs.readFileSync("src/pages/admin/ChemicalV3LabPage.tsx", "utf8");
const code = sql.replace(/--.*$/gm, "");

beforeEach(() => { calls.length = 0; replies = {}; __resetRequesterProbe(); });

describe("sql/260 matches the live provenance contract", () => {
  it("uses revision_id → discovery job → job_requests, never obsolete columns", () => {
    expect(code).toMatch(/j\.revision_id/);
    expect(code).toMatch(/chemical_v3_job_requests jr on jr\.job_id = lj\.job_id/);
    expect(code).toMatch(/coalesce\(jr\.user_id, lj\.created_by\)/);
    expect(code).toMatch(/jr\.vineyard_id/);
    expect(code).not.toMatch(/\br\.job_id|\bj\.requested_by|\bj\.vineyard_id/);
  });
  it("keeps admin-only, security definer, fixed search_path, grants", () => {
    expect(code).toMatch(/is_system_admin\(\)/);
    expect(code).toMatch(/security definer/);
    expect(code).toMatch(/set search_path = public/);
    expect(code).toMatch(/revoke all .* from public, anon/);
    expect(code).toMatch(/grant execute .* to authenticated/);
    expect(code).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(code).toMatch(/chemical_v3_admin_review_queue\(\)/);
  });
});

describe("v3ReviewQueue enrichment", () => {
  const queue = { data: [{ revision_id: "r1", status: "pending_review" }], error: null };
  it("adds requester name/email; missing vineyard stays null", async () => {
    replies = { chemical_v3_admin_review_queue: queue,
      chemical_v3_admin_review_queue_requesters: { data: [{ revision_id: "r1", requested_by_name: "Jo", requested_by_email: "jo@x", vineyard_name: null }], error: null } };
    const [r] = await v3ReviewQueue();
    expect(r.requested_by_name).toBe("Jo");
    expect(r.vineyard_name).toBeNull();
  });
  it("a 42703 failure keeps the queue and is not retried", async () => {
    replies = { chemical_v3_admin_review_queue: queue,
      chemical_v3_admin_review_queue_requesters: { data: null, error: { code: "42703", message: "column does not exist" } } };
    expect(await v3ReviewQueue()).toHaveLength(1);
    await v3ReviewQueue();
    expect(calls.filter((c) => c === "chemical_v3_admin_review_queue_requesters")).toHaveLength(1);
  });
});

describe("review sheet requester + region", () => {
  const detail = { revision_id: "r1", requested_by_name: "Jo", requested_by_email: "jo@x", vineyard_id: "v1", vineyard_name: "Hillside" };
  it("fetchV3RequesterInfo returns the matching revision's provenance", async () => {
    replies = { chemical_v3_admin_review_queue_requesters: { data: [detail], error: null } };
    expect(await fetchV3RequesterInfo("r1")).toEqual({
      name: "Jo", email: "jo@x", vineyardId: "v1", vineyardName: "Hillside",
    });
  });
  it("unknown revision and failed RPC both return null", async () => {
    replies = { chemical_v3_admin_review_queue_requesters: { data: [detail], error: null } };
    expect(await fetchV3RequesterInfo("r2")).toBeNull();
    replies = { chemical_v3_admin_review_queue_requesters: { data: null, error: { code: "42501", message: "Not authorised" } } };
    expect(await fetchV3RequesterInfo("r1")).toBeNull();
  });
  it("the sheet shows the requester, the vineyard and the mapped region name", () => {
    const i = page.indexOf('data-testid="v3-requester"');
    expect(i).toBeGreaterThan(0);
    const block = page.slice(i - 800, i + 800);
    expect(block).toContain("Requested by");
    expect(block).toContain("Requested for vineyard");
    expect(block).toContain("VINEYARD_COUNTRY_NAME[");
    expect(page).toContain("useAdminVineyards");
  });
});
