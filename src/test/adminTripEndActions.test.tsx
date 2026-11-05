import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  iosSupabase: { rpc: (...a: any[]) => rpcMock(...a), from: vi.fn() },
}));

import { canEndTripAfterTanks, endTankState, type AdminTripRow } from "@/lib/adminTrips";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TripDetail, EndLifecycleDialog } from "@/pages/admin/AdminTripsPage";

const t1 = { id: "s1", tankNumber: 1, startTime: "2026-09-23T00:10:00Z", endTime: "2026-09-23T01:10:00Z", fillStartTime: null, fillEndTime: null };
const t2 = { id: "s2", tankNumber: 2, startTime: "2026-09-23T01:30:00Z", endTime: null, fillStartTime: null, fillEndTime: null };
const trip: AdminTripRow = {
  id: "trip-1", vineyard_id: "v1", vineyard_name: "Estellar", operator_user_id: null, operator_name: null,
  operator_email: null, trip_title: "Spray", trip_function: "spraying", tracking_pattern: "freeDrive",
  start_time: "2026-09-23T00:00:00Z", end_time: null, is_active: true, is_paused: false, total_distance: 1,
  total_tanks: 2, active_tank_number: 2, is_filling_tank: false, filling_tank_number: null, block_ids: [],
  tank_sessions: [t1, t2], sync_version: 4, client_updated_at: null, created_at: null, updated_at: null,
  spray_record_id: null, spray_record_end_time: null, spray_record_start_time: null, spray_application_block_ids: null,
};
const t2Ended = { ...trip, active_tank_number: null, tank_sessions: [t1, { ...t2, endTime: "2026-09-23T02:00:00Z" }] };
const completed = { ...t2Ended, is_active: false, end_time: "2026-09-23T02:10:00Z" };
const notStarted = { ...trip, is_active: false, active_tank_number: null, tank_sessions: [] };
const filling = { ...trip, is_filling_tank: true, filling_tank_number: 2 };

const detailFor = (t: AdminTripRow) => ({
  trip: t, vineyard: { id: "v1", name: "Estellar" }, operator: null, tractor: null, blocks: [],
  spray_record: null, application_blocks: [], tank_actuals: [], audit: [],
});
const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const renderDetail = async (t: AdminTripRow) => {
  rpcMock.mockImplementation((name: string) => Promise.resolve({ data: name === "admin_get_trip" ? detailFor(t) : [], error: null }));
  wrap(<Sheet open><SheetContent><TripDetail tripId={t.id} row={t} /></SheetContent></Sheet>);
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("admin_get_trip", { p_trip_id: t.id }));
};

beforeEach(() => rpcMock.mockReset());

describe("End Tank / End Trip visibility", () => {
  it("Tank 1 ended, Tank 2 open: End Tank only on Tank 2, no End Trip, no Force Stop", async () => {
    expect(endTankState(trip, t1)).toBe("hidden");
    expect(endTankState(trip, t2)).toBe("available");
    expect(canEndTripAfterTanks(trip)).toBe(false);
    await renderDetail(trip);
    expect(screen.getAllByRole("button", { name: "End Tank" })).toHaveLength(1);
    expect(screen.getByTestId("tank-session-1").textContent).toContain("End Tank");
    expect(screen.getByTestId("tank-session-0").textContent).not.toContain("End Tank");
    expect(screen.queryByRole("button", { name: "End Trip" })).toBeNull();
    expect(screen.queryByText(/Force Stop/)).toBeNull();
  });
  it("after Tank 2 ended: End Trip shown, no End Tank", async () => {
    expect(canEndTripAfterTanks(t2Ended)).toBe(true);
    await renderDetail(t2Ended);
    expect(screen.queryByRole("button", { name: "End Tank" })).toBeNull();
    expect(screen.getByRole("button", { name: "End Trip" })).toBeTruthy();
  });
  it("completed Trip: neither action", async () => {
    expect(canEndTripAfterTanks(completed)).toBe(false);
    await renderDetail(completed);
    expect(screen.queryByRole("button", { name: /End (Tank|Trip)/ })).toBeNull();
  });
  it("not-started Trip: neither action", async () => {
    expect(canEndTripAfterTanks(notStarted)).toBe(false);
    await renderDetail(notStarted);
    expect(screen.queryByRole("button", { name: /End (Tank|Trip)/ })).toBeNull();
  });
  it("running fill: End Tank disabled with explanation, End Trip hidden", async () => {
    expect(endTankState(filling, t2)).toBe("blocked_fill");
    expect(canEndTripAfterTanks({ ...t2Ended, is_filling_tank: true })).toBe(false);
    await renderDetail(filling);
    expect((screen.getByRole("button", { name: "End Tank" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/fill must be stopped/)).toBeTruthy();
  });
  it("fill-only session never gets End Tank", () => {
    expect(endTankState(trip, { ...t2, startTime: null, fillStartTime: "x" })).toBe("hidden");
  });
  it("active spraying Trip with planned tanks but zero tank_sessions: never End Trip", async () => {
    const noSessions = { ...trip, trip_function: "spraying", total_tanks: 1, active_tank_number: null, tank_sessions: [] };
    expect(canEndTripAfterTanks(noSessions)).toBe(false);
    await renderDetail(noSessions);
    expect(screen.queryByRole("button", { name: "End Trip" })).toBeNull();
  });
  it("active spraying Trip with only an open tank session: never End Trip", async () => {
    const onlyOpen = { ...trip, trip_function: "spraying", total_tanks: 1, active_tank_number: 1, tank_sessions: [t2] };
    expect(canEndTripAfterTanks(onlyOpen)).toBe(false);
    await renderDetail(onlyOpen);
    expect(screen.queryByRole("button", { name: "End Trip" })).toBeNull();
  });
});

describe("End Tank dialog", () => {
  it("requires reason, calls only the RPC with UTC time, and shows server error without success", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Tank session is not open" } });
    wrap(<EndLifecycleDialog kind="tank" trip={trip} session={t2} vineyardName="Estellar" onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm End Tank 2" }));
    expect(rpcMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Actual end date and time"), { target: { value: "2026-09-23T12:30" } });
    fireEvent.change(screen.getByLabelText("Support reason (required)"), { target: { value: "Operator confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm End Tank 2" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Tank session is not open"));
    expect(rpcMock).toHaveBeenCalledWith("admin_end_trip_tank", {
      p_trip_id: "trip-1", p_tank_session_id: "s2", p_reason: "Operator confirmed",
      p_end_time: new Date("2026-09-23T12:30").toISOString(),
    });
    expect(screen.queryByTestId("lifecycle-result")).toBeNull();
  });
  it("End Trip success shows returned status and audit", async () => {
    rpcMock.mockResolvedValue({ data: { status: "ended", audit_event_id: "aud-9" }, error: null });
    wrap(<EndLifecycleDialog kind="trip" trip={t2Ended} vineyardName="Estellar" onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Support reason (required)"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm End Trip" }));
    await waitFor(() => expect(screen.getByTestId("lifecycle-result").textContent).toContain("aud-9"));
    expect(rpcMock.mock.calls[0][0]).toBe("admin_end_trip_after_tanks");
  });
});
