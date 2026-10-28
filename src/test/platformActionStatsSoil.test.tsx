import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { PlatformActionStatsSection } from "@/components/admin/PlatformActionStatsSection";

// SQL 257 returns the operational tables only; soil rows and their participant
// lists arrive from the dedicated read-only helper below.
const soilMock = vi.hoisted(() => ({
  rows: null as null | Array<Record<string, unknown>>,
  error: false,
  days: [] as Array<number | null>,
  participants: [] as Array<[string, string, number | null]>,
}));

const participantMock = vi.hoisted(() =>
  vi.fn(async (_action: string, kind: string) => [
    { id: kind === "users" ? "u" : "v", records: 3 },
  ]),
);

vi.mock("@/lib/soilPlatformActivity", () => ({
  loadSoilActivityStats: vi.fn(async (days: number | null) => {
    soilMock.days.push(days);
    if (soilMock.error) throw new Error("permission denied");
    return soilMock.rows ?? [];
  }),
  loadSoilActivityParticipants: vi.fn(
    async (actionKey: string, kind: string, days: number | null) => {
      soilMock.participants.push([actionKey, kind, days]);
      return kind === "vineyards"
        ? [{ id: "v", records: 2 }]
        : [{ id: "u", records: 2 }];
    },
  ),
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
  fetchActionParticipants: participantMock,
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
    participant_source: "soil",
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
    participant_source: "soil",
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
  soilMock.participants = [];
  participantMock.mockClear();
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

  it("opens the soil vineyard list from the vineyard count", async () => {
    renderSection();
    await screen.findByText("Soil Sample");
    fireEvent.click(screen.getByRole("button", { name: "Soil Sample: 2 vineyards" }));
    expect(await screen.findByRole("link", { name: "Fixture Vineyard" })).toBeTruthy();
    expect(screen.getByText("2 added")).toBeTruthy();
    // The list is read from the soil records, not the SQL 257 participant RPC.
    expect(soilMock.participants).toEqual([["soil_samples", "vineyards", 1]]);
    expect(participantMock).not.toHaveBeenCalled();
  });

  it("opens the soil user list from the user count", async () => {
    renderSection();
    await screen.findByText("Soil Sample");
    fireEvent.click(screen.getByRole("button", { name: "Soil Sample: 1 users" }));
    expect(await screen.findByRole("link", { name: "Fixture User" })).toBeTruthy();
    expect(screen.getByText("fixture@example.invalid")).toBeTruthy();
    expect(soilMock.participants).toEqual([["soil_samples", "users", 1]]);
    expect(participantMock).not.toHaveBeenCalled();
  });

  it("opens the lab document uploader list", async () => {
    renderSection();
    await screen.findByText("Soil Lab Document");
    fireEvent.click(screen.getByRole("button", { name: "Soil Lab Document: 1 users" }));
    expect(await screen.findByRole("link", { name: "Fixture User" })).toBeTruthy();
    expect(soilMock.participants).toEqual([["soil_sample_documents", "users", 1]]);
  });

  it("still opens SQL 257 participant lists for operational rows", async () => {
    renderSection();
    await screen.findByText("Soil Sample");
    fireEvent.click(screen.getByRole("button", { name: "Trips: 1 vineyards" }));
    expect(await screen.findByRole("link", { name: "Fixture Vineyard" })).toBeTruthy();
    expect(participantMock).toHaveBeenCalled();
    expect(soilMock.participants).toEqual([]);
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
