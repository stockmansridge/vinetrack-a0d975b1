// Explicit row recovery operation identity: one press = one operationId,
// an uncertain retry of that attempt reuses it, a new deliberate attempt
// creates a fresh id, the mutation never auto-retries, and report reads never
// invoke recovery.
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

const recover = vi.fn();
vi.mock("@/lib/sprayRowRecovery", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/sprayRowRecovery")>();
  return { ...actual, recoverSprayRowAssignments: (...a: unknown[]) => recover(...a) };
});

import { parseSprayReportPayload } from "@/lib/sprayReportV1";
import SprayTripWorksheet from "@/components/spray/SprayTripWorksheet";

function payload() {
  const parsed = parseSprayReportPayload(JSON.parse(JSON.stringify(fixtureJson)));
  if (!parsed.payload) throw new Error("fixture did not parse");
  return parsed.payload;
}

const TRIP_ID = "a1b2c3d4-0000-4000-8000-000000000001";

function renderWorksheet(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <SprayTripWorksheet tripId={TRIP_ID} vineyardId="v1" canEdit />
    </QueryClientProvider>,
  );
}

async function pressRecover() {
  const btn = await screen.findByRole("button", { name: /Recover row and block matches/i });
  fireEvent.click(btn);
  await waitFor(() => expect(recover).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchReport.mockResolvedValue({ payload: payload(), error: null });
});

describe("row recovery operation identity", () => {
  it("an explicit press always supplies a caller-generated operationId", async () => {
    recover.mockResolvedValue({ kind: "none", message: "no evidence" });
    renderWorksheet();
    await pressRecover();
    const arg = recover.mock.calls[0][0] as any;
    expect(arg.tripId).toBe(TRIP_ID);
    expect(typeof arg.operationId).toBe("string");
    expect(arg.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("an uncertain retry of the same attempt preserves the operationId", async () => {
    recover.mockResolvedValue({ kind: "failed", message: "try again", diagnostic: "boom" });
    renderWorksheet();
    await pressRecover();
    await pressRecover();
    expect(recover).toHaveBeenCalledTimes(2);
    const first = (recover.mock.calls[0][0] as any).operationId;
    const second = (recover.mock.calls[1][0] as any).operationId;
    expect(second).toBe(first);
  });

  it("a new deliberate attempt after a definitive result gets a new operationId", async () => {
    recover.mockResolvedValue({ kind: "none", message: "no evidence" });
    renderWorksheet();
    await pressRecover();
    await pressRecover();
    expect(recover).toHaveBeenCalledTimes(2);
    const first = (recover.mock.calls[0][0] as any).operationId;
    const second = (recover.mock.calls[1][0] as any).operationId;
    expect(second).not.toBe(first);
  });

  it("the recovery mutation never retries automatically", async () => {
    recover.mockRejectedValue(new Error("network dropped"));
    renderWorksheet();
    await pressRecover();
    // Give any (wrongly configured) retry a chance to fire.
    await new Promise((r) => setTimeout(r, 100));
    expect(recover).toHaveBeenCalledTimes(1);
    // The attempt id survives the failure for a deliberate retry.
    await pressRecover();
    expect(recover).toHaveBeenCalledTimes(2);
    expect((recover.mock.calls[1][0] as any).operationId).toBe(
      (recover.mock.calls[0][0] as any).operationId,
    );
  });

  it("report fetch and refetch never invoke row recovery", async () => {
    recover.mockResolvedValue({ kind: "none", message: "no evidence" });
    renderWorksheet();
    await screen.findByRole("button", { name: /Recover row and block matches/i });
    expect(fetchReport).toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
  });
});
