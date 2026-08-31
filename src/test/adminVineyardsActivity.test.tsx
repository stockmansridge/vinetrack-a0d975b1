import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AdminVineyardsPage from "@/pages/admin/AdminVineyardsPage";
import * as adminApi from "@/lib/adminApi";
import type { AdminVineyard, AdminVineyardActivityCounts } from "@/lib/adminApi";

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

const vineyard = (id: string, name: string): AdminVineyard => ({
  id,
  name,
  owner_id: `owner-${id}`,
  owner_email: `${id}@example.com`,
  owner_full_name: null,
  country: "AU",
  created_at: "2024-01-01T00:00:00Z",
  deleted_at: null,
  member_count: 1,
  pending_invites: 0,
});

const counts = (
  id: string,
  c: Partial<Omit<AdminVineyardActivityCounts, "vineyard_id">>,
): AdminVineyardActivityCounts => ({
  vineyard_id: id,
  trip_count: 0,
  pin_count: 0,
  spray_record_count: 0,
  work_task_count: 0,
  ...c,
});

function mockVineyards(rows: AdminVineyard[]) {
  vi.spyOn(adminApi, "useAdminVineyards").mockReturnValue({
    data: rows,
    isLoading: false,
    error: null,
  } as any);
}

function mockActivity(state: {
  data?: Map<string, AdminVineyardActivityCounts>;
  isLoading?: boolean;
  error?: unknown;
}) {
  vi.spyOn(adminApi, "useAdminVineyardActivityCounts").mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    error: state.error ?? null,
  } as any);
}

describe("AdminVineyardsPage activity counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows authoritative counts well beyond the old 500-row window", () => {
    mockVineyards([vineyard("v1", "Busy Vineyard")]);
    mockActivity({
      data: new Map([
        [
          "v1",
          counts("v1", {
            trip_count: 1200,
            pin_count: 640,
            spray_record_count: 501,
            work_task_count: 999,
          }),
        ],
      ]),
    });

    render(<AdminVineyardsPage />, { wrapper });

    const row = screen.getByText("Busy Vineyard").closest("a")!;
    expect(row).toHaveTextContent("1200 trips");
    expect(row).toHaveTextContent("640 pins");
    expect(row).toHaveTextContent("501 sprays");
    expect(row).toHaveTextContent("999 tasks");
  });

  it("counts old records for a vineyard whose activity is entirely outside the newest global records", () => {
    // The aggregate is server-side, so an "old" vineyard still gets real
    // numbers even though it would never appear in a newest-first feed.
    mockVineyards([vineyard("newV", "Recent Vineyard"), vineyard("oldV", "Historic Vineyard")]);
    mockActivity({
      data: new Map([
        ["newV", counts("newV", { trip_count: 500 })],
        ["oldV", counts("oldV", { pin_count: 37, work_task_count: 4 })],
      ]),
    });

    render(<AdminVineyardsPage />, { wrapper });

    const row = screen.getByText("Historic Vineyard").closest("a")!;
    expect(row).toHaveTextContent("37 pins");
    expect(row).toHaveTextContent("4 tasks");
    expect(row).not.toHaveTextContent("No activity");
  });

  it("does not count deleted records (server excludes them; zeros render as No activity)", () => {
    // The RPC filters deleted_at IS NULL, so a vineyard whose only records are
    // soft-deleted comes back as authoritative zeros.
    mockVineyards([vineyard("v1", "Archived Activity Vineyard")]);
    mockActivity({ data: new Map([["v1", counts("v1", {})]]) });

    render(<AdminVineyardsPage />, { wrapper });

    expect(screen.getByText("No activity")).toBeInTheDocument();
  });

  it("shows 'No activity' for a genuine zero-activity vineyard", () => {
    mockVineyards([vineyard("v1", "Empty Vineyard")]);
    mockActivity({ data: new Map([["v1", counts("v1", {})]]) });

    render(<AdminVineyardsPage />, { wrapper });

    expect(screen.getByText("No activity")).toBeInTheDocument();
  });

  it("does not claim 'No activity' when the activity query fails", () => {
    mockVineyards([vineyard("v1", "Unknown Activity Vineyard")]);
    mockActivity({ data: undefined, error: new Error("permission denied") });

    render(<AdminVineyardsPage />, { wrapper });

    expect(screen.queryByText("No activity")).not.toBeInTheDocument();
    expect(screen.getByText("Activity unavailable")).toBeInTheDocument();
  });

  it("keeps the vineyard list rendered when the activity query fails", () => {
    mockVineyards([vineyard("v1", "Still Listed Vineyard")]);
    mockActivity({ data: undefined, error: new Error("permission denied") });

    render(<AdminVineyardsPage />, { wrapper });

    expect(screen.getByText("Still Listed Vineyard")).toBeInTheDocument();
    expect(screen.queryByText("permission denied")).not.toBeInTheDocument();
  });

  it("shows the page error only when the vineyard list itself fails", () => {
    vi.spyOn(adminApi, "useAdminVineyards").mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error("vineyards unavailable"),
    } as any);
    mockActivity({ data: new Map() });

    render(<AdminVineyardsPage />, { wrapper });

    expect(screen.getByText("vineyards unavailable")).toBeInTheDocument();
  });
});
