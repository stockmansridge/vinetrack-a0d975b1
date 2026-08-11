// Record Actual Yield dialog: vintage dropdown, shared block source, and
// per-variety tonnes for every configured variety in the block.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RecordActualYieldDialog, {
  seasonLabelForVintage,
  apportionArea,
} from "@/components/yield/RecordActualYieldDialog";

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";

const recordActualYield = vi.fn(async (_input: any) => undefined);
const fetchYieldBlocks = vi.fn(async (_v: string) => [
  { id: B1, name: "Block 7", areaHa: 2, vineCount: 1000, varietyAllocations: [{ variety: "Shiraz" }] },
  {
    id: B2,
    name: "Block 9",
    areaHa: 3,
    vineCount: 1500,
    varietyAllocations: [
      { variety: "Shiraz", percent: 60 },
      { variety: "Cabernet Franc", percent: 40 },
    ],
  },
]);

vi.mock("@/lib/yieldReportsQuery", () => ({
  fetchYieldBlocks: (v: string) => fetchYieldBlocks(v),
  recordActualYield: (input: any) => (recordActualYield as any)(input),
}));
vi.mock("@/lib/varietyResolver", async () => {
  const actual = await vi.importActual<any>("@/lib/varietyResolver");
  return { ...actual, useGrapeVarieties: () => ({ data: [] }) };
});
vi.mock("@/lib/useVintage", () => ({
  useVintage: () => ({ vintage: 2026, seasonStartMonth: 7 }),
}));
vi.mock("@/lib/useRegionFormatters", () => ({
  useRegionFormatters: () => ({ areaUnitLabel: "ha", area: (v: number) => `${v} ha` }),
}));

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordActualYieldDialog vineyardId="v1" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

const selectBlock9 = async () => {
  fireEvent.keyDown(screen.getByLabelText("Block"), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "Block 9" }));
};

describe("RecordActualYieldDialog", () => {
  beforeEach(() => {
    recordActualYield.mockClear();
    fetchYieldBlocks.mockClear();
  });

  it("derives the season label from the vintage (backend only)", () => {
    expect(seasonLabelForVintage(2026, 7)).toBe("2025/26");
    expect(seasonLabelForVintage(2026, 1)).toBe("2026");
  });

  it("apportions block area across varieties by allocation percent", () => {
    expect(apportionArea(10, [60, 40])).toEqual([6, 4]);
    expect(apportionArea(10, [null, null])).toEqual([5, 5]);
    expect(apportionArea(null, [60, 40])).toEqual([null, null]);
  });

  it("renders Vintage as a dropdown and hides backend season labels", async () => {
    renderDialog();
    expect(await screen.findByLabelText("Vintage")).toBeTruthy();
    expect(document.querySelector('input[type="number"]')).toBeNull();
    expect(screen.queryByText(/2025\/26/)).toBeNull();
  });

  it("shows a single variety with its own yield input", async () => {
    renderDialog();
    expect(await screen.findByText("Block 7")).toBeTruthy();
    expect(fetchYieldBlocks).toHaveBeenCalledWith("v1");
    await waitFor(() => expect(screen.getByText("Shiraz")).toBeTruthy());
    expect(screen.getByLabelText("Actual yield (tonnes) — Shiraz")).toBeTruthy();
    expect(screen.queryByLabelText("Variety")).toBeNull();
  });

  it("shows one yield input per variety for a mixed block and saves both", async () => {
    renderDialog();
    await screen.findByText("Block 7");
    await selectBlock9();

    const shiraz = await screen.findByLabelText("Actual yield (tonnes) — Shiraz");
    const cab = screen.getByLabelText("Actual yield (tonnes) — Cabernet Franc");
    fireEvent.change(shiraz, { target: { value: "9.8" } });
    fireEvent.change(cab, { target: { value: "3.4" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(recordActualYield).toHaveBeenCalled());

    const arg = (recordActualYield.mock.calls[0] as any[])[0];
    expect(arg).toMatchObject({
      vineyardId: "v1",
      year: 2026,
      season: "2025/26",
      blockId: B2,
      blockName: "Block 9",
    });
    expect(arg.varieties).toHaveLength(2);
    expect(arg.varieties[0]).toMatchObject({ variety: "Shiraz", actualYieldTonnes: 9.8 });
    expect(arg.varieties[1]).toMatchObject({
      variety: "Cabernet Franc",
      actualYieldTonnes: 3.4,
    });
    // Area is apportioned 60/40 across the 3 ha block.
    expect(arg.varieties[0].areaHectares).toBeCloseTo(1.8, 5);
    expect(arg.varieties[1].areaHectares).toBeCloseTo(1.2, 5);
  });

  it("skips blank varieties and keeps zero values", async () => {
    renderDialog();
    await screen.findByText("Block 7");
    await selectBlock9();

    fireEvent.change(await screen.findByLabelText("Actual yield (tonnes) — Shiraz"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(recordActualYield).toHaveBeenCalled());

    const arg = (recordActualYield.mock.calls[0] as any[])[0];
    expect(arg.varieties).toHaveLength(1);
    expect(arg.varieties[0]).toMatchObject({ variety: "Shiraz", actualYieldTonnes: 0 });
  });

  it("disables Save until at least one variety has a value", async () => {
    renderDialog();
    await screen.findByText("Block 7");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
