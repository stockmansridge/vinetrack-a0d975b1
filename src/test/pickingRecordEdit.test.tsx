// Editing an existing picking record: the row action, pre-population, saving
// in place (never a duplicate), sold/internal transitions, permissions and the
// unchanged Yield Analytics supersede rule.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PickingLogPanel from "@/components/yield/PickingLogPanel";
import {
  aggregatePickingRecords,
  supersedeActualYield,
  type PickingRecord,
} from "@/lib/pickingRecordsQuery";

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";

const RECORD: PickingRecord = {
  id: "p1",
  vineyard_id: "v1",
  picked_at: "2026-03-04",
  vintage: 2026,
  paddock_id: B1,
  paddock_name: "Block 7",
  variety_id: null,
  variety_key: null,
  variety_name: "Shiraz",
  clone: "BVRC12",
  weight_kg: 1200,
  sugar_value: 13.2,
  sugar_unit: "baume",
  ph: 3.4,
  ta_g_l: 6.1,
  purpose: "Estate wine",
  sold: true,
  sold_to: "Big Winery",
  price_per_tonne: 2000,
  grape_value: 2400,
  notes: "Morning pick",
  created_at: null,
  updated_at: null,
  created_by: null,
};

const updatePickingRecord = vi.fn(async (_i: any) => RECORD);
const createPickingRecord = vi.fn(async (_i: any) => RECORD);
const fetchPickingRecords = vi.fn(async (_v: string) => [RECORD]);

vi.mock("@/lib/pickingRecordsQuery", async () => {
  const actual = await vi.importActual<any>("@/lib/pickingRecordsQuery");
  return {
    ...actual,
    fetchPickingRecords: (v: string) => fetchPickingRecords(v),
    updatePickingRecord: (i: any) => updatePickingRecord(i),
    createPickingRecord: (i: any) => createPickingRecord(i),
    softDeletePickingRecord: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/yieldReportsQuery", () => ({
  fetchYieldBlocks: vi.fn(async () => [
    {
      id: B1,
      name: "Block 7",
      areaHa: 2,
      vineCount: 1000,
      varietyAllocations: [{ variety: "Shiraz", clone: "BVRC12" }],
    },
    {
      id: B2,
      name: "Block 9",
      areaHa: 3,
      vineCount: 1500,
      varietyAllocations: [{ variety: "Merlot" }],
    },
  ]),
  recordActualYield: vi.fn(),
}));
vi.mock("@/lib/varietyResolver", async () => {
  const actual = await vi.importActual<any>("@/lib/varietyResolver");
  return { ...actual, useGrapeVarieties: () => ({ data: [] }) };
});
vi.mock("@/lib/useVintage", () => ({
  useVintage: () => ({ vintage: 2026, seasonStartMonth: 7, seasonStartDay: 1 }),
}));
vi.mock("@/lib/useRegionFormatters", () => ({
  useRegionFormatters: () => ({
    settings: { country_code: "AU", sugar_measurement_unit: null },
    date: (v: string) => v,
    currency: (v: number) => `$${v}`,
    areaUnitLabel: "ha",
    area: (v: number) => `${v} ha`,
  }),
}));

const toasts: any[] = [];
vi.mock("@/hooks/use-toast", () => ({ toast: (t: any) => toasts.push(t) }));

function renderPanel(props: Partial<React.ComponentProps<typeof PickingLogPanel>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PickingLogPanel vineyardId="v1" vintage={2026} canDelete {...props} />
    </QueryClientProvider>,
  );
}

const openEditor = async () => {
  fireEvent.click(await screen.findByLabelText(/Edit picking record/i));
  await screen.findByText("Edit picking record");
};

const saveChanges = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(updatePickingRecord).toHaveBeenCalled());
  return updatePickingRecord.mock.calls.at(-1)![0] as any;
};

const setValue = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Picking record editing", () => {
  beforeEach(() => {
    updatePickingRecord.mockClear();
    createPickingRecord.mockClear();
    updatePickingRecord.mockResolvedValue(RECORD);
    toasts.length = 0;
  });

  it("shows the edit action to an authorised user", async () => {
    renderPanel();
    expect(await screen.findByLabelText(/Edit picking record/i)).toBeTruthy();
  });

  it("hides the edit action from read-only users", async () => {
    renderPanel({ canDelete: false, canEdit: false });
    await screen.findAllByText("Block 7");
    expect(screen.queryByLabelText(/Edit picking record/i)).toBeNull();
  });

  it("pre-populates the existing values", async () => {
    renderPanel();
    await openEditor();
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-03-04");
    expect((screen.getByLabelText("Weight (kg)") as HTMLInputElement).value).toBe("1200");
    expect((screen.getByLabelText("pH") as HTMLInputElement).value).toBe("3.4");
    expect((screen.getByLabelText("TA (g/L)") as HTMLInputElement).value).toBe("6.1");
    expect((screen.getByLabelText("Purpose") as HTMLInputElement).value).toBe("Estate wine");
    expect((screen.getByLabelText("Sold to") as HTMLInputElement).value).toBe("Big Winery");
    expect((screen.getByLabelText("Price per tonne") as HTMLInputElement).value).toBe("2000");
    // The pick resolves to its planting allocation (clone snapshot BVRC12).
    expect(screen.getByLabelText("Planting").textContent).toContain("BVRC12");
    expect(screen.getByLabelText("Variety").textContent).toContain("Shiraz");
  });

  it("saves a weight change against the same row and never creates a duplicate", async () => {
    renderPanel();
    await openEditor();
    setValue("Weight (kg)", "1500");
    const payload = await saveChanges();
    expect(payload.id).toBe("p1");
    expect(payload.weightKg).toBe(1500);
    expect(createPickingRecord).not.toHaveBeenCalled();
    expect(updatePickingRecord).toHaveBeenCalledTimes(1);
    expect(toasts.at(-1)?.title).toBe("Picking record updated");
  });

  it("saves a date change (vintage is re-derived by the backend)", async () => {
    renderPanel();
    await openEditor();
    setValue("Date", "2026-04-10");
    const payload = await saveChanges();
    expect(payload.pickedAt).toBe("2026-04-10");
    expect(payload).not.toHaveProperty("vintage");
  });

  it("saves a block and variety change", async () => {
    renderPanel();
    await openEditor();
    fireEvent.keyDown(screen.getByLabelText("Pick block"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Block 9" }));
    await waitFor(() => expect(screen.getByLabelText("Variety").textContent).toContain("Merlot"));
    const payload = await saveChanges();
    expect(payload.paddockId).toBe(B2);
    expect(payload.paddockName).toBe("Block 9");
    expect(payload.varietyName).toBe("Merlot");
  });

  it("saves a buyer and sale price change", async () => {
    renderPanel();
    await openEditor();
    setValue("Sold to", "Other Winery");
    setValue("Price per tonne", "2500");
    const payload = await saveChanges();
    expect(payload.sold).toBe(true);
    expect(payload.soldTo).toBe("Other Winery");
    expect(payload.pricePerTonne).toBe(2500);
  });

  it("clears the sale fields when a sold pick becomes internal", async () => {
    renderPanel();
    await openEditor();
    fireEvent.click(screen.getByLabelText("Sold"));
    const payload = await saveChanges();
    expect(payload.sold).toBe(false);
    expect(payload.soldTo).toBeNull();
    expect(payload.pricePerTonne).toBeNull();
    expect(payload.weightKg).toBe(1200); // the harvest itself is retained
  });

  it("accepts sale details when an internal pick becomes sold", async () => {
    fetchPickingRecords.mockResolvedValueOnce([
      { ...RECORD, sold: false, sold_to: null, price_per_tonne: null, grape_value: null },
    ]);
    renderPanel();
    await openEditor();
    fireEvent.click(screen.getByLabelText("Sold"));
    setValue("Sold to", "New Buyer");
    setValue("Price per tonne", "1800");
    const payload = await saveChanges();
    expect(payload.sold).toBe(true);
    expect(payload.soldTo).toBe("New Buyer");
    expect(payload.pricePerTonne).toBe(1800);
  });

  it("cancel changes nothing", async () => {
    renderPanel();
    await openEditor();
    setValue("Weight (kg)", "9999");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Edit picking record")).toBeNull());
    expect(updatePickingRecord).not.toHaveBeenCalled();
    expect(createPickingRecord).not.toHaveBeenCalled();
  });

  it("keeps the editor and the entered values open when the save fails", async () => {
    updatePickingRecord.mockRejectedValueOnce(new Error("row level security"));
    renderPanel();
    await openEditor();
    setValue("Weight (kg)", "1500");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(toasts.at(-1)?.description).toContain("row level security"));
    expect(screen.getByText("Edit picking record")).toBeTruthy();
    expect((screen.getByLabelText("Weight (kg)") as HTMLInputElement).value).toBe("1500");
  });
});

describe("Edited picks keep the Yield Analytics contract", () => {
  it("revised weight flows through the picking aggregation", () => {
    const edited = { ...RECORD, weight_kg: 1500 } as PickingRecord;
    const [agg] = aggregatePickingRecords([edited]);
    expect(agg.tonnes).toBe(1.5);
    expect(agg.pickCount).toBe(1);
  });

  it("still supersedes the basic actual yield for the same block, variety and vintage", () => {
    const detailed = aggregatePickingRecords([{ ...RECORD, weight_kg: 1500 } as PickingRecord]);
    const merged = supersedeActualYield(
      [{ blockId: B1, variety: "Shiraz", vintage: 2026, tonnes: 9 }],
      detailed,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].tonnes).toBe(1.5);
    expect(merged[0].source).toBe("detailed");
  });

  it("a block change moves the fact to the new block only", () => {
    const detailed = aggregatePickingRecords([
      { ...RECORD, paddock_id: B2, paddock_name: "Block 9" } as PickingRecord,
    ]);
    const merged = supersedeActualYield(
      [{ blockId: B1, variety: "Shiraz", vintage: 2026, tonnes: 9 }],
      detailed,
    );
    expect(merged.map((m) => m.blockId).sort()).toEqual([B1, B2].sort());
  });
});
