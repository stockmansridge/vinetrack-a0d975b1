import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LiveDashboardPage from "@/pages/LiveDashboardPage";
import type { Trip, TripsQueryResult } from "@/lib/tripsQuery";

vi.mock("@/components/TripRouteAppleMap", () => ({ default: () => null }));
vi.mock("@/components/dashboard/LiveWeatherSummary", () => ({
  LiveWeatherSummary: () => null,
  evaluateTripWeather: () => null,
  TripWeatherBadge: () => null,
}));
vi.mock("@/lib/useRegionFormatters", () => ({
  useRegionFormatters: () => ({
    blockLabel: "Block",
    area: (v: number) => `${v} ha`,
    date: (v: string) => String(v).slice(0, 10),
  }),
}));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {} }));
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({
    memberships: [
      {
        vineyard_id: "11111111-1111-1111-1111-111111111111",
        vineyard_name: "Test Vineyard",
        role: "owner",
      },
    ],
    loading: false,
    selectedVineyardId: "11111111-1111-1111-1111-111111111111",
    selectVineyard: () => {},
    currentRole: "owner",
    currentCountry: "AU",
  }),
}));

const VID = "11111111-1111-1111-1111-111111111111";

const trip = (over: Partial<Trip>): Trip => ({
  id: "00000000-0000-0000-0000-000000000000",
  vineyard_id: VID,
  trip_title: over.trip_title ?? "Trip",
  trip_function: over.trip_function ?? "spraying",
  person_name: over.person_name ?? "Operator",
  paddock_name: over.paddock_name ?? "Block A",
  is_active: over.is_active ?? true,
  is_paused: over.is_paused ?? false,
  end_time: over.end_time ?? null,
  start_time: over.start_time ?? new Date().toISOString(),
  updated_at: over.updated_at ?? new Date().toISOString(),
  path_points: over.path_points ?? null,
  completed_paths: over.completed_paths ?? null,
  row_sequence: over.row_sequence ?? null,
  ...over,
});

function renderWithTrips(trips: Trip[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  qc.setQueryData(["paddocks-lite", VID], []);
  qc.setQueryData(["work_tasks", VID, ""], { tasks: [] });
  const result: TripsQueryResult = {
    trips,
    source: "vineyard_id",
    vineyardCount: trips.length,
    paddockFallbackCount: 0,
    paddockJsonbFallbackCount: 0,
    deletedExcluded: 0,
    missingStart: 0,
    missingPaddock: 0,
  };
  qc.setQueryData(["live-trips", VID, ""], result);
  return render(
    <QueryClientProvider client={qc}>
      <LiveDashboardPage />
    </QueryClientProvider>,
  );
}

describe("Live Dashboard trip status display", () => {
  it("shows two active trips and excludes an inactive/no-end-time saved trip", async () => {
    renderWithTrips([
      trip({ id: "active-1", person_name: "Sam" }),
      trip({ id: "active-2", person_name: "Alex" }),
      trip({ id: "saved", is_active: false, end_time: null, person_name: "Unused" }),
    ]);
    await waitFor(() => expect(screen.getByText("Active trips")).toBeTruthy());
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByTestId("trip-row-active-1")).toBeTruthy();
    expect(screen.getByTestId("trip-row-active-2")).toBeTruthy();
    expect(screen.queryByTestId("trip-row-saved")).toBeNull();
  });

  it("selects one active trip independently of another", async () => {
    renderWithTrips([
      trip({ id: "active-1", person_name: "Sam" }),
      trip({ id: "active-2", person_name: "Alex" }),
    ]);
    await waitFor(() => expect(screen.getByTestId("trip-row-active-1")).toBeTruthy());
    const row1 = screen.getByTestId("trip-row-active-1");
    const row2 = screen.getByTestId("trip-row-active-2");
    fireEvent.click(row2);
    await waitFor(() => expect(row2.className).toContain("bg-muted/50"));
    expect(row1.className).not.toContain("bg-muted/50");
  });
});
