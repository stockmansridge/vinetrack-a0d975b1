import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AdminVineyardsPage from "@/pages/admin/AdminVineyardsPage";
import * as adminApi from "@/lib/adminApi";
import type { AdminVineyard, AdminPin, AdminSprayRecord, AdminWorkTask, AdminTrip } from "@/lib/adminApi";

vi.mock("@/lib/adminApi", async (importOriginal) => {
  const mod = await importOriginal<typeof adminApi>();
  return { ...mod };
});

vi.mock("@/lib/systemAdmin", () => ({
  useIsSystemAdmin: () => ({ isAdmin: true, loading: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe("AdminVineyardsPage activity counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders activity counts per vineyard", () => {
    const vineyards: AdminVineyard[] = [
      {
        id: "v1",
        name: "Active Vineyard",
        owner_id: "u1",
        owner_email: "owner@example.com",
        owner_full_name: "Owner Name",
        country: "AU",
        created_at: "2024-01-01T00:00:00Z",
        deleted_at: null,
        member_count: 3,
        pending_invites: 1,
      },
      {
        id: "v2",
        name: "Quiet Vineyard",
        owner_id: "u2",
        owner_email: "quiet@example.com",
        owner_full_name: null,
        country: "NZ",
        created_at: "2024-02-01T00:00:00Z",
        deleted_at: null,
        member_count: 1,
        pending_invites: 0,
      },
    ];

    const pins: AdminPin[] = [
      { id: "p1", vineyard_id: "v1", vineyard_name: "Active Vineyard", title: "Pin 1", category: "observation", status: null, created_at: null, is_completed: false },
      { id: "p2", vineyard_id: "v1", vineyard_name: "Active Vineyard", title: "Pin 2", category: "repair", status: null, created_at: null, is_completed: false },
    ];

    const spray: AdminSprayRecord[] = [
      { id: "s1", vineyard_id: "v1", vineyard_name: "Active Vineyard", spray_reference: "S1", operation_type: null, date: null, created_at: null },
    ];

    const tasks: AdminWorkTask[] = [
      { id: "w1", vineyard_id: "v2", vineyard_name: "Quiet Vineyard", task_type: "pruning", paddock_name: null, date: null, duration_hours: null, created_at: null },
    ];

    const trips: AdminTrip[] = [
      { id: "t1", vineyard_id: "v1", vineyard_name: "Active Vineyard", trip_title: "Trip 1", trip_function: null, start_time: null, end_time: null, created_at: null },
      { id: "t2", vineyard_id: "v1", vineyard_name: "Active Vineyard", trip_title: "Trip 2", trip_function: null, start_time: null, end_time: null, created_at: null },
    ];

    vi.spyOn(adminApi, "useAdminVineyards").mockReturnValue({
      data: vineyards,
      isLoading: false,
      error: null,
    } as any);
    vi.spyOn(adminApi, "useAdminPins").mockReturnValue({ data: pins, isLoading: false, error: null } as any);
    vi.spyOn(adminApi, "useAdminSprayRecords").mockReturnValue({ data: spray, isLoading: false, error: null } as any);
    vi.spyOn(adminApi, "useAdminWorkTasks").mockReturnValue({ data: tasks, isLoading: false, error: null } as any);
    vi.spyOn(adminApi, "useAdminTrips").mockReturnValue({ data: trips, isLoading: false, error: null } as any);

    render(<AdminVineyardsPage />, { wrapper });

    expect(screen.getByText("Active Vineyard")).toBeInTheDocument();
    expect(screen.getByText("Quiet Vineyard")).toBeInTheDocument();

    // Active vineyard should show 2 trips, 2 pins, 1 spray
    const activeRow = screen.getByText("Active Vineyard").closest("a")!;
    expect(activeRow).toHaveTextContent("2 trips");
    expect(activeRow).toHaveTextContent("2 pins");
    expect(activeRow).toHaveTextContent("1 spray");

    // Quiet vineyard has 1 task but no trips/pins/sprays
    const quietRow = screen.getByText("Quiet Vineyard").closest("a")!;
    expect(quietRow).toHaveTextContent("1 task");
  });

  it("shows 'No activity' for vineyards with zero records", () => {
    const vineyards: AdminVineyard[] = [
      {
        id: "v1",
        name: "Empty Vineyard",
        owner_id: "u1",
        owner_email: "empty@example.com",
        owner_full_name: null,
        country: "AU",
        created_at: "2024-01-01T00:00:00Z",
        deleted_at: null,
        member_count: 1,
        pending_invites: 0,
      },
    ];

    vi.spyOn(adminApi, "useAdminVineyards").mockReturnValue({
      data: vineyards,
      isLoading: false,
      error: null,
    } as any);
    vi.spyOn(adminApi, "useAdminPins").mockReturnValue({ data: [], isLoading: false, error: null } as any);
    vi.spyOn(adminApi, "useAdminSprayRecords").mockReturnValue({ data: [], isLoading: false, error: null } as any);
    vi.spyOn(adminApi, "useAdminWorkTasks").mockReturnValue({ data: [], isLoading: false, error: null } as any);
    vi.spyOn(adminApi, "useAdminTrips").mockReturnValue({ data: [], isLoading: false, error: null } as any);

    render(<AdminVineyardsPage />, { wrapper });

    expect(screen.getByText("No activity")).toBeInTheDocument();
  });
});
