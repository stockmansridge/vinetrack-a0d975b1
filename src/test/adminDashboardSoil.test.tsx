import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AdminDashboardPage from "@/pages/admin/AdminDashboardPage";
import * as adminApi from "@/lib/adminApi";

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

interface FakeDoc {
  count: number | null;
  error: { message: string } | null;
}

/**
 * ios-supabase client mock: `from(table)` returns a chainable builder whose
 * `select(...)` resolves to a head-count result driven by the mock table map.
 */
function makeClient(doc: FakeDoc) {
  const makeBuilder = () => {
    const b: any = {};
    for (const m of ["is", "eq", "in", "neq", "order", "limit"]) {
      b[m] = () => b;
    }
    b.select = () => Promise.resolve({ count: doc.count, error: doc.error });
    b.rpc = () => Promise.resolve({ data: [], error: null });
    return b;
  };
  return {
    from: (_t: string) => makeBuilder(),
    rpc: () => Promise.resolve({ data: [], error: null }),
  };
}

vi.mock("@/integrations/ios-supabase/client", () => ({
  iosSupabase: makeClient({ count: null, error: null }),
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
    mockAdminFeeds();
  });

  it("renders soil samples, uploads and review tiles with live counts", async () => {
    const ios = await import("@/integrations/ios-supabase/client");
    (ios as any).iosSupabase = makeClient({ count: 12, error: null });
    vi.doMock("@/integrations/ios-supabase/client", () => ({
      iosSupabase: makeClient({ count: 12, error: null }),
    }));

    render(<AdminDashboardPage />, { wrapper });

    const samples = await screen.findByText("Soil Samples");
    expect(samples).toBeTruthy();

    const tiles = screen.getAllByRole("link");
    const soilTiles = tiles.filter((a) => a.getAttribute("href") === "/soil-analysis?tab=samples");
    expect(soilTiles.length).toBe(3);

    const soilTexts = soilTiles.map((t) => t.textContent);
    // With every count resolving to 12, all three tiles show 12.
    for (const text of soilTexts) {
      expect(text).toMatch(/12/);
    }
    expect(soilTexts.join(" ")).toContain("confirmed");
    expect(soilTexts.join(" ")).toContain("awaiting review");
  });

  it("shows an unavailable hint when the soil counts fail", async () => {
    vi.doMock("@/integrations/ios-supabase/client", () => ({
      iosSupabase: makeClient({ count: null, error: { message: "permission denied" } }),
    }));

    render(<AdminDashboardPage />, { wrapper });

    const unavailable = await screen.findAllByText("Unavailable");
    expect(unavailable.length).toBeGreaterThanOrEqual(2);
  });
});
