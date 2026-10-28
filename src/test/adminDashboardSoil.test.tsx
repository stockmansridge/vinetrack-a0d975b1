import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AdminDashboardPage from "@/pages/admin/AdminDashboardPage";
import * as adminApi from "@/lib/adminApi";

const soilMock = vi.hoisted(() => ({
  count: null as number | null,
  error: null as { message: string } | null,
}));

vi.mock("@/lib/adminApi", async (importOriginal) => {
  const mod = await importOriginal<typeof adminApi>();
  return { ...mod };
});

vi.mock("@/lib/systemAdmin", () => ({
  useIsSystemAdmin: () => ({ isAdmin: true, loading: false }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "admin@example.com" } }),
}));

vi.mock("@/components/admin/PlatformActionStatsSection", () => ({
  PlatformActionStatsSection: () => null,
}));

/**
 * ios-supabase client mock: `from(table)` returns a chainable builder whose
 * `select(...)` resolves to a head-count result driven by soilMock.
 */
vi.mock("@/integrations/ios-supabase/client", () => {
  const makeBuilder = () => {
    const b: any = {};
    for (const m of ["is", "eq", "in", "neq", "order", "limit"]) {
      b[m] = () => b;
    }
    b.select = () =>
      Promise.resolve({ count: soilMock.count, error: soilMock.error });
    b.rpc = () => Promise.resolve({ data: [], error: null });
    return b;
  };
  return {
    iosSupabase: {
      from: (_t: string) => makeBuilder(),
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});

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

function mockAdminFeeds() {
  vi.spyOn(adminApi, "useEngagementSummary").mockReturnValue({
    data: {
      total_users: 5,
      total_vineyards: 2,
      signed_in_last_7_days: 1,
      signed_in_last_30_days: 2,
      new_users_last_30_days: 0,
      pending_invitations: 0,
      total_pins: 0,
      total_spray_records: 0,
      total_work_tasks: 0,
    } as any,
    isLoading: false,
    error: null,
  } as any);
  vi.spyOn(adminApi, "useAdminUsers").mockReturnValue({ data: [], isLoading: false, error: null } as any);
  vi.spyOn(adminApi, "useAdminVineyards").mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  } as any);
  vi.spyOn(adminApi, "useAdminVineyardActivityCounts").mockReturnValue({
    data: new Map(),
    isLoading: false,
    error: null,
  } as any);
  vi.spyOn(adminApi, "usePlatformScale").mockReturnValue({
    data: null,
    isLoading: false,
    error: null,
  } as any);
}

describe("AdminDashboardPage soil analysis tiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    soilMock.count = null;
    soilMock.error = null;
    mockAdminFeeds();
  });

  it("renders soil samples, uploads and review tiles linking to /soil-analysis", async () => {
    soilMock.count = 12;
    render(<AdminDashboardPage />, { wrapper });

    // Wait for the head-count queries to resolve.
    await screen.findByText("12 confirmed");

    const soilTiles = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/soil-analysis?tab=samples");
    expect(soilTiles.length).toBe(3);

    const labels = soilTiles.map((t) => t.textContent);
    expect(labels.join(" ")).toContain("Soil Samples");
    expect(labels.join(" ")).toContain("Soil Uploads");
    expect(labels.join(" ")).toContain("Soil Review");
    // Every count resolves to 12 in the mock, and each tile surfaces its hint.
    expect(labels.join(" ")).toContain("12 confirmed");
    expect(labels.join(" ")).toContain("12 awaiting review");
  });

  it("shows an unavailable hint when the soil counts fail", async () => {
    soilMock.error = { message: "permission denied" };
    render(<AdminDashboardPage />, { wrapper });

    const unavailable = await screen.findAllByText("Unavailable");
    expect(unavailable.length).toBeGreaterThanOrEqual(2);
  });
});
