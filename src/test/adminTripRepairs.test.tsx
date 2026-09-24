import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  iosSupabase: { rpc: (...a: any[]) => rpcMock(...a), from: vi.fn() },
}));

import { detectTripIssues, tripActions, type AdminTripRow } from "@/lib/adminTrips";
import { RepairDialog, repairCopy } from "@/pages/admin/AdminTripsPage";

const base: AdminTripRow = {
  id: "trip-1", vineyard_id: "v1", vineyard_name: "Estellar", operator_user_id: null, operator_name: null,
  operator_email: null, trip_title: "Spray", trip_function: "spraying", tracking_pattern: "freeDrive",
  start_time: "2026-09-23T00:00:00Z", end_time: null, is_active: true, is_paused: false, total_distance: 1,
  total_tanks: 2, active_tank_number: 1, is_filling_tank: false, filling_tank_number: null,
  block_ids: Array.from({ length: 14 }, (_, i) => `b${i}`),
  tank_sessions: [{ tankNumber: 1, startTime: "2026-09-23T00:10:00Z", endTime: "2026-09-23T01:10:00Z", fillStartTime: null, fillEndTime: null }],
  sync_version: 4, client_updated_at: null, created_at: null, updated_at: null,
  spray_record_id: "sr1", spray_record_end_time: null, spray_record_start_time: null,
  spray_application_block_ids: Array.from({ length: 9 }, (_, i) => `b${i}`),
};
const sql = readFileSync("sql/251_admin_trip_surgical_repairs.sql", "utf8");
const fnBody = (name: string) => sql.slice(sql.indexOf(`FUNCTION public.${name}(`), sql.indexOf("$$;", sql.indexOf(`FUNCTION public.${name}(`)));

const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => rpcMock.mockReset());

describe("Trip repair actions (UI rules)", () => {
  it("stale ended Tank 1 → Repair Tank State (preferred) + Force Stop + Compare Blocks", () => {
    expect(tripActions(base)).toEqual(["repair_tank", "compare_blocks", "force_stop"]);
  });
  it("genuinely open Tank 1 gets no repair option", () => {
    const t = { ...base, tank_sessions: [{ ...base.tank_sessions![0], endTime: null }] };
    expect(tripActions(t)).not.toContain("repair_tank");
  });
  it("false fill state → Repair Fill State; genuine open fill does not", () => {
    const t = { ...base, active_tank_number: null, is_filling_tank: true, filling_tank_number: 2 };
    expect(tripActions(t)).toContain("repair_fill");
    const open = { ...t, tank_sessions: [...t.tank_sessions!, { tankNumber: 2, startTime: null, endTime: null, fillStartTime: "2026-09-23T01:20:00Z", fillEndTime: null }] };
    expect(tripActions(open)).not.toContain("repair_fill");
  });
  it("completed-but-active → Repair Completion State, never Force Stop", () => {
    const t = { ...base, end_time: "2026-09-23T02:00:00Z", spray_record_end_time: "x" };
    const a = tripActions(t);
    expect(a).toContain("repair_completion");
    expect(a).not.toContain("force_stop");
  });
  it("completed Trip + open Spray Record → Close Spray Record", () => {
    const t = { ...base, end_time: "2026-09-23T02:00:00Z", is_active: false, active_tank_number: null };
    expect(tripActions(t)).toEqual(["close_spray", "compare_blocks"]);
  });
  it("active Trip + closed Spray Record → Review Spray Record, no reopen", () => {
    const t = { ...base, active_tank_number: null, spray_record_end_time: "2026-09-23T02:00:00Z" };
    const a = tripActions(t);
    expect(a).toContain("review_spray");
    expect(a).not.toContain("close_spray");
    expect(sql).not.toMatch(/reopen_spray|end_time\s*=\s*NULL/i);
  });
  it("block scope difference gets Compare Blocks only, stays visible", () => {
    const t = { ...base, active_tank_number: null };
    expect(detectTripIssues(t).map((i) => i.code)).toEqual(["block_scope_difference"]);
    expect(tripActions(t)).toEqual(["compare_blocks", "force_stop"]);
    const page = readFileSync("src/pages/admin/AdminTripsPage.tsx", "utf8");
    expect(page).not.toMatch(/Sync Blocks|Fix Blocks|Replace Spray Record Blocks|Make Matches/);
  });
  it("Force Stop remains for genuinely active and paused Trips", () => {
    const t = { ...base, active_tank_number: null, spray_application_block_ids: null };
    expect(tripActions(t)).toEqual(["force_stop"]);
    expect(tripActions({ ...t, is_paused: true })).toEqual(["force_stop"]);
  });
  it("tank confirmation copy matches the contract", () => {
    expect(repairCopy("repair_tank", base)).toBe(
      "Tank 1's session is already recorded as ended, but the Trip still marks Tank 1 active. This will clear the stale active-tank flag only. Tank records and actual quantities will not change.",
    );
  });
});

describe("Repair dialog", () => {
  it("requires a reason and makes no RPC call without one", async () => {
    wrap(<RepairDialog action="repair_tank" trip={base} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Repair Tank State" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/reason is required/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("tank repair calls reconcile and reports exactly what changed", async () => {
    rpcMock.mockResolvedValue({ data: { status: "repaired", trip_id: "trip-1", repairs: ["tank"], previous_active_tank_number: 1 }, error: null });
    wrap(<RepairDialog action="repair_tank" trip={base} onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText(/support reason/i), { target: { value: "stuck tank" } });
    fireEvent.click(screen.getByRole("button", { name: "Repair Tank State" }));
    await waitFor(() => expect(screen.getByTestId("repair-result")).toHaveTextContent(
      "Tank state repaired — stale active Tank 1 flag cleared. Tank Session and actual mix were unchanged."));
    expect(rpcMock).toHaveBeenCalledWith("admin_reconcile_trip_runtime", { p_trip_id: "trip-1", p_reason: "stuck tank" });
  });
  it("close spray calls the close RPC", async () => {
    rpcMock.mockResolvedValue({ data: { status: "closed", trip_id: "trip-1" }, error: null });
    wrap(<RepairDialog action="close_spray" trip={{ ...base, end_time: "2026-09-23T02:00:00Z" }} onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText(/support reason/i), { target: { value: "orphan" } });
    fireEvent.click(screen.getByRole("button", { name: "Close Spray Record" }));
    await waitFor(() => expect(screen.getByTestId("repair-result")).toBeTruthy());
    expect(rpcMock.mock.calls[0][0]).toBe("admin_close_spray_record_from_trip");
  });
  it("server refusal is shown and nothing is reported as changed", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Tank 1 has a genuinely open Tank Session." } });
    wrap(<RepairDialog action="repair_tank" trip={base} onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText(/support reason/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Repair Tank State" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/genuinely open/);
    expect(screen.queryByTestId("repair-result")).toBeNull();
  });
});

describe("SQL 251 server contract", () => {
  const rec = fnBody("admin_reconcile_trip_runtime");
  const close = fnBody("admin_close_spray_record_from_trip");
  it("every mutation requires System Admin, a reason, a row lock and an audit entry", () => {
    for (const body of [rec, close]) {
      expect(body).toContain("IF NOT public.is_system_admin()");
      expect(body).toContain("A support reason is required");
      expect(body).toContain("FOR UPDATE");
      expect(body).toMatch(/INSERT INTO public\.audit_events/);
    }
    expect(rec).toContain("'admin_reconcile_trip_runtime'");
    expect(close).toContain("'admin_close_spray_record_from_trip'");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.admin_reconcile_trip_runtime\(uuid, text\) FROM public, anon/);
  });
  it("tank repair never ends the Trip or touches sessions/actuals/route/blocks/spray", () => {
    const update = rec.slice(rec.indexOf("UPDATE public.trips"), rec.indexOf("RETURNING * INTO t_new"));
    expect(update).not.toMatch(/end_time|tank_sessions|path_points|paddock_ids|total_distance|completed_paths/);
    expect(rec).not.toMatch(/spray_records|spray_tank_actuals/);
    expect(update).toMatch(/is_active\s*= CASE WHEN v_completion/);
  });
  it("genuine open tank is refused and repeated reconciliation is idempotent", () => {
    expect(rec).toContain("genuinely open Tank Session");
    expect(rec).toContain("'nothing_to_repair'");
    expect(close).toContain("'already_closed'");
  });
  it("close spray uses the Trip's existing end_time and leaves the Trip alone", () => {
    expect(close).toContain("USING t.end_time, v_sr_id");
    expect(close).not.toMatch(/UPDATE public\.trips/);
    expect(close).not.toMatch(/tanks\s*=|application_blocks|temperature|wind/);
  });
  it("SQL 250 is untouched by this change", () => {
    expect(readFileSync("sql/250_admin_trip_support_recovery.sql", "utf8")).not.toContain("admin_reconcile_trip_runtime");
  });
});
