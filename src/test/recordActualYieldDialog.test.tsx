// Record Actual Yield dialog: vintage dropdown, shared block source, and
// block → variety selection from canonical variety_allocations.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RecordActualYieldDialog, {
  seasonLabelForVintage,
} from "@/components/yield/RecordActualYieldDialog";

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";

const recordActualYield = vi.fn(async () => undefined);
const fetchYieldBlocks = vi.fn(async (_v: string) => [
  { id: B1, name: "Block 7", areaHa: 2, vineCount: 1000, varietyAllocations: [{ variety: "Shiraz" }] },
  {
    id: B2,
    name: "Block 9",
    areaHa: 3,
    vineCount: 1500,
    varietyAllocations: [{ variety: "Shiraz" }, { variety: "Grenache" }],
  },
]);

vi.mock("@/lib/yieldReportsQuery", () => ({
  fetchYieldBlocks: (v: string) => fetchYieldBlocks(v),
  recordActualYield: (...a: any[]) => recordActualYield(...(a as [])),
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

describe("RecordActualYieldDialog", () => {
  beforeEach(() => {
    recordActualYield.mockClear();
    fetchYieldBlocks.mockClear();
  });

  it("derives the season label from the vintage", () => {
    expect(seasonLabelForVintage(2026, 7)).toBe("2025/26");
    expect(seasonLabelForVintage(2026, 1)).toBe("2026");
  });

  it("renders Vintage as a dropdown, not a numeric spinner", async () => {
    renderDialog();
    expect(await screen.findByLabelText("Vintage")).toBeTruthy();
    expect(document.querySelector('input[type="number"]')).toBeNull();
    expect(screen.queryByLabelText(/^Variety \(optional\)$/i)).toBeNull();
  });

  it("populates blocks from the active vineyard and auto-selects a sole variety", async () => {
    renderDialog();
    expect(await screen.findByText("Block 7")).toBeTruthy();
    expect(fetchYieldBlocks).toHaveBeenCalledWith("v1");
    expect(screen.queryByText("No blocks available")).toBeNull();
    await waitFor(() => expect(screen.getByText("Shiraz")).toBeTruthy());
  });

  it("offers a variety choice for multi-variety blocks and saves block + variety", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText("Block 7");

    await user.click(screen.getByLabelText("Block"));
    await user.click(await screen.findByRole("option", { name: "Block 9" }));

    // Changing block resets the selection and shows both configured varieties.
    const varietyTrigger = await screen.findByLabelText("Variety");
    await user.click(varietyTrigger);
    expect(await screen.findByRole("option", { name: "Grenache" })).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "Grenache" }));

    await user.type(screen.getByLabelText("Actual yield (tonnes)"), "12.5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(recordActualYield).toHaveBeenCalled());
    expect(recordActualYield.mock.calls[0][0]).toMatchObject({
      vineyardId: "v1",
      year: 2026,
      season: "2025/26",
      blockId: B2,
      blockName: "Block 9",
      variety: "Grenache",
      actualYieldTonnes: 12.5,
    });
  });
});
