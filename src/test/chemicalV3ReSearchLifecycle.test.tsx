import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const invoke = vi.fn(); const rpc = vi.fn(); const job = { current: null as any };
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {
  functions: { invoke: (...a: any[]) => invoke(...a) },
  rpc: (...a: any[]) => rpc(...a),
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: job.current, error: null }) }) }) }),
} }));
import { RESEARCH_FAILED } from "@/lib/chemicalV3";
import { V3ReSearchButton } from "@/components/chemicals/V3ReSearchButton";

const OLD = { id: "job-1", status: "needs_attention", revision_id: "rev-old", attempt_count: 1 };
const mount = (onNew = vi.fn()) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["chemical-v3-research-job", "job-1"], OLD); // stale terminal cache before retry
  render(<QueryClientProvider client={qc}>
    <V3ReSearchButton jobId="job-1" revisionId="rev-old" prominent showRefine revision={{ product_name: "Spotlight Herbicide", registration_number: "53673" }} onNewRevision={onNew} />
  </QueryClientProvider>);
  return onNew;
};
const go = () => { fireEvent.click(screen.getByText("Re-search missing data")); fireEvent.click(screen.getByText("Re-search product")); };

describe("V3 re-search lifecycle", () => {
  beforeEach(() => { invoke.mockReset(); rpc.mockReset(); job.current = { ...OLD }; rpc.mockResolvedValue({ data: [], error: null }); });

  it("old cached needs_attention never shows failure; slow eventual pending_review opens the new revision", async () => {
    invoke.mockResolvedValue({ data: { started: true }, error: null });
    const onNew = mount(); go();
    await screen.findByText(/Working…/);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText(RESEARCH_FAILED)).toBeNull();
    expect(screen.getByText(/Working…/)).toBeTruthy();
    job.current = { ...OLD, status: "pending_review", revision_id: "rev-new", attempt_count: 2 };
    await waitFor(() => expect(onNew).toHaveBeenCalledWith("rev-new"), { timeout: 6000 });
    expect(screen.queryByText(RESEARCH_FAILED)).toBeNull();
  }, 10000);

  it("queued then active progress keeps Working, then completes", async () => {
    invoke.mockImplementation(async () => { job.current = { ...OLD, status: "queued" }; return { error: null }; });
    const onNew = mount(); go();
    await screen.findByText(/Working…/);
    job.current = { ...OLD, status: "extracting", stage: "label" };
    await new Promise((r) => setTimeout(r, 4300));
    expect(screen.getByText(/Working…/)).toBeTruthy();
    job.current = { ...OLD, status: "pending_review", revision_id: "rev-new" };
    await waitFor(() => expect(onNew).toHaveBeenCalledWith("rev-new"), { timeout: 6000 });
  }, 15000);

  it("immediate new revision is a success even with no observed active stage", async () => {
    invoke.mockImplementation(async () => { job.current = { ...OLD, status: "needs_attention", revision_id: "rev-new" }; return { error: null }; });
    const onNew = mount(); go();
    await waitFor(() => expect(onNew).toHaveBeenCalledWith("rev-new"));
  });

  it("prevents duplicate clicks while starting", async () => {
    let resolve!: () => void;
    invoke.mockImplementation(() => new Promise((r) => { resolve = () => r({ error: null }); }));
    mount(); go();
    await screen.findByText(/Starting research…/);
    expect((screen.getByText("Re-search missing data").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Re-search missing data"));
    expect(screen.queryByText("Re-search product")).toBeNull();
    resolve();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  });

  it("different_registered_product shows the server message and separate discovery, not generic failure", async () => {
    invoke.mockImplementation(async () => {
      job.current = { ...OLD, attempt_count: 2, error_code: "different_registered_product", user_message: "Different registered product—start a separate discovery" };
      return { error: null };
    });
    mount(); go();
    await screen.findByText("Different registered product—start a separate discovery");
    expect(screen.queryByText(RESEARCH_FAILED)).toBeNull();
    fireEvent.click(screen.getByText("Start separate discovery"));
    await screen.findByTestId("v3-hints-identity-warning");
    expect(screen.queryByText("Save & re-search")).toBeNull();
  });

  it("genuine failed attempt shows diagnostic code; network error shows safe text; retry clears it", async () => {
    invoke.mockRejectedValueOnce(new Error("Failed to fetch"));
    mount(); go();
    await screen.findByText(RESEARCH_FAILED);
    expect(screen.getByTestId("v3-research-failed-detail").textContent).toMatch(/could not be reached/);
    invoke.mockImplementation(async () => { job.current = { ...OLD, status: "failed", attempt_count: 2, error_code: "label_fetch_failed", error_message: "Label PDF 404" }; return { error: null }; });
    fireEvent.click(screen.getByText("Try again"));
    fireEvent.click(screen.getByText("Re-search product"));
    await waitFor(() => expect(screen.getByTestId("v3-research-failed-detail").textContent).toBe("label_fetch_failed: Label PDF 404"));
  });
});
