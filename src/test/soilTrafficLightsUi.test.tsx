import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
const mock = vi.hoisted(() => ({ read: vi.fn(), blocks: [{ id: "b", name: "Block B" }, { id: "a", name: "Block A" }] }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: "v" }) }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { from: () => { const q: any = { then: (r: any) => r({ data: mock.blocks, error: null }) }; for (const k of ["select", "eq", "is", "order"]) q[k] = () => q; return q; } } }));
vi.mock("@/lib/soilAnalysis", async (original) => ({ ...await original<any>(), listSoilTrafficResults: (...args: any[]) => mock.read(...args), listAnalyteCatalogue: async () => [{ key: "ca", display_name: "Calcium", category: "Cations" }, { key: "ph", display_name: "pH", category: "Acidity" }] }));
import { TrafficLightsTab } from "@/components/soil-analysis/TrafficLightsTab";
import SoilAnalysisPage from "@/pages/admin/SoilAnalysisPage";
const row = (id: string, status: string | null, block = "a", analyte = "ca") => ({ id, sample_id: id, analyte_key: analyte, display_name: analyte === "ca" ? "Calcium" : "pH", matched_paddock_id: block, value_numeric: 12, unit: "ppm", method: "Lab method", lab_status: status, sample: { id, sampled_at: "2026-01-01", extraction_status: "confirmed", lab_sample_id: id, sample_depth_from_cm: 0, sample_depth_to_cm: 15 } });
function mount(page = false) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/soil-analysis?tab=traffic-lights"]}>{page ? <SoilAnalysisPage /> : <TrafficLightsTab />}</MemoryRouter></QueryClientProvider>); }
beforeEach(() => { mock.read.mockReset().mockImplementation(async (ids: string[]) => [row("one", "Very Low"), row("two", "Low"), row("sat", "Satisfactory", "b"), row("acid", "Slightly acidic", "a", "ph")].filter((r) => ids.includes(r.matched_paddock_id))); });
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
    expect(within(low).getByText("Very Low")).toBeTruthy(); expect(within(low).getByText("Low", { exact: true })).toBeTruthy();
    expect(within(low).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/soil-analysis/samples/one", "/soil-analysis/samples/two"]);
    expect(low.querySelector("time")?.getAttribute("datetime")).toBe("2026-01-01");
    expect(within(low).getAllByText(/Depth 0–15 cm/)).toHaveLength(2);
    expect(screen.getByLabelText("Low count").textContent).toBe("1");
    expect(screen.getByLabelText("Satisfactory count").textContent).toBe("1");
    expect(screen.getByLabelText("Other / Not stated count").textContent).toBe("1");
  });
  it("Exceptions hides Satisfactory and search filters analytes case-insensitively", async () => {
    mount(); await screen.findByText("Very Low"); fireEvent.click(screen.getByRole("button", { name: "Exceptions only" }));
    expect(screen.queryByRole("region", { name: "Satisfactory laboratory statuses" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search analytes"), { target: { value: "PH" } });
    expect(screen.queryByText("Very Low")).toBeNull(); expect(screen.getByText("Slightly acidic")).toBeTruthy();
  });
  it("applies optional as-of to the read", async () => {
    mount(); await screen.findByText("Very Low"); fireEvent.change(screen.getByLabelText("As of date"), { target: { value: "2025-12-31" } });
    await waitFor(() => expect(mock.read).toHaveBeenLastCalledWith(["a", "b"], "2025-12-31"));
  });
  it("shows mixed latest statuses neutrally with every raw result", async () => {
    mock.read.mockResolvedValue([row("one", "Low"), row("two", "High")]); mount();
    const other = await screen.findByRole("region", { name: "Other / Not stated laboratory statuses" });
    expect(within(other).getByText("Mixed latest statuses")).toBeTruthy();
    expect(within(other).getAllByRole("link")).toHaveLength(2);
  });
  it("flags mixed methods/units across different status sections without merging raw values", async () => {
    mock.read.mockResolvedValue([row("one", "Low"), { ...row("two", "High", "b"), unit: "%", method: "Other method" }]);
    mount(); await screen.findByRole("region", { name: "Low laboratory statuses" });
    expect(screen.getAllByText(/Mixed methods\/units/)).toHaveLength(2);
    expect(screen.getByText("12 ppm")).toBeTruthy(); expect(screen.getByText("12 %")).toBeTruthy();
  });
});