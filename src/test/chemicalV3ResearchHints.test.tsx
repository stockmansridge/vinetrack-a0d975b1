import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const invoke = vi.fn(); const rpc = vi.fn(); const job = { current: null as any };
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {
  functions: { invoke: (...a: any[]) => invoke(...a) },
  rpc: (...a: any[]) => rpc(...a),
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: job.current, error: null }) }) }) }),
} }));
import {
  buildResearchHintsArgs, catalogueRegistrationCheck, hintIdentityWarning, validateResearchHints, EMPTY_HINTS,
} from "@/lib/chemicalV3ResearchHints";
import { V3ReSearchButton } from "@/components/chemicals/V3ReSearchButton";

const spotlight = { product_name: "Spotlight Herbicide", registration_number: "53673", manufacturer: "FMC" };
const mount = (onNew = vi.fn()) => { render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <V3ReSearchButton jobId="job-1" revisionId="rev-old" prominent showRefine revision={spotlight} onNewRevision={onNew} />
  </QueryClientProvider>); return onNew; };
const open = async () => { fireEvent.click(await screen.findByText(/Refine AI Research|Edit research hints/)); await screen.findByTestId("v3-hints-dialog"); };

describe("Chemical V3 research hints", () => {
  beforeEach(() => { invoke.mockReset(); rpc.mockReset(); job.current = { id: "job-1", status: "pending_review", research_hints: null }; });

  it("builds the exact RPC payload with trimmed values and nulls", () => {
    expect(buildResearchHintsArgs("job-1", { productName: " Spotlight ", productUrl: "", labelUrl: "https://x.com/l.pdf", notes: "" }))
      .toEqual({ p_job_id: "job-1", p_product_name: "Spotlight", p_manufacturer_product_url: null, p_manufacturer_label_url: "https://x.com/l.pdf", p_research_notes: null });
  });
  it("enforces lengths and https-only", () => {
    const e = validateResearchHints({ productName: "a".repeat(181), productUrl: "http://x.com", labelUrl: "https://" + "a".repeat(2050), notes: "n".repeat(1201) });
    expect(Object.keys(e).sort()).toEqual(["labelUrl", "notes", "productName", "productUrl"]);
    expect(validateResearchHints({ ...EMPTY_HINTS, productName: "a".repeat(180), notes: "n".repeat(1200) })).toEqual({});
  });
  it("warns that Spotlight Plus page is a different registration from Spotlight 53673", () => {
    expect(hintIdentityWarning(spotlight, { ...EMPTY_HINTS, productUrl: "https://ag.fmc.com/au/en/products/herbicides/spotlight-plus-herbicide" }))
      .toMatch(/61716/);
    expect(hintIdentityWarning(spotlight, { ...EMPTY_HINTS, productName: "Spotlight Herbicide" })).toBeNull();
  });
  it("never treats Spotlight, Spotlight Plus and Hammer as the same catalogue registration", () => {
    expect(catalogueRegistrationCheck({ registration: "53673" }, { name: "Hammer 400 EC" })).toBe("mismatch");
    expect(catalogueRegistrationCheck({ registration: "53673" }, { registration: "61716" })).toBe("mismatch");
    expect(catalogueRegistrationCheck({ registration: "53673" }, { registration: "53673" })).toBe("same");
    expect(catalogueRegistrationCheck({ registration: null }, { name: "Unknown" })).toBe("unknown");
  });

  it("prefills from stored hints and save-only calls RPC without retrying", async () => {
    job.current = { id: "job-1", status: "pending_review", research_hints: { product_name: "Spotlight Herbicide", research_notes: "Use FMC AU" } };
    rpc.mockResolvedValue({ data: { research_hints: {}, changed: true }, error: null });
    mount();
    await screen.findByText("Edit research hints");
    await open();
    await waitFor(() => expect((screen.getByLabelText("Corrected search / product name") as HTMLInputElement).value).toBe("Spotlight Herbicide"));
    fireEvent.click(screen.getByText("Save research instructions"));
    await screen.findByText("Research instructions saved.");
    expect(rpc).toHaveBeenCalledWith("chemical_v3_set_research_hints", expect.objectContaining({ p_job_id: "job-1", p_research_notes: "Use FMC AU" }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows RPC errors and does not retry", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Not authorised" } });
    mount(); await open();
    fireEvent.click(screen.getByText("Save & re-search"));
    await screen.findByText(/Not authorised/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("blocks saving while the job is running", async () => {
    job.current = { id: "job-1", status: "running" };
    mount(); await open();
    await screen.findByTestId("v3-hints-busy");
    expect((screen.getByText("Save & re-search") as HTMLButtonElement).disabled).toBe(true);
  });

  it("save & re-search awaits RPC, retries same job, then opens the new revision", async () => {
    const order: string[] = [];
    rpc.mockImplementation(async (name: string) => {
      order.push(name);
      return name === "chemical_v3_set_research_hints" ? { data: { changed: true }, error: null } : { data: [{ revision_id: "rev-new", job_id: "job-1" }], error: null };
    });
    invoke.mockImplementation(async () => { order.push("retry"); job.current = { id: "job-1", status: "pending_review" }; return { error: null }; });
    const onNew = mount(); await open();
    fireEvent.change(screen.getByLabelText("Additional research instructions"), { target: { value: "Check FMC AU label" } });
    fireEvent.click(screen.getByText("Save & re-search"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("chemical-lookup-v3", { body: { action: "retry", job_id: "job-1" } }));
    expect(order.indexOf("chemical_v3_set_research_hints")).toBeLessThan(order.indexOf("retry"));
    await waitFor(() => expect(onNew).toHaveBeenCalledWith("rev-new"), { timeout: 6000 });
    expect(rpc).not.toHaveBeenCalledWith("start_chemical_v3_discovery_v2", expect.anything());
  }, 10000);

  it("shows the cross-product identity warning in the dialog", async () => {
    mount(); await open();
    fireEvent.change(screen.getByLabelText("Manufacturer product page URL"), { target: { value: "https://ag.fmc.com/au/en/products/herbicides/spotlight-plus-herbicide" } });
    expect((await screen.findByTestId("v3-hints-identity-warning")).textContent).toMatch(/61716/);
  });
});
