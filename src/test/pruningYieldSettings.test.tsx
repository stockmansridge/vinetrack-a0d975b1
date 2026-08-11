// Pruning Yield Calculator — shared per-block settings (sql/181 contract).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildBlockPrunedYieldTiles } from "@/lib/pruningYieldSummary";
import { defaultSettingsForBlock, PRUNING_YIELD_DEFAULTS } from "@/lib/pruningYieldSettingsQuery";
import { calculatePruningYield } from "@/lib/pruningYieldFormula";
import YieldCalculatorPage from "@/pages/tools/YieldCalculatorPage";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

let role = "owner";
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ selectedVineyardId: "v1", currentRole: role }),
}));

vi.mock("@/components/PageHead", () => ({ PageHead: () => null }));

vi.mock("@/lib/useRegionFormatters", () => ({
  useRegionFormatters: () => ({ areaUnitLabel: "ha", area: (v: number) => `${v} ha` }),
}));

vi.mock("@/lib/yieldReportsQuery", async () => {
  const actual = await vi.importActual<any>("@/lib/yieldReportsQuery");
  return {
    ...actual,
    fetchYieldBlocks: vi.fn(async () => [
      { id: A, name: "Merlot", areaHa: 1.8, vineCount: 3600 },
      { id: B, name: "Shiraz", areaHa: 2, vineCount: 4000 },
    ]),
  };
});

const saveSpy = vi.fn(async (input: any) => input);
vi.mock("@/lib/pruningYieldSettingsQuery", async () => {
  const actual = await vi.importActual<any>("@/lib/pruningYieldSettingsQuery");
  return {
    ...actual,
    fetchPruningYieldSettings: vi.fn(async () => ({
      [A]: {
        vineyardId: "v1",
        paddockId: A,
        pruneMethod: "spur",
        bunchesPerBud: 1.5,
        budsPerSpur: 2,
        spursPerVine: 6,
        budsPerCane: 10,
        canesPerVine: 4,
        vinesPerHa: 2000,
        bunchWeightGrams: 120,
      },
    })),
    savePruningYieldSettings: (i: any) => saveSpy(i),
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <YieldCalculatorPage />
    </QueryClientProvider>,
  );
}

describe("pruning yield settings helpers", () => {
  it("uses canonical defaults for a block with no saved settings", () => {
    const d = defaultSettingsForBlock("v1", { id: B, areaHa: 2, vineCount: 4000 });
    expect(d.pruneMethod).toBe(PRUNING_YIELD_DEFAULTS.pruneMethod);
    expect(d.bunchesPerBud).toBe(1.5);
    expect(d.bunchWeightGrams).toBe(120);
    expect(d.vinesPerHa).toBe(2000);
    expect(d.paddockId).toBe(B);
  });

  it("matches the Rork parity vector (4.32 t/ha, 7.776 t on 1.8 ha)", () => {
    const r = calculatePruningYield({
      method: "spur",
      bunchesPerBud: 1.5,
      budsPerSpur: 2,
      spursPerVine: 6,
      budsPerCane: 10,
      canesPerVine: 4,
      vinesPerHa: 2000,
      bunchWeightGrams: 120,
      areaHectares: 1.8,
    });
    expect(r.yieldTonnesPerHa).toBeCloseTo(4.32, 6);
    expect(r.totalTonnes).toBeCloseTo(7.776, 6);
  });

  it("summary tiles use saved settings and mark unsaved blocks as not set", () => {
    const tiles = buildBlockPrunedYieldTiles(
      [
        { id: A, name: "Merlot", areaHa: 1.8 },
        { id: B, name: "Shiraz", areaHa: 2 },
      ],
      {
        [A]: {
          vineyardId: "v1",
          paddockId: A,
          pruneMethod: "spur",
          bunchesPerBud: 1.5,
          budsPerSpur: 2,
          spursPerVine: 6,
          budsPerCane: 10,
          canesPerVine: 4,
          vinesPerHa: 2000,
          bunchWeightGrams: 120,
        },
      },
    );
    expect(tiles[0].totalTonnes).toBeCloseTo(7.776, 6);
    expect(tiles[1].hasSettings).toBe(false);
    expect(tiles[1].totalTonnes).toBeNull();
  });
});

describe("Pruning Yield Calculator page", () => {
  beforeEach(() => {
    role = "owner";
    saveSpy.mockClear();
    localStorage.setItem("vinetrack.pruningYieldCalculator.v1", JSON.stringify({ vinesPerHa: "9999" }));
  });

  it("shows Block Pruned Yield tiles and retires the legacy localStorage key", async () => {
    renderPage();
    const tile = await screen.findByTestId(`pruned-yield-tile-${A}`);
    expect(within(tile).getByText(/7\.776 t|7\.78 t/)).toBeTruthy();
    const tileB = screen.getByTestId(`pruned-yield-tile-${B}`);
    expect(within(tileB).getByText("Not set")).toBeTruthy();
    expect(localStorage.getItem("vinetrack.pruningYieldCalculator.v1")).toBeNull();
  });

  it("disables Save Block Values until a block is selected, then upserts that block", async () => {
    renderPage();
    const saveBtn = await screen.findByRole("button", { name: "Save Block Values" });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(await screen.findByTestId(`pruned-yield-tile-${B}`));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save Block Values" }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Save Block Values" }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const payload = saveSpy.mock.calls[0][0];
    expect(payload.paddockId).toBe(B);
    // Only input assumptions are persisted — no derived results.
    for (const k of ["budsPerVine", "bunchesPerHa", "yieldKgPerHa", "yieldTonnesPerHa", "totalTonnes"]) {
      expect(payload[k]).toBeUndefined();
    }
  });

  it("loads saved values for a block and does not leak them into an unsaved block", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId(`pruned-yield-tile-${A}`));
    await waitFor(() =>
      expect((screen.getByLabelText("Vines / ha") as HTMLInputElement).value).toBe("2000"),
    );

    // Edit block A without saving, then switch to unsaved block B.
    fireEvent.change(screen.getByLabelText("Vines / ha"), { target: { value: "1234" } });
    fireEvent.click(screen.getByTestId(`pruned-yield-tile-${B}`));
    await waitFor(() =>
      expect((screen.getByLabelText("Vines / ha") as HTMLInputElement).value).toBe("2000"),
    );
    expect((screen.getByLabelText("Bunch weight (g)") as HTMLInputElement).value).toBe("120");
  });

  it("marks the active pruning method with a distinguishable pressed state", async () => {
    renderPage();
    const spur = await screen.findByRole("button", { name: /spur/i });
    const cane = screen.getByRole("button", { name: /cane/i });
    expect(spur.getAttribute("aria-pressed")).toBe("true");
    expect(cane.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(cane);
    await waitFor(() => expect(cane.getAttribute("aria-pressed")).toBe("true"));
  });

  it("hides saving from viewers", async () => {
    role = "viewer";
    renderPage();
    fireEvent.click(await screen.findByTestId(`pruned-yield-tile-${A}`));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Save Block Values" }) as HTMLButtonElement).disabled).toBe(true),
    );
  });
});
