import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  iosSupabase: { rpc: (...a: any[]) => rpcMock(...a), from: (...a: any[]) => fromMock(...a) },
}));

import { SYSTEM_ADMIN_GROUPS } from "@/lib/navigationConfig";
import { canForceStop, detectTripIssues, type AdminTripRow } from "@/lib/adminTrips";
import { ForceStopDialog } from "@/pages/admin/AdminTripsPage";

const regression: AdminTripRow = {
  id: "trip-1",
  vineyard_id: "v1",
  vineyard_name: "Estellar",
  operator_user_id: null,
  operator_name: "Op",
  operator_email: null,
  trip_title: "Spray",
  trip_function: "spraying",
  tracking_pattern: "freeDrive",
  start_time: "2026-09-23T00:00:00Z",
  end_time: null,
  is_active: true,
  is_paused: false,
  total_distance: 1000,
  total_tanks: 2,
  active_tank_number: 1,
  is_filling_tank: false,
  filling_tank_number: null,
  block_ids: Array.from({ length: 14 }, (_, i) => `b${i}`),
  tank_sessions: [
    { tankNumber: 1, startTime: "2026-09-23T00:10:00Z", endTime: "2026-09-23T01:10:00Z", fillStartTime: null, fillEndTime: null },
  ],
  sync_version: 4,
  client_updated_at: null,
  created_at: null,
  updated_at: null,
  spray_record_id: "sr1",
  spray_record_end_time: null,
  spray_record_start_time: null,
  spray_application_block_ids: Array.from({ length: 9 }, (_, i) => `b${i}`),
};

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe("Admin Trips — navigation & contract", () => {
  it("is under System Admin → Operations and System Admin protected", () => {
    const ops = SYSTEM_ADMIN_GROUPS.find((g) => g.label === "Operations")!;
    expect(ops.items.map((i) => i.path)).toContain("/admin/trips");
    const app = readFileSync("src/App.tsx", "utf8");
    const guard = app.indexOf("<Route element={<RequireSystemAdmin />}>");
    const route = app.indexOf('path="/admin/trips"');
    expect(guard).toBeGreaterThan(-1);
    expect(route).toBeGreaterThan(guard);
  });

  it("global list uses the admin RPC, not a direct trips query", () => {
    const src = readFileSync("src/lib/adminTrips.ts", "utf8") + readFileSync("src/lib/adminApi.ts", "utf8");
    expect(src).toContain('"admin_list_trips"');
    expect(src).not.toMatch(/from\("trips"\)/);
  });

  it("SQL enforces admin check, locking, reason and generic reopen protection", () => {
    const sql = readFileSync("sql/250_admin_trip_support_recovery.sql", "utf8");
    expect(sql.match(/IF NOT public\.is_system_admin\(\)/g)?.length).toBe(3);
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("A support reason is required");
    expect(sql).toContain("'already_completed'");
    expect(sql).toMatch(/IF OLD\.end_time IS NOT NULL THEN[\s\S]*NEW\.is_active\s*:= false/);
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(sql).not.toMatch(/SET[^;]*(path_points|tank_sessions|total_distance)\s*=/);
  });
});

describe("Admin Trips — diagnostics", () => {
  it("flags the customer regression: stale active tank + block scope difference", () => {
    const issues = detectTripIssues(regression);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("stale_active_tank");
    expect(codes).toContain("block_scope_difference");
    expect(issues.find((i) => i.code === "block_scope_difference")!.severity).toBe("info");
    expect(codes).not.toContain("fill_state_mismatch");
  });

  it("does not flag a genuinely open tank session", () => {
    const t = { ...regression, tank_sessions: [{ ...regression.tank_sessions![0], endTime: null }] };
    expect(detectTripIssues(t).map((i) => i.code)).not.toContain("stale_active_tank");
  });

  it("Force Stop unavailable for a cleanly completed Trip", () => {
    expect(canForceStop({ ...regression, is_active: false, end_time: "x", active_tank_number: null })).toBe(false);
    expect(canForceStop(regression)).toBe(true);
  });
});

describe("Admin Trips — Force Stop dialog", () => {
  const open = () => wrap(<ForceStopDialog open onOpenChange={() => {}} trip={regression} detail={null} />);

  it("requires a reason and makes no RPC call without one", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Force Stop" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/reason is required/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("cancel makes no change", () => {
    const onOpenChange = vi.fn();
    wrap(<ForceStopDialog open onOpenChange={onOpenChange} trip={regression} detail={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("RPC error leaves state unchanged and shows the error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Not authorised" } });
    open();
    fireEvent.change(screen.getByLabelText(/support reason/i), { target: { value: "stuck" } });
    fireEvent.click(screen.getByRole("button", { name: "Force Stop" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByTestId("force-stop-result")).toBeNull();
  });

  it("success calls the recovery RPC once and shows the resulting completion", async () => {
    rpcMock.mockResolvedValue({
      data: { status: "stopped", trip_id: "trip-1", end_time: "2026-09-23T01:10:00Z", spray_record_closed: true },
      error: null,
    });
    open();
    fireEvent.change(screen.getByLabelText(/support reason/i), { target: { value: "stuck tank 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Force Stop" }));
    await waitFor(() => expect(screen.getByTestId("force-stop-result")).toBeTruthy());
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, args] = rpcMock.mock.calls[0];
    expect(name).toBe("admin_force_stop_trip");
    expect(args).toMatchObject({ p_trip_id: "trip-1", p_reason: "stuck tank 1" });
    // Suggested time is last operational activity (Tank 1 end), not now.
    expect(new Date(args.p_end_time).getTime()).toBe(new Date("2026-09-23T01:10:00Z").setSeconds(0, 0));
  });

  it("repeated Force Stop reports already completed safely", async () => {
    rpcMock.mockResolvedValue({ data: { status: "already_completed", trip_id: "trip-1", end_time: "2026-09-23T01:10:00Z" }, error: null });
    open();
    fireEvent.change(screen.getByLabelText(/support reason/i), { target: { value: "again" } });
    fireEvent.click(screen.getByRole("button", { name: "Force Stop" }));
    expect(await screen.findByText(/already completed/i)).toBeTruthy();
  });
});
