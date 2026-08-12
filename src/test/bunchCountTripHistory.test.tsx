// sql/187 — shared Bunch Count sampling density + Bunch Count Trip history.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  buildBunchCountTrips,
  currentEstimatesByBlock,
  currentTripIds,
} from "@/lib/bunchCountTrips";
import { canEditYieldSampling } from "@/lib/yieldSamplingSettingsQuery";
import BunchCountSamplingCard from "@/components/yield/BunchCountSamplingCard";
import BunchCountTripsPanel from "@/components/yield/BunchCountTripsPanel";

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";

vi.mock("@/lib/useRegionFormatters", () => ({
  useRegionFormatters: () => ({
    areaUnitLabel: "ha",
    area: (v: number) => `${v} ha`,
    date: (v: string) => String(v).slice(0, 10),
  }),
}));

const fetchSpy = vi.fn(async () => 20);
const setSpy = vi.fn(async (_v: string, n: number) => n);
vi.mock("@/lib/yieldSamplingSettingsQuery", async () => {
  const actual = await vi.importActual<any>("@/lib/yieldSamplingSettingsQuery");
  return {
    ...actual,
    fetchYieldSamplingSettings: (...a: any[]) => (fetchSpy as any)(...a),
    setYieldSamplingSettings: (...a: any[]) => (setSpy as any)(...a),
  };
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const blocks = [
  { id: B1, name: "Block A", areaHa: 2, vineCount: 1000 },
  { id: B2, name: "Block B", areaHa: 1, vineCount: 500 },
];

const session = (over: any) => ({
  id: over.id,
  is_completed: over.is_completed ?? true,
  completed_at: over.completed_at ?? null,
  session_created_at: over.created_at ?? "2026-01-01T00:00:00Z",
  payload: {
    selectedPaddockIds: [B1],
    samplesPerHectare: 20,
    blockBunchWeightsKg: { [B1]: 0.2 },
    sampleSites: [
      { paddockId: B1, siteIndex: 1, bunchCountEntry: { bunchesPerVine: 20 } },
      { paddockId: B1, siteIndex: 2, bunchCountEntry: { bunchesPerVine: 30 } },
    ],
    ...(over.payload ?? {}),
  },
});

const vintageOf = (iso: string) => (new Date(iso).getUTCMonth() >= 6 ? new Date(iso).getUTCFullYear() + 1 : new Date(iso).getUTCFullYear());

describe("Shared sampling density (sql/187)", () => {
  beforeEach(() => {
    fetchSpy.mockClear();
    setSpy.mockClear();
  });

  it("permits only trip-capable roles to edit", () => {
    expect(canEditYieldSampling("owner")).toBe(true);
    expect(canEditYieldSampling("manager")).toBe(true);
    expect(canEditYieldSampling("supervisor")).toBe(true);
    expect(canEditYieldSampling("operator")).toBe(true);
    expect(canEditYieldSampling("viewer")).toBe(false);
    expect(canEditYieldSampling(null)).toBe(false);
  });

  it("loads and shows the shared value", async () => {
    wrap(<BunchCountSamplingCard vineyardId="v1" role="owner" />);
    await waitFor(() =>
      expect(screen.getByText(/Current shared value: 20 samples per hectare/)).toBeTruthy(),
    );
    expect((screen.getByLabelText("Samples per hectare") as HTMLInputElement).value).toBe("20");
  });

  it("saves through the shared RPC and re-reads the value", async () => {
    fetchSpy.mockImplementation(async () => (setSpy.mock.calls.length ? 35 : 20));
    wrap(<BunchCountSamplingCard vineyardId="v1" role="manager" />);
    const input = await screen.findByLabelText("Samples per hectare");
    fireEvent.change(input, { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(setSpy).toHaveBeenCalledWith("v1", 35));
    await waitFor(() =>
      expect(screen.getByText(/Current shared value: 35 samples per hectare/)).toBeTruthy(),
    );
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not let an unauthorised role edit", async () => {
    wrap(<BunchCountSamplingCard vineyardId="v1" role="viewer" />);
    const input = await screen.findByLabelText("Samples per hectare");
    expect((input as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.getByText(/Your role cannot change this setting/)).toBeTruthy();
  });
});

describe("Bunch Count Trip history (sql/187)", () => {
  const sessions = [
    session({ id: "old", completed_at: "2026-01-05T00:00:00Z", created_at: "2026-01-05T00:00:00Z" }),
    session({
      id: "new",
      completed_at: "2026-02-05T00:00:00Z",
      created_at: "2026-02-05T00:00:00Z",
      payload: { routeSourceSessionId: "old", applyDamage: false },
    }),
    session({ id: "draft", is_completed: false, completed_at: null, created_at: "2026-03-05T00:00:00Z" }),
    session({ id: "lastyear", completed_at: "2025-02-05T00:00:00Z", created_at: "2025-02-05T00:00:00Z" }),
  ];

  const trips = buildBunchCountTrips(sessions as any, { blocks, vintageOf });
  const estimates = currentEstimatesByBlock(trips, 2026);
  const live = currentTripIds(estimates);

  it("selects the latest completed trip and never a draft", () => {
    expect(Array.from(live)).toEqual(["new"]);
    expect(live.has("draft")).toBe(false);
    expect(live.has("old")).toBe(false);
  });

  it("matches the Yield Reports block selection rule", () => {
    const est = estimates.get(B1.toLowerCase())!;
    expect(est.tripId).toBe("new");
    expect(est.tripCompletedAt).toBe("2026-02-05T00:00:00Z");
  });

  it("keeps older completed trips as history", () => {
    expect(trips.map((t) => t.id)).toEqual(["draft", "new", "old", "lastyear"]);
  });

  it("filters by vintage without changing current-estimate logic", () => {
    const v2026 = trips.filter((t) => t.vintage === 2026);
    expect(v2026.map((t) => t.id).sort()).toEqual(["draft", "new", "old"]);
    const prior = currentEstimatesByBlock(trips, 2025);
    expect(prior.get(B1.toLowerCase())?.tripId).toBe("lastyear");
  });

  it("renders badges, route reuse and damage state", async () => {
    const vintageTrips = trips.filter((t) => t.vintage === 2026);
    wrap(
      <BunchCountTripsPanel
        trips={vintageTrips}
        currentEstimates={estimates}
        liveTripIds={live}
        onOpenTrip={() => {}}
      />,
    );
    expect(screen.getAllByText("CURRENT ESTIMATE")).toHaveLength(1);
    expect(screen.getByText("Draft")).toBeTruthy();
    // The current trip has applyDamage:false → base estimate.
    const row = screen.getByTestId("trip-row-new");
    expect(row.textContent).toContain("Base estimate");
    expect(row.textContent).toContain("Route reused");
    expect(screen.getByTestId("trip-row-old").textContent).toContain("New route");
    expect(screen.getByTestId("trip-row-old").textContent).toContain("Damage adjustment applied");

    fireEvent.click(row);
    await waitFor(() => expect(screen.getByText(/Route source:/)).toBeTruthy());
    expect(screen.getByText(/From trip completed 2026-01-05/)).toBeTruthy();
  });
});
