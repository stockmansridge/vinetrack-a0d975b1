import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const mock = vi.hoisted(() => ({ vineyard: "v1", blocks: [{ id: "b", name: "Block B" }, { id: "a", name: "Block A" }, { id: "c", name: "Block C" }], read: vi.fn(), lines: [] as any[], scatters: [] as any[] }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: mock.vineyard }) }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { from: () => { const q: any = { then: (r: any) => r({ data: mock.blocks, error: null }) }; for (const k of ["select", "eq", "is", "order"]) q[k] = () => q; return q; } } }));
vi.mock("@/lib/soilAnalysis", async (original) => ({ ...await original<any>(), listBlocksAnalyteResults: (...args: any[]) => mock.read(...args), listAnalyteCatalogue: async () => [{ key: "ca", display_name: "Calcium", category: "Cations", desired_direction: "range" }] }));
vi.mock("@/components/soil-analysis/SoilAnalyteCombobox", () => ({ SoilAnalyteCombobox: ({ onChange }: any) => <button onClick={() => onChange("ca")}>Select Calcium</button> }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>, ComposedChart: ({ children }: any) => <div>{children}</div>,
  Line: (p: any) => { mock.lines.push(p); return <span data-testid="trend-line">{p.name}</span>; },
  Scatter: (p: any) => { mock.scatters.push(p); return <span data-testid="raw-series">{p.name}</span>; },
  Legend: ({ content }: any) => content(), Tooltip: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null,
}));
import { TrendsTab } from "@/components/soil-analysis/TrendsTab";
const result = (block: string, id: string, value: number, date = "2026-01-01", method: string | null = null) => ({ id, analyte_key: "ca", value_numeric: value, unit: "ppm", method, matched_paddock_id: block, sample: { id, sampled_at: date, created_at: date, laboratory: "Lab", lab_sample_id: id } });
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return { ...render(<QueryClientProvider client={client}><TrendsTab /></QueryClientProvider>), client }; }
beforeEach(() => { mock.vineyard = "v1"; mock.lines = []; mock.scatters = []; mock.read.mockReset().mockImplementation(async (ids: string[]) => [result("a", "a1", 10), result("a", "a2", 20), result("b", "b1", 100)].filter((r) => ids.includes(r.matched_paddock_id))); });
async function chooseAll() { fireEvent.click(await screen.findByRole("button", { name: "All blocks" })); fireEvent.click(screen.getByRole("button", { name: "Select Calcium" })); await screen.findByRole("region", { name: "Block A trend summary" }); }
describe("multi-block Trends interactions", () => {
  it("starts empty; toggles many blocks and keeps name-sorted stable selection", async () => {
    mount(); expect(screen.getByText("Choose one or more blocks and an analyte to plot results over time.")).toBeTruthy();
    const group = await screen.findByRole("group", { name: "Blocks" });
    expect(within(group).getAllByRole("button").slice(0, 3).map((b) => b.textContent)).toEqual(["Block A", "Block B", "Block C"]);
    fireEvent.click(screen.getByRole("button", { name: "Block B" })); fireEvent.click(screen.getByRole("button", { name: "Block A" })); fireEvent.click(screen.getByRole("button", { name: "Select Calcium" }));
    await waitFor(() => expect(mock.read).toHaveBeenLastCalledWith(["a", "b"], "ca"));
    expect(screen.getByRole("button", { name: "Block B" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Block B" })); await waitFor(() => expect(mock.read).toHaveBeenLastCalledWith(["a"], "ca"));
  });
  it("All blocks and Clear work", async () => {
    mount(); await chooseAll(); expect(mock.read).toHaveBeenCalledWith(["a", "b", "c"], "ca");
    fireEvent.click(screen.getByRole("button", { name: "Clear" })); expect(screen.getByText(/Choose one or more blocks/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Block A" }).getAttribute("aria-pressed")).toBe("false");
  });
  it("renders one line per block with data, separate date averages and all raw dots", async () => {
    mount(); await chooseAll(); expect(screen.getAllByTestId("trend-line")).toHaveLength(2); expect(screen.getAllByTestId("raw-series")).toHaveLength(2);
    const a = mock.lines.filter((p) => p.name === "Block A · Date average").at(-1); const b = mock.lines.filter((p) => p.name === "Block B · Date average").at(-1);
    expect(a.data[0]).toMatchObject({ avg: 15, count: 2 }); expect(b.data[0]).toMatchObject({ avg: 100, count: 1 });
    expect(mock.scatters.filter((p) => p.name === "Block A · Laboratory result").at(-1).data).toHaveLength(2);
  });
  it("retains no-data blocks and shows independent summaries", async () => {
    mount(); await chooseAll(); expect(within(screen.getByRole("region", { name: "Block C trend summary" })).getByText("No data")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Block A trend summary" })).getByText("15 ppm")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Block B trend summary" })).getByText("100 ppm")).toBeTruthy();
  });
  it("raw table is Block first and date/block/id sorted, with raw values not averages", async () => {
    mock.read.mockResolvedValue([result("b", "z", 100), result("a", "z", 20), result("a", "a", 10), result("b", "old", 5, "2025-01-01")]);
    mount(); await chooseAll(); const table = screen.getByRole("table"); expect(within(table).getAllByRole("columnheader")[0].textContent).toBe("Block");
    const rows = within(table).getAllByRole("row").slice(1); expect(rows.map((r) => within(r).getAllByRole("cell")[2].textContent)).toEqual(["old", "a", "z", "z"]);
    expect(rows.map((r) => within(r).getAllByRole("cell")[3].textContent?.trim())).toEqual(["5 ppm", "10 ppm", "20 ppm", "100 ppm"]);
  });
  it("active series spans blocks but known/missing methods remain separate", async () => {
    mock.read.mockResolvedValue([result("a", "a", 10), result("b", "b", 100), result("c", "c", 999, undefined, "Known")]);
    mount(); await chooseAll(); expect(screen.getAllByTestId("trend-line")).toHaveLength(2);
    fireEvent.click(within(screen.getByRole("group", { name: "Trend series" })).getByRole("button", { name: /Known/ }));
    expect(screen.getAllByTestId("trend-line")).toHaveLength(1); expect(screen.getByTestId("trend-line").textContent).toBe("Block C · Date average");
    expect(within(screen.getByRole("region", { name: "Block A trend summary" })).getByText("No data")).toBeTruthy();
  });
  it("one-block selection retains its useful summary and chart", async () => {
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Block A" })); fireEvent.click(screen.getByRole("button", { name: "Select Calcium" }));
    await screen.findByRole("region", { name: "Block A trend summary" }); expect(screen.getAllByTestId("trend-line")).toHaveLength(1); expect(screen.getByText("2 / 1")).toBeTruthy();
  });
  it("vineyard changes clear old block ids before querying", async () => {
    const view = mount(); await chooseAll(); mock.vineyard = "v2"; view.rerender(<QueryClientProvider client={view.client}><TrendsTab /></QueryClientProvider>);
    await screen.findByText(/Choose one or more blocks/); expect((await screen.findByRole("button", { name: "Block A" })).getAttribute("aria-pressed")).toBe("false");
  });
});
