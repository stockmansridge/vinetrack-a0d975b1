import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
const mock = vi.hoisted(() => ({ invoke: vi.fn(), read: vi.fn(), blocks: [{ id: "b", name: "Block B" }, { id: "a", name: "Block A" }] }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: "v" }) }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { functions: { invoke: (...args: any[]) => mock.invoke(...args) }, from: () => { const q: any = { then: (r: any) => r({ data: mock.blocks, error: null }) }; for (const k of ["select", "eq", "is", "order"]) q[k] = () => q; return q; } } }));
vi.mock("@/lib/soilAnalysis", async (original) => ({ ...await original<any>(), listSoilTrafficResults: (...args: any[]) => mock.read(...args), listAnalyteCatalogue: async () => [{ key: "ca", display_name: "Calcium", category: "Cations" }, { key: "ph", display_name: "pH", category: "Acidity" }] }));
import { TrafficLightsTab } from "@/components/soil-analysis/TrafficLightsTab";
import SoilAnalysisPage from "@/pages/admin/SoilAnalysisPage";
const row = (id: string, status: string | null, block = "a", analyte = "ca") => ({ id, sample_id: id, analyte_key: analyte, display_name: analyte === "ca" ? "Calcium" : "pH", matched_paddock_id: block, value_numeric: 12, unit: "ppm", method: "Lab method", lab_status: status, sample: { id, sampled_at: "2026-01-01", extraction_status: "confirmed", lab_sample_id: id, sample_depth_from_cm: 0, sample_depth_to_cm: 15 } });
function mount(page = false, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) { return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/soil-analysis?tab=traffic-lights"]}>{page ? <SoilAnalysisPage /> : <TrafficLightsTab />}</MemoryRouter></QueryClientProvider>); }
beforeEach(() => { mock.invoke.mockReset().mockResolvedValue({ data: { classifications: [{ result_id: "acid", indication: "high", confidence: 0.82, reason: "General screening", basis: "general_viticulture", scope: "result" }] }, error: null }); mock.read.mockReset().mockImplementation(async (ids: string[]) => [row("one", "Very Low"), row("two", "Low"), row("sat", "Satisfactory", "b"), row("acid", "Slightly acidic", "a", "ph")].filter((r) => ids.includes(r.matched_paddock_id))); });
describe("Traffic Lights presentation", () => {
  it("is a released tab between Compare and Reports", async () => {
    mount(true); expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Overview", "Soil Samples", "Trends", "Compare", "Traffic Lights", "Reports"]);
    expect(await screen.findByText("Latest laboratory statuses")).toBeTruthy();
  });
  it("defaults to all active blocks, selected in alphabetical order, with All and Clear", async () => {
    mount(); await waitFor(() => expect(mock.read).toHaveBeenCalledWith(["a", "b"], null));
    expect(screen.getByRole("button", { name: "Block A" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Clear" })); expect(await screen.findByText("Choose one or more blocks.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All blocks" })); expect(screen.getByRole("button", { name: "Block B" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("keeps replicate raw entries and exact lab statuses, date/depth and released sample links", async () => {
    mount(); const low = await screen.findByRole("region", { name: "Low laboratory statuses" });
    fireEvent.click(within(low).getByRole("button", { name: /Calcium/ }));
    expect(within(low).getByText("Very Low")).toBeTruthy(); expect(within(low).getByText("Low", { exact: true })).toBeTruthy();
    expect(within(low).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/soil-analysis/samples/one", "/soil-analysis/samples/two"]);
    expect(low.querySelector("time")?.getAttribute("datetime")).toBe("2026-01-01");
    expect(within(low).getAllByText(/Depth 0–15 cm/)).toHaveLength(2);
    expect(screen.getByLabelText("Low count").textContent).toBe("1");
    expect(screen.getByLabelText("Satisfactory count").textContent).toBe("1");
    expect(screen.getByLabelText("Other / Not stated count").textContent).toBe("1");
  });
  it("defaults to Most recent with no date input and applies/clears the date mode", async () => {
    mount(); await waitFor(() => expect(mock.read).toHaveBeenCalledWith(["a", "b"], null));
    expect(screen.getByLabelText("Time").textContent).toBe("Most recent");
    expect(screen.queryByLabelText("As of date")).toBeNull();
    fireEvent.click(screen.getByLabelText("Time")); fireEvent.click(screen.getByRole("option", { name: "As of date" }));
    fireEvent.change(screen.getByLabelText("As of date"), { target: { value: "2025-12-31" } });
    await waitFor(() => expect(mock.read).toHaveBeenLastCalledWith(["a", "b"], "2025-12-31"));
    fireEvent.click(screen.getByLabelText("Time")); fireEvent.click(screen.getByRole("option", { name: "Most recent" }));
    expect(screen.queryByLabelText("As of date")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Block B" }));
    await waitFor(() => expect(mock.read).toHaveBeenLastCalledWith(["a"], null));
  });
  it.each(["Low", "Satisfactory", "High", "Other"])("directly filters to %s only", async (label) => {
    mount(); await screen.findByRole("region", { name: "Low laboratory statuses" });
    fireEvent.click(within(screen.getByRole("group", { name: "Status visibility" })).getByRole("button", { name: label }));
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.getByRole("region").getAttribute("aria-label")).toBe(`${label === "Other" ? "Other / Not stated" : label} laboratory statuses`);
  });
  it("High summary selects High without other sections; All restores four", async () => {
    mount(); await screen.findByRole("region", { name: "Low laboratory statuses" });
    fireEvent.click(screen.getByRole("button", { name: "Show High" })); expect(screen.getAllByRole("region")).toHaveLength(1);
    fireEvent.click(within(screen.getByRole("group", { name: "Status visibility" })).getByRole("button", { name: "All" }));
    expect(screen.getAllByRole("region")).toHaveLength(4);
  });
  it("groups default collapsed and support expand/collapse all", async () => {
    mount(); const low = await screen.findByRole("region", { name: "Low laboratory statuses" });
    expect(screen.queryByText("Very Low")).toBeNull(); expect(screen.queryAllByRole("link")).toHaveLength(0);
    fireEvent.click(within(low).getByRole("button", { name: "Expand all" })); expect(within(low).getAllByRole("link")).toHaveLength(2);
    fireEvent.click(within(low).getByRole("button", { name: "Collapse all" })); expect(within(low).queryAllByRole("link")).toHaveLength(0);
  });
  it("AI defaults off and never invokes until enabled, then sends only unique unrated ids", async () => {
    mount(); await screen.findByRole("region", { name: "Low laboratory statuses" });
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false"); expect(mock.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith("soil-analysis-viticulture-indicate", { body: { vineyard_id: "v", result_ids: ["acid"] } }));
    await waitFor(() => expect(screen.getByLabelText("High count").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "Show High" }));
    fireEvent.click(within(screen.getByRole("region")).getByRole("button", { name: /pH/ }));
    expect(screen.getByText("AI indication: High")).toBeTruthy(); expect(screen.getByText("Lab: Slightly acidic")).toBeTruthy();
    expect(screen.getByText("0 lab · 1 AI")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch")); expect(screen.getByLabelText("High count").textContent).toBe("0");
    fireEvent.click(screen.getByRole("switch")); await waitFor(() => expect(screen.getByLabelText("High count").textContent).toBe("1")); expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it("uses the v3 query key and ignores fresh cached v1/v2 unable responses", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const stale = [{ result_id: "acid", indication: "unable", confidence: 0, reason: "stale unable", basis: "insufficient_context" }];
    client.setQueryData(["soil-analysis", "viticulture-indication", "v", ["acid"]], stale);
    client.setQueryData(["soil-analysis", "viticulture-indication", "v1", "v", ["acid"]], stale);
    client.setQueryData(["soil-analysis", "viticulture-indication", "v2", "v", ["acid"]], stale);
    mount(false, client); await screen.findByRole("region", { name: "Low laboratory statuses" });
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByLabelText("High count").textContent).toBe("1"));
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(["soil-analysis", "viticulture-indication", "v3", "v", ["acid"]])).toEqual([{ result_id: "acid", indication: "high", confidence: 0.82, reason: "General screening", basis: "general_viticulture", scope: "result" }]);
    expect(client.getQueryData(["soil-analysis", "viticulture-indication", "v2", "v", ["acid"]])).toEqual(stale);
  });
  it.each(["low", "satisfactory", "high"] as const)("renders nitrogen context %s with confidence, companion reason and original Lab wording", async (bucket) => {
    mock.invoke.mockResolvedValue({ data: { classifications: [{ result_id: "acid", indication: bucket, confidence: 0.82, reason: "Companion NO3-N in the same sample", basis: "general_viticulture", scope: "sample_nitrogen_context" }] } });
    mount(); await screen.findByRole("region", { name: "Low laboratory statuses" }); fireEvent.click(screen.getByRole("switch"));
    const label = bucket[0].toUpperCase() + bucket.slice(1);
    await waitFor(() => expect(screen.getByLabelText("Other / Not stated count").textContent).toBe("0"));
    fireEvent.click(screen.getByRole("button", { name: `Show ${label}` }));
    fireEvent.click(within(screen.getByRole("region")).getByRole("button", { name: /pH/ }));
    expect(screen.getByText(`AI nitrogen context: ${label}`)).toBeTruthy();
    expect(screen.getByText("82% confidence · Companion NO3-N in the same sample")).toBeTruthy();
    expect(screen.getByText("Lab: Slightly acidic")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch")); expect(screen.getByLabelText("Other / Not stated count").textContent).toBe("1");
    expect(screen.queryByText(`AI nitrogen context: ${label}`)).toBeNull();
  });
  it.each(["low", "satisfactory", "high"] as const)("renders sample context %s with confidence, reason, original Lab wording and its explanation", async (bucket) => {
    mock.invoke.mockResolvedValue({ data: { classifications: [{ result_id: "acid", indication: bucket, confidence: 0.82, reason: "Companion measurements in the same sample", basis: "general_viticulture", scope: "sample_context" }] } });
    mount(); await screen.findByRole("region", { name: "Low laboratory statuses" }); fireEvent.click(screen.getByRole("switch"));
    const label = bucket[0].toUpperCase() + bucket.slice(1);
    await waitFor(() => expect(screen.getByLabelText("Other / Not stated count").textContent).toBe("0"));
    fireEvent.click(screen.getByRole("button", { name: `Show ${label}` }));
    fireEvent.click(within(screen.getByRole("region")).getByRole("button", { name: /pH/ }));
    expect(screen.getByText(`AI sample context: ${label}`)).toBeTruthy();
    expect(screen.getByText("82% confidence · Companion measurements in the same sample")).toBeTruthy();
    expect(screen.getByText("Lab: Slightly acidic")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "What AI sample context means" }));
    expect(await screen.findByText("Uses related measurements from the same soil sample when a single result does not have a defensible standalone viticulture threshold.")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch")); expect(screen.getByLabelText("Other / Not stated count").textContent).toBe("1");
    expect(screen.queryByText(`AI sample context: ${label}`)).toBeNull();
  });
  it("does not explain sample context for a plain result indication", async () => {
    mount(); await screen.findByRole("region", { name: "Low laboratory statuses" }); fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByLabelText("High count").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "Show High" }));
    fireEvent.click(within(screen.getByRole("region")).getByRole("button", { name: /pH/ }));
    expect(screen.getByText("AI indication: High")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "What AI sample context means" })).toBeNull();
  });
  it("v1 response missing scope fails safely to lab-only display", async () => {
    mock.invoke.mockResolvedValue({ data: { classifications: [{ result_id: "acid", indication: "high", confidence: 0.82, reason: "Old result", basis: "general_viticulture" }] } });
    mount(); await screen.findByRole("region", { name: "Low laboratory statuses" }); fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI indication is unavailable. Laboratory statuses are still shown.");
    expect(screen.getByLabelText("High count").textContent).toBe("0");
    expect(screen.getByLabelText("Other / Not stated count").textContent).toBe("1");
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it("AI failure retains source grouping and safe retry notice", async () => {
    mock.invoke.mockResolvedValue({ error: new Error("private provider error") }); mount(); await screen.findByRole("region", { name: "Low laboratory statuses" });
    fireEvent.click(screen.getByRole("switch")); expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByLabelText("Other / Not stated count").textContent).toBe("1"); expect(screen.queryByText(/private provider/)).toBeNull(); expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(["unable", "mixed"])("shows %s AI outcomes under Other with original raw entries", async (outcome) => {
    mock.read.mockResolvedValue([row("acid", null, "a", "ph"), row("second", "Slightly acidic", "a", "ph")]);
    mock.invoke.mockResolvedValue({ data: { classifications: [
      { result_id: "acid", indication: outcome === "unable" ? "unable" : "low", confidence: 0.82, reason: "Screening", basis: "general_viticulture", scope: "result" },
      { result_id: "second", indication: "high", confidence: 0.82, reason: "Screening", basis: "general_viticulture", scope: "result" },
    ] } });
    mount(); await screen.findByRole("region", { name: "Other / Not stated laboratory statuses" }); fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Show Other" }));
    fireEvent.click(within(screen.getByRole("region")).getByRole("button", { name: /pH/ }));
    expect(await screen.findByText(outcome === "unable" ? "AI: Unable to rate" : "AI: Mixed indications")).toBeTruthy();
    expect(screen.getByLabelText("Other / Not stated count").textContent).toBe("1");
    expect(screen.getByText("Lab: Not stated")).toBeTruthy(); expect(screen.getAllByRole("link")).toHaveLength(2);
  });
  it("shows nonblocking AI loading while lab-rated content remains available", async () => {
    let finish: ((value: unknown) => void) | undefined;
    mock.invoke.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    mount(); await screen.findByRole("region", { name: "Low laboratory statuses" }); fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("status")).toHaveTextContent("Analysing unrated results…");
    fireEvent.click(screen.getByRole("button", { name: "Show Low" })); fireEvent.click(within(screen.getByRole("region")).getByRole("button", { name: /Calcium/ }));
    expect(screen.getByText("Very Low")).toBeTruthy();
    finish?.({ data: { classifications: [{ result_id: "acid", indication: "high", confidence: 0.82, reason: "Screening", basis: "general_viticulture", scope: "result" }] } });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
  it("as-of AI uses only the latest eligible dataset, not excluded later dates", async () => {
    mock.read.mockImplementation(async (_ids: string[], asOf: string | null) => asOf ? [{ ...row("historical", null, "a", "ph"), sample: { ...row("historical", null).sample, sampled_at: "2025-01-01" } }] : [row("acid", null, "a", "ph")]);
    mock.invoke.mockImplementation(async (_name, { body }) => ({ data: { classifications: body.result_ids.map((id: string) => ({ result_id: id, indication: "high", confidence: 0.82, reason: "Screening", basis: "general_viticulture", scope: "result" })) } }));
    mount(); await screen.findByRole("region", { name: "Low laboratory statuses" });
    fireEvent.click(screen.getByLabelText("Time")); fireEvent.click(screen.getByRole("option", { name: "As of date" }));
    fireEvent.change(screen.getByLabelText("As of date"), { target: { value: "2025-12-31" } });
    await waitFor(() => expect(mock.read).toHaveBeenLastCalledWith(["a", "b"], "2025-12-31"));
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith("soil-analysis-viticulture-indicate", { body: { vineyard_id: "v", result_ids: ["historical"] } }));
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it("search/category/status do not broaden or repeat AI requests and block selection excludes results", async () => {
    mount(); await screen.findByRole("region", { name: "Low laboratory statuses" }); fireEvent.click(screen.getByRole("button", { name: "Block A" }));
    fireEvent.click(screen.getByRole("switch")); await waitFor(() => expect(mock.read).toHaveBeenLastCalledWith(["b"], null)); expect(mock.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Block A" })); await waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Search analytes"), { target: { value: "PH" } });
    expect(screen.getByLabelText("Low count").textContent).toBe("0");
    fireEvent.click(screen.getByLabelText("Category")); fireEvent.click(screen.getByRole("option", { name: "Cations" }));
    expect(screen.getByLabelText("High count").textContent).toBe("0"); expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it("shows mixed latest statuses neutrally with every raw result", async () => {
    mock.read.mockResolvedValue([row("one", "Low"), row("two", "High")]); mount();
    const other = await screen.findByRole("region", { name: "Other / Not stated laboratory statuses" });
    fireEvent.click(within(other).getByRole("button", { name: /Calcium/ }));
    expect(within(other).getByText("Mixed latest statuses")).toBeTruthy();
    expect(within(other).getAllByRole("link")).toHaveLength(2);
  });
  it("flags mixed methods/units across different status sections without merging raw values", async () => {
    mock.read.mockResolvedValue([row("one", "Low"), { ...row("two", "High", "b"), unit: "%", method: "Other method" }]);
    mount(); await screen.findByRole("region", { name: "Low laboratory statuses" });
    expect(screen.getAllByText(/Mixed methods\/units/)).toHaveLength(2);
    for (const region of screen.getAllByRole("region")) { const expand = within(region).queryByRole("button", { name: "Expand all" }); if (expand) fireEvent.click(expand); }
    expect(screen.getByText("12 ppm")).toBeTruthy(); expect(screen.getByText("12 %")).toBeTruthy();
  });
});