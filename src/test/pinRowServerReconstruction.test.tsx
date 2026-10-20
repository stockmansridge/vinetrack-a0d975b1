import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PinRowRecoveryPage from "@/pages/admin/PinRowRecoveryPage";
import { PinRowServerReconstruction } from "@/components/admin/PinRowServerReconstruction";
import { fetchServerReconstruction, reconstructionCsv, supportedCandidate, type ServerReconstructionReport } from "@/lib/pinRowReconstruction";
import { buildBatch, createApproval, dryRun } from "@/lib/pinRowBackfill";
import { assessPin, RECOVERY_VINEYARD_ID } from "@/lib/pinRowRecovery";
import { buildDecision, requiredWarnings } from "@/lib/pinRowReviewDraft";

const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: api }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner", email: "owner@example.invalid" } }) }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ memberships: [{ vineyard_id: "fe952afe-437f-4be7-8cbf-fdd8e630411c" }] }) }));
vi.mock("@/pages/admin/_shared", () => ({ AdminGate: ({ children }: any) => children }));

// Synthetic fixtures only: never query the live backend or use fixture counts as live evidence.
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const blockId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const M = 1 / (111320 * Math.cos((-34 * Math.PI) / 180));
const paddock = { id: blockId, name: "Blackberries", rows: [1, 2, 3, 4, 5].map((number) => ({ number,
  startPoint: { latitude: -34, longitude: 150 + (number - 1) * 2.8 * M }, endPoint: { latitude: -33.999, longitude: 150 + (number - 1) * 2.8 * M } })),
  polygon_points: [{ latitude: -34.0001, longitude: 150 - M }, { latitude: -34.0001, longitude: 150 + 12 * M }, { latitude: -33.9989, longitude: 150 + 12 * M }, { latitude: -33.9989, longitude: 150 - M }] };
const pin = { id, title: "Blackberries observation", vineyard_id: RECOVERY_VINEYARD_ID, latitude: -33.9995,
  longitude: 150 + 7 * M, paddock_id: blockId, sync_version: 3, updated_at: "2026-10-14T00:00:00Z", pin_side: "Right" };
const row = assessPin(pin, { paddocks: [paddock], evidence: new Map(), segments: new Map(), trips: "not_loaded" });
const candidate = { pin_id: id, tier: "technically_supported", holds: [], proposed_block_id: blockId,
  gps: { raw_latitude: pin.latitude, raw_longitude: pin.longitude, horizontal_accuracy_m: 2 },
  travel: { ok: true, course_deg: 180, source: "trip_track" }, side: { value: "right" as const, sources: { "pins.pin_side": "right" } },
  geometry: { geometry_source: "capture_time_history", history_id: "history-fixture", geometry_identity: "same", current_geometry_identity: "same" },
  suggestion: { vine_row: 4, driving_aisle: 3.5 }, sync_version: 3, updated_at: pin.updated_at };
const report = (): ServerReconstructionReport => ({ algorithm_version: "pbf-recon-v2", generated_at: "2026-10-20T01:22:00Z", read_only: true,
  validation: { passed: true, comparison_count: 10, held_out_count: 10, mismatches: 0 }, pins: [candidate], supported_batch: [candidate], missing_total: 1 });
beforeEach(() => {
  localStorage.clear(); api.rpc.mockReset(); api.from.mockReset();
  api.from.mockImplementation((table: string) => {
    const data = table === "pins" ? [pin] : table === "paddocks" ? [paddock] : [];
    const q: any = { select: () => q, eq: () => q, is: () => q, order: () => q,
      range: async () => ({ data, error: null }), in: async () => ({ data, error: null }) };
    return q;
  });
});
afterEach(() => { cleanup(); localStorage.clear(); });
const mountPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PinRowRecoveryPage /></QueryClientProvider>);
describe("signed-in Portal server reconstruction", () => {
  it("loads live-client RPC only on explicit action; selected exact server row reaches guarded dry-run, never auto-approval", async () => {
    api.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "pin_row_reconstruction_report" ? report() : { ok: 1, blocked: 0, items: [{ pin_id: id, ok: true, outcome: "assigned_snapped" }] } }));
    mountPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Run server reconstruction" })).toBeEnabled());
    expect(api.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run server reconstruction" }));
    await screen.findByRole("checkbox", { name: `Select ${id}` });
    expect(api.rpc).toHaveBeenCalledWith("pin_row_reconstruction_report", { p_vineyard: RECOVERY_VINEYARD_ID });
    expect(screen.getByRole("button", { name: "1. Server dry-run (no writes)" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: `Select ${id}` }));
    fireEvent.click(screen.getByRole("button", { name: /Approve selected exact rows/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "1. Server dry-run (no writes)" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "1. Server dry-run (no writes)" }));
    await waitFor(() => expect(api.rpc).toHaveBeenCalledWith("pin_row_backfill_dry_run", { p_vineyard: RECOVERY_VINEYARD_ID,
      p_items: [expect.objectContaining({ pin_id: id, paddock_id: blockId, pin_row_number: 4, driving_row_number: 3.5, source: "reviewed_track", expected_sync_version: "3" })] }));
    expect(api.rpc.mock.calls.map(([name]) => name)).toEqual(["pin_row_reconstruction_report", "pin_row_backfill_dry_run"]);
  });
  it("shows permission rejection rather than falsely claiming functions are not installed", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not authorised" } });
    mountPage(); fireEvent.click(screen.getByRole("button", { name: "Run server reconstruction" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied by VineTrack: not authorised");
    expect(document.body.textContent).not.toContain("functions are not installed");
    expect(screen.queryByRole("checkbox", { name: `Select ${id}` })).toBeNull();
  });
  it("empty supported batch exposes actual historical/validation holds without inferred rows", () => {
    const held = { ...candidate, tier: "needs_review", holds: ["capture-time geometry missing; current map cannot replace it", "known-row validation failed or insufficient"], suggestion: { vine_row: null, driving_aisle: 3.5 } };
    const r = { ...report(), validation: { passed: false, mismatches: 19 }, pins: [held], supported_batch: [] };
    render(<PinRowServerReconstruction report={r} error={null} busy={false} disabled={false} rows={[row]} paddocks={[paddock]} onRun={vi.fn()} onApprove={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("capture-time geometry missing");
    expect(screen.getByRole("checkbox", { name: `Select ${id}` })).toBeDisabled();
    expect(supportedCandidate(r, id)).toBeNull();
  });
  it("preserves fractional physical rows in export and locks protected partial metadata", () => {
    const fractional = { ...report(), pins: [{ ...candidate, suggestion: { vine_row: 4.25, driving_aisle: 3.5 } }] };
    expect(reconstructionCsv(fractional)).toContain("4.25"); expect(supportedCandidate(fractional, id)).toBeNull();
    const protectedRow = assessPin({ ...pin, driving_row_number: 3.5 }, { paddocks: [paddock], evidence: new Map(), segments: new Map(), trips: "not_loaded" });
    const d = buildDecision(row, { decision: "approve_for_writeback", block_id: blockId, vine_row: 4, driving_aisle: 3.5, side: "right", source: "reviewed_track", reason: "owner selected", acknowledged_warnings: requiredWarnings(row) }, "owner", "owner", [paddock], []);
    expect(buildBatch([protectedRow], { [id]: d }, report()).entries).toHaveLength(0);
  });
  it("never accepts synthetic-marked or unauthenticated results as live", async () => {
    api.rpc.mockResolvedValue({ data: { ...report(), synthetic: true }, error: null });
    await expect(fetchServerReconstruction(api, "owner")).rejects.toThrow("Unrecognised");
    api.rpc.mockClear(); await expect(fetchServerReconstruction(api, null)).rejects.toThrow("Sign in"); expect(api.rpc).not.toHaveBeenCalled();
  });
  it("does not create approvals or send dry-runs with no owner-approved items", async () => {
    expect(buildBatch([row], {}, report()).entries).toHaveLength(0);
    await dryRun(api, []); await createApproval(api, []); expect(api.rpc).not.toHaveBeenCalled();
  });
  it("selection invalidates when the server report is refreshed", () => {
    const approve = vi.fn(); const props = { error: null, busy: false, disabled: false, rows: [row], paddocks: [paddock], onRun: vi.fn(), onApprove: approve };
    const r = render(<PinRowServerReconstruction {...props} report={report()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: `Select ${id}` }));
    r.rerender(<PinRowServerReconstruction {...props} report={report()} />);
    expect(screen.getByRole("checkbox", { name: `Select ${id}` })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Approve selected exact rows/ })).toBeDisabled(); expect(approve).not.toHaveBeenCalled();
  });
});