import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";

const invoke = vi.fn(); const rpc = vi.fn(); const job = { current: null as any };
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {
  functions: { invoke: (...a: any[]) => invoke(...a) },
  rpc: (...a: any[]) => rpc(...a),
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: job.current, error: null }) }) }) }),
} }));
import { canReSearch, retryChemicalDiscovery, RESEARCH_FAILED } from "@/lib/chemicalV3";
import { V3ReSearchButton } from "@/components/chemicals/V3ReSearchButton";

const mount = (onNew = vi.fn()) => { render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <div>Current review record</div>
    <V3ReSearchButton jobId="job-1" revisionId="rev-old" prominent onNewRevision={onNew} />
  </QueryClientProvider>); return onNew; };

describe("V3 re-search missing data", () => {
  beforeEach(() => { invoke.mockReset(); rpc.mockReset(); job.current = null; });
  it("shows for pending_review and needs_attention, not approved, not without admin", () => {
    expect(canReSearch(true, "pending_review", "j")).toBe(true);
    expect(canReSearch(true, "needs_attention", "j")).toBe(true);
    expect(canReSearch(true, "approved", "j")).toBe(false);
    expect(canReSearch(false, "pending_review", "j")).toBe(false);
  });
  it("retry calls chemical-lookup-v3 with action retry + exact job id, never start RPC", async () => {
    invoke.mockResolvedValue({ error: null });
    await retryChemicalDiscovery("job-1");
    expect(invoke).toHaveBeenCalledWith("chemical-lookup-v3", { body: { action: "retry", job_id: "job-1" } });
    expect(rpc).not.toHaveBeenCalledWith("start_chemical_v3_discovery", expect.anything());
  });
  it("confirms before spending, keeps current record while running, opens new revision", async () => {
    invoke.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({ data: [{ revision_id: "rev-new", job_id: "job-1" }], error: null });
    const onNew = mount();
    fireEvent.click(screen.getByText("Re-search missing data"));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByText("This runs a new AI-assisted manufacturer search.")).toBeTruthy();
    job.current = { status: "running", stage: "label" };
    fireEvent.click(screen.getByText("Re-search product"));
    await screen.findByText("Re-searching product information…");
    expect(screen.getByText("Current review record")).toBeTruthy();
    job.current = { status: "pending_review" };
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("chemical_v3_admin_review_queue", undefined), { timeout: 6000 });
    await waitFor(() => expect(onNew).toHaveBeenCalledWith("rev-new"));
  }, 10000);
  it("failure keeps the old revision and shows the friendly error", async () => {
    invoke.mockResolvedValue({ error: { message: "PGRST chemical_v3_ boom" } });
    const onNew = mount();
    fireEvent.click(screen.getByText("Re-search missing data"));
    fireEvent.click(screen.getByText("Re-search product"));
    await screen.findByText(RESEARCH_FAILED);
    expect(screen.queryByText(/PGRST/)).toBeNull();
    expect(onNew).not.toHaveBeenCalled();
  });
  it("customer Chemical Search never includes the control", () => {
    expect(readFileSync("src/components/chemicals/ChemicalSearchDialog.tsx", "utf8")).not.toMatch(/ReSearch|Re-search/);
  });
});
