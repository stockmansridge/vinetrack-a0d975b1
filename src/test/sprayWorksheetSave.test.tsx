// Worksheet-level save behaviour: partial success wording, and a successful
// write whose canonical refresh fails afterwards.
//
// The real worksheet, plan builder and save functions run; only the network
// boundary (the report read and the shared client's `rpc`) is mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fixtureJson from "../../docs/fixtures/spray-report-v1-stockmans-ridge.json";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: vi.fn() } },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: vi.fn() } },
}));

const fetchReport = vi.fn();
vi.mock("@/lib/sprayReportV1", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/sprayReportV1")>();
  return { ...actual, fetchSprayReportV1: (...a: unknown[]) => fetchReport(...a) };
});
vi.mock("@/lib/queries", () => ({ fetchList: async () => [] }));
vi.mock("@/lib/sprayJobsQuery", () => ({
  fetchVineyardTeamMembers: async () => [],
  memberLabel: (m: any) => m?.name ?? "",
}));
vi.mock("@/lib/vineyardMachinesQuery", () => ({
  fetchAllVineyardMachines: async () => [],
  machineTypeLabel: () => "Tractor",
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: "v1" }) }));
vi.mock("@/lib/systemAdmin", () => ({
  useIsSystemAdmin: () => ({ isAdmin: false, loading: false }),
  useIsSystemAdminRaw: () => ({ isAdmin: false, loading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { parseSprayReportPayload } from "@/lib/sprayReportV1";
import SprayTripWorksheet from "@/components/spray/SprayTripWorksheet";

function payload() {
  const parsed = parseSprayReportPayload(JSON.parse(JSON.stringify(fixtureJson)));
  if (!parsed.payload) throw new Error("fixture did not parse");
  return parsed.payload;
}

function renderWorksheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SprayTripWorksheet tripId="a1b2c3d4-0000-4000-8000-000000000001" vineyardId="v1" canEdit />
    </QueryClientProvider>,
  );
}

async function startEditingWithWaterChange(alsoEditHours = false) {
  renderWorksheet();
  await screen.findByText(/Edit/);
  fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
  const water = await screen.findByLabelText(/Tank 1 actual water/i);
  fireEvent.change(water, { target: { value: "1400" } });
  if (alsoEditHours) {
    fireEvent.change(screen.getByLabelText(/Start engine hours/i), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText(/End engine hours/i), { target: { value: "124" } });
  }
  fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchReport.mockResolvedValue({ payload: payload(), error: null });
});

describe("worksheet save", () => {
  it("says what saved and what still needs attention, never 'not saved'", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "correct_spray_trip_metadata_v1"
        ? { data: { correction: { version: 1 }, report: null }, error: null }
        : fn === "correct_spray_tank_actual_v1"
          ? { data: null, error: { message: "boom", code: "P0001" } }
          : { data: null, error: null },
    );
    await startEditingWithWaterChange(true);
    const note = await screen.findByRole("status");
    expect(note.textContent ?? "").toMatch(/Saved: Trip details/);
    expect(note.textContent ?? "").toMatch(/Still to save: Tank 1/);
    expect(note.textContent ?? "").not.toMatch(/have not been saved/);
    expect(await screen.findByRole("button", { name: /Retry save/i })).toBeTruthy();
  });


  it("keeps a successful save and offers Retry refresh when the reload fails", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    fetchReport
      .mockResolvedValueOnce({ payload: payload(), error: null })
      .mockResolvedValue({ payload: null, error: "network unavailable" });
    await startEditingWithWaterChange();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Retry refresh/i })).toBeTruthy(),
    );
    expect(screen.getByText(/couldn't be refreshed/i)).toBeTruthy();
  });
});
