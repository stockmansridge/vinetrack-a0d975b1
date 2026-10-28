import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { PlatformActionStatsSection } from "@/components/admin/PlatformActionStatsSection";

// SQL 257 returns the operational tables only; soil rows arrive from the
// dedicated read-only helper below.
const soilMock = vi.hoisted(() => ({
  rows: null as null | Array<Record<string, unknown>>,
  error: false,
  days: [] as Array<number | null>,
}));

vi.mock("@/lib/soilPlatformActivity", () => ({
  loadSoilActivityStats: vi.fn(async (days: number | null) => {
    soilMock.days.push(days);
    if (soilMock.error) throw new Error("permission denied");
    return soilMock.rows ?? [];
  }),
}));

vi.mock("@/integrations/ios-supabase/client", () => ({
  iosSupabase: {
    rpc: vi.fn(async () => ({
      data: [
        {
          action_key: "trips",
          label: "Trips",
          category: "Operations",
          created_count: 3,
          edited_count: 0,
          deleted_count: 0,
          vineyard_count: 1,
          user_count: 1,
        },
      ],
      error: null,
    })),
  },
}));

vi.mock("@/lib/adminActionParticipants", () => ({
  fetchActionParticipants: vi.fn(async (_a, kind) => [
    { id: kind === "users" ? "u" : "v", records: 3 },
  ]),
}));

vi.mock("@/lib/adminApi", () => ({
  useAdminUsers: () => ({
    data: [{ id: "u", full_name: "Fixture User", email: "fixture@example.invalid" }],
  }),
  useAdminVineyards: () => ({ data: [{ id: "v", name: "Fixture Vineyard" }] }),
}));

const SOIL_ROWS = [
  {
    action_key: "soil_samples",
    label: "Soil Sample",
    category: "Soil Analysis",
    created_count: 2,
    edited_count: 1,
    deleted_count: 0,
    vineyard_count: 2,
    user_count: 1,
    drilldown: false,
  },
  {
    action_key: "soil_sample_documents",
    label: "Soil Lab Document",
    category: "Soil Analysis",
    created_count: 2,
    edited_count: null,
    deleted_count: null,
    vineyard_count: 2,
    user_count: 1,
    drilldown: false,
  },
];

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PlatformActionStatsSection />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  soilMock.rows = SOIL_ROWS as never;
  soilMock.error = false;
  soilMock.days = [];
});

afterEach(cleanup);

describe("What people are doing — soil activity", () => {
  it("lists soil samples and lab documents inside the same ranked table", async () => {
    renderSection();
    expect(await screen.findByText("Soil Sample")).toBeTruthy();
    expect(screen.getByText("Soil Lab Document")).toBeTruthy();
    expect(screen.getByText("Trips")).toBeTruthy();
    // Soil Analysis rows carry the shared category label.
    expect(screen.getAllByText("Soil Analysis").length).toBe(2);
    // 3 trips + 3 soil sample actions + 2 document uploads = 8 actions.
    expect(screen.getByText(/8 actions in total/)).toBeTruthy();

  });

  it("shows soil added/edited counts and a dash for untracked document edits", async () => {
    renderSection();
    const sampleRow = (await screen.findByText("Soil Sample")).closest("tr")!;
    expect(sampleRow.textContent).toContain("Soil Analysis");
    const documentRow = screen.getByText("Soil Lab Document").closest("tr")!;
    expect(documentRow.textContent).toContain("—");
  });

  it("keeps soil counts as totals while operational counts still open their list", async () => {
    renderSection();
    await screen.findByText("Soil Sample");
    // Trips attribution stays clickable.
    fireEvent.click(screen.getByRole("button", { name: "Trips: 1 vineyards" }));
    expect(await screen.findByRole("link", { name: "Fixture Vineyard" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    // Soil attribution has no participant feed, so it must not be clickable.
    expect(screen.queryByRole("button", { name: "Soil Sample: 2 vineyards" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Soil Lab Document: 1 users" })).toBeNull();
  });

  it("follows the selected period", async () => {
    renderSection();
    await screen.findByText("Soil Sample");
    expect(soilMock.days).toEqual([1]);
    fireEvent.click(screen.getByRole("button", { name: "7 Days" }));
    await waitFor(() => expect(soilMock.days).toContain(7));
  });

  it("says so when soil activity is unavailable instead of showing nothing", async () => {
    soilMock.error = true;
    renderSection();
    expect(await screen.findByText("Trips")).toBeTruthy();
    expect(
      await screen.findByText(
        "Soil Analysis activity isn't available with your current access, so no soil figures are shown.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Soil Sample")).toBeNull();
  });
});
