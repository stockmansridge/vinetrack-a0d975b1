import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ManageTrip from "@/components/trips/ManageTrip";
import { fetchTripManagementSnapshot, mayDeleteConfirmedTrip, tripServerStatus, type TripManagementSnapshot } from "@/lib/tripManagement";
import { completeTrip, softDeleteTrip } from "@/lib/tripsQuery";

const state = vi.hoisted(() => ({ trip: null as any, member: null as any, access: null as any, error: null as any, filters: [] as unknown[][], patch: null as any, result: [{ id: "t" }] as any[], hold: null as Promise<any> | null }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const api: any = {
      select: () => state.patch ? Promise.resolve({ data: state.result, error: state.error }) : api,
      eq: (key: string, value: unknown) => { state.filters.push([key, value]); return api; },
      is: (key: string, value: unknown) => { state.filters.push([key, value]); return api; },
      not: (key: string, op: string, value: unknown) => { state.filters.push([key, op, value]); return api; },
      update: (patch: unknown) => { state.patch = patch; return api; },
      single: () => state.hold ?? Promise.resolve({ data: table === "trips" ? state.trip : state.member, error: state.error }),
    }; return api;
  },
  rpc: () => Promise.resolve({ data: state.access, error: state.error }),
} }));
const snapshot = (): TripManagementSnapshot => ({ trip: state.trip, role: state.member.role, canWrite: true });
beforeEach(() => {
  cleanup();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  state.trip = { id: "t", vineyard_id: "v", is_active: false, is_paused: false, end_time: "2026-09-24T10:00:00Z", sync_version: 4, deleted_at: null, is_filling_tank: false };
  state.member = { vineyard_id: "v", user_id: "u", role: "owner" };
  state.access = { vineyard_id: "v", membership_role: "owner", can_enter_vineyard: true, can_write: true };
  state.error = null; state.patch = null; state.filters = []; state.result = [{ id: "t" }]; state.hold = null;
});
function mount(overrides = {}, qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  const onDelete = vi.fn();
  const props = { vineyardId: "v", tripId: "t", userId: "u", open: true, allowActions: true, busy: false, onDelete, ...overrides };
  return { ...render(<QueryClientProvider client={qc}><ManageTrip {...props} /></QueryClientProvider>), onDelete, qc, props };
}
describe("Trip server lifecycle rules", () => {
  it("requires explicit inactive flags and a valid finish", () => {
    expect(tripServerStatus(state.trip)).toBe("completed");
    expect(tripServerStatus({ ...state.trip, end_time: null })).toBe("inconsistent");
    expect(tripServerStatus({ ...state.trip, is_active: true })).toBe("inconsistent");
    expect(tripServerStatus({ ...state.trip, is_active: undefined })).toBe("inconsistent");
    expect(tripServerStatus({ ...state.trip, end_time: "bad" })).toBe("inconsistent");
    expect(tripServerStatus({ ...state.trip, deleted_at: "2026-11-01" })).toBe("removed");
  });
  it("preserves existing member delete roles but never infers admin membership", () => {
    for (const role of ["owner", "manager", "supervisor"]) expect(mayDeleteConfirmedTrip({ ...snapshot(), role })).toBe(true);
    for (const role of ["operator", "admin", ""]) expect(mayDeleteConfirmedTrip({ ...snapshot(), role })).toBe(false);
  });
  it("refuses read-only, active, paused, filling or unknown-version deletion", () => {
    expect(mayDeleteConfirmedTrip({ ...snapshot(), canWrite: false })).toBe(false);
    for (const patch of [{ is_active: true, end_time: null }, { is_paused: true, end_time: null }, { is_filling_tank: true }, { is_filling_tank: null }, { sync_version: null }]) {
      expect(mayDeleteConfirmedTrip({ ...snapshot(), trip: { ...state.trip, ...patch } })).toBe(false);
    }
  });
  it("uses exact scoped status, membership and existing access RPC", async () => {
    expect(await fetchTripManagementSnapshot("v", "t", "u")).toEqual(snapshot());
    expect(state.filters).toContainEqual(["vineyard_id", "v"]);
    expect(state.filters).toContainEqual(["id", "t"]);
    expect(state.filters).toContainEqual(["user_id", "u"]);
  });
  it("rejects cross-vineyard or mismatched actual membership/access", async () => {
    state.trip.vineyard_id = "other";
    await expect(fetchTripManagementSnapshot("v", "t", "u")).rejects.toThrow(/confirmed/);
    state.trip.vineyard_id = "v"; state.access.membership_role = "manager";
    await expect(fetchTripManagementSnapshot("v", "t", "u")).rejects.toThrow(/confirmed/);
  });
  it("fails closed on status/permission read errors", async () => {
    state.error = { message: "denied" };
    await expect(fetchTripManagementSnapshot("v", "t", "u")).rejects.toThrow(/verify/);
  });
  it("never performs the legacy raw completion update", async () => {
    await expect(completeTrip({ tripId: "t" })).rejects.toThrow(/unavailable/);
    expect(state.patch).toBeNull();
  });
  it("keeps recoverable delete version/scoped/inactive checked and operational fields untouched", async () => {
    await softDeleteTrip({ tripId: "t", vineyardId: "v", userId: "u", currentSyncVersion: 4 });
    for (const filter of [["vineyard_id", "v"], ["sync_version", 4], ["is_active", false], ["is_paused", false], ["is_filling_tank", false], ["end_time", "is", null]]) expect(state.filters).toContainEqual(filter);
    expect(Object.keys(state.patch).sort()).toEqual(["client_updated_at", "deleted_at", "sync_version", "updated_by"]);
    expect(state.patch.sync_version).toBe(5);
  });
  it("reports no affected row as a conflict, not successful deletion", async () => {
    state.result = [];
    await expect(softDeleteTrip({ tripId: "t", vineyardId: "v", userId: "u", currentSyncVersion: 4 })).rejects.toThrow(/changed/);
  });
  it("rejects deletion without a confirmed scope/version", async () => {
    await expect(softDeleteTrip({ tripId: "t" })).rejects.toThrow(/Refresh/);
    expect(state.patch).toBeNull();
  });
});
describe("Manage Trip safety UI", () => {
  it("keeps historical active ending and deletion disabled", async () => {
    state.trip.is_active = true; state.trip.end_time = null;
    const { onDelete } = mount();
    await screen.findByText("Server status: active");
    expect(screen.getByRole("button", { name: "End stale Trip" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Trip" })).toBeDisabled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(state.patch).toBeNull();
  });
  it("allows only confirmed inactive delete and honours update-busy state", async () => {
    const { onDelete, rerender, qc, props } = mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete Trip" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Delete Trip" }));
    expect(onDelete).toHaveBeenCalledWith(snapshot());
    rerender(<QueryClientProvider client={qc}><ManageTrip {...props} busy /></QueryClientProvider>);
    expect(screen.getByRole("button", { name: "Delete Trip" })).toBeDisabled();
  });
  it("never exposes deletion to an operator or linked Spray Records entrypoint", async () => {
    state.member.role = "operator"; state.access.membership_role = "operator";
    const view = mount(); await screen.findByText("Server status: completed");
    expect(screen.queryByRole("button", { name: "Delete Trip" })).not.toBeInTheDocument();
    view.unmount(); state.member.role = "owner"; state.access.membership_role = "owner";
    mount({ allowActions: false }); await screen.findByText("Server status: completed");
    expect(screen.queryByRole("button", { name: "Delete Trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End stale Trip" })).not.toBeInTheDocument();
  });
  it("hides cached status and deletion after failed refetch", async () => {
    mount(); await screen.findByText("Server status: completed");
    state.error = { message: "network" }; fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await screen.findByText("Status unavailable — refresh to retry");
    expect(screen.queryByText("Server status: completed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Trip" })).not.toBeInTheDocument();
  });
  it("blocks offline cached state and rechecks on reconnect", async () => {
    mount(); await screen.findByText("Server status: completed");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    act(() => window.dispatchEvent(new Event("offline")));
    expect(screen.getByText("Offline — current server status unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Trip" })).not.toBeInTheDocument();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    state.trip = { ...state.trip, is_active: true, end_time: null };
    act(() => window.dispatchEvent(new Event("online")));
    await screen.findByText("Server status: active");
    expect(screen.getByRole("button", { name: "Delete Trip" })).toBeDisabled();
  });
  it("does not flash the previous Trip's confirmed data on quick switch", async () => {
    const { rerender, props, qc } = mount(); await screen.findByText("Server status: completed");
    state.hold = new Promise(() => {});
    rerender(<QueryClientProvider client={qc}><ManageTrip {...props} tripId="next" /></QueryClientProvider>);
    expect(screen.queryByText("Server status: completed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Trip" })).not.toBeInTheDocument();
  });
  it("reopen refreshes and does not claim approval of cached inactive state", async () => {
    const { rerender, props, qc } = mount(); await screen.findByText("Server status: completed");
    rerender(<QueryClientProvider client={qc}><ManageTrip {...props} open={false} /></QueryClientProvider>);
    state.error = { message: "offline server" };
    rerender(<QueryClientProvider client={qc}><ManageTrip {...props} /></QueryClientProvider>);
    await screen.findByText("Status unavailable — refresh to retry");
    expect(screen.queryByRole("button", { name: "Delete Trip" })).not.toBeInTheDocument();
  });
});