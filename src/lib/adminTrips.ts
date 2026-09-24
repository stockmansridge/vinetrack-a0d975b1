// System Admin Trip support: RPC hooks + pure diagnostics.
// All reads/writes go through SQL 250 admin RPCs (global, not membership-scoped).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";

export interface TankSessionSummary {
  tankNumber: number | null;
  startTime: unknown;
  endTime: unknown;
  fillStartTime: unknown;
  fillEndTime: unknown;
  id?: string | null;
}

export interface AdminTripRow {
  id: string;
  vineyard_id: string | null;
  vineyard_name: string | null;
  operator_user_id: string | null;
  operator_name: string | null;
  operator_email: string | null;
  trip_title: string | null;
  trip_function: string | null;
  tracking_pattern: string | null;
  start_time: string | null;
  end_time: string | null;
  is_active: boolean | null;
  is_paused: boolean | null;
  total_distance: number | null;
  total_tanks: number | null;
  active_tank_number: number | null;
  is_filling_tank: boolean | null;
  filling_tank_number: number | null;
  block_ids: string[] | null;
  tank_sessions: TankSessionSummary[] | null;
  sync_version: number | null;
  client_updated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  spray_record_id: string | null;
  spray_record_end_time: string | null;
  spray_record_start_time: string | null;
  spray_application_block_ids: string[] | null;
}

export interface AdminTripDetail {
  trip: Record<string, any>;
  vineyard: { id: string; name: string } | null;
  operator: { id: string; full_name: string | null; email: string | null } | null;
  tractor: { id: string; name: string | null } | null;
  blocks: { id: string; name: string | null }[];
  spray_record: Record<string, any> | null;
  application_blocks: { id: string; name: string | null }[];
  tank_actuals: Record<string, any>[];
  audit: Record<string, any>[];
}

export interface ForceStopResult {
  status: "stopped" | "already_completed";
  trip_id: string;
  end_time: string;
  spray_record_closed?: boolean;
  audit_event_id?: string;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (iosSupabase as any).rpc(name, args);
  if (error) throw error;
  return data as T;
}

export const ADMIN_TRIPS_KEY = ["admin", "trips"] as const;
export const adminTripKey = (id: string) => ["admin", "trip", id] as const;

export function useAdminTripsList(filters: { vineyardId?: string | null; from?: string | null; to?: string | null } = {}) {
  return useQuery({
    queryKey: [...ADMIN_TRIPS_KEY, filters.vineyardId ?? null, filters.from ?? null, filters.to ?? null],
    staleTime: 30_000,
    queryFn: () =>
      rpc<AdminTripRow[]>("admin_list_trips", {
        p_vineyard_id: filters.vineyardId ?? null,
        p_from: filters.from ?? null,
        p_to: filters.to ?? null,
        p_limit: 1000,
      }).then((d) => d ?? []),
  });
}

export function useAdminTripDetail(tripId: string | null) {
  return useQuery({
    queryKey: tripId ? adminTripKey(tripId) : ["admin", "trip", "none"],
    enabled: !!tripId,
    queryFn: () => rpc<AdminTripDetail>("admin_get_trip", { p_trip_id: tripId }),
  });
}

export function useForceStopTrip() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (args: { tripId: string; reason: string; endTime: string }) => {
      const reason = args.reason.trim();
      if (!reason) return Promise.reject(new Error("A support reason is required"));
      return rpc<ForceStopResult>("admin_force_stop_trip", {
        p_trip_id: args.tripId,
        p_reason: reason,
        p_end_time: args.endTime,
      });
    },
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: ADMIN_TRIPS_KEY });
      qc.invalidateQueries({ queryKey: adminTripKey(args.tripId) });
    },
  });
}

/* ---------------- pure helpers ---------------- */

const APPLE_EPOCH_OFFSET_S = 978_307_200;

/** Parses ISO strings, epoch ms/s, or Apple reference-date seconds. */
export function parseTripTime(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && isFinite(v)) {
    if (v > 1e12) return new Date(v);
    if (v > 1.5e9) return new Date(v * 1000);
    return new Date((v + APPLE_EPOCH_OFFSET_S) * 1000);
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export type TripStatus = "active" | "paused" | "completed" | "not_started";

export function adminTripStatus(t: Pick<AdminTripRow, "end_time" | "is_active" | "is_paused">): TripStatus {
  if (t.is_active === true) return t.is_paused ? "paused" : "active";
  if (t.end_time) return "completed";
  return "not_started";
}

export type TripIssueCode =
  | "stale_active_tank"
  | "fill_state_mismatch"
  | "completion_mismatch"
  | "spray_lifecycle_mismatch"
  | "block_scope_difference";

export interface TripIssue {
  code: TripIssueCode;
  severity: "warning" | "info";
  label: string;
  detail: string;
}

type IssueInput = Pick<
  AdminTripRow,
  | "end_time"
  | "is_active"
  | "active_tank_number"
  | "is_filling_tank"
  | "filling_tank_number"
  | "tank_sessions"
  | "block_ids"
  | "spray_record_id"
  | "spray_record_end_time"
  | "spray_application_block_ids"
>;

const hasValue = (v: unknown) => v != null && v !== "";

export function detectTripIssues(t: IssueInput): TripIssue[] {
  const issues: TripIssue[] = [];
  const sessions = Array.isArray(t.tank_sessions) ? t.tank_sessions : [];

  if (t.active_tank_number != null) {
    const matching = sessions.filter((s) => Number(s.tankNumber) === Number(t.active_tank_number));
    const open = matching.some((s) => hasValue(s.startTime) && !hasValue(s.endTime));
    if (matching.length > 0 && !open) {
      issues.push({
        code: "stale_active_tank",
        severity: "warning",
        label: "Stale active tank",
        detail: `Active tank is ${t.active_tank_number}, but its Tank Session has already ended and no open session exists.`,
      });
    }
  }

  if (t.is_filling_tank === true || t.filling_tank_number != null) {
    const openFill = sessions.some(
      (s) =>
        hasValue(s.fillStartTime) &&
        !hasValue(s.fillEndTime) &&
        (t.filling_tank_number == null || Number(s.tankNumber) === Number(t.filling_tank_number)),
    );
    if (!openFill) {
      issues.push({
        code: "fill_state_mismatch",
        severity: "warning",
        label: "Fill state mismatch",
        detail: "Trip says a tank is filling, but there is no open fill session.",
      });
    }
  }

  if (t.end_time && hasRuntimeState(t)) {
    issues.push({
      code: "completion_mismatch",
      severity: "warning",
      label: "Completion mismatch",
      detail: "Trip has an end time but runtime fields still claim it is running.",
    });
  }

  if (t.spray_record_id) {
    const tripDone = !!t.end_time;
    const sprayOpen = !t.spray_record_end_time;
    if ((tripDone && sprayOpen) || (!tripDone && t.is_active === true && !sprayOpen)) {
      issues.push({
        code: "spray_lifecycle_mismatch",
        severity: "warning",
        label: "Spray lifecycle mismatch",
        detail: tripDone
          ? "Trip is completed but the linked Spray Record still appears open."
          : "Trip is running but the linked Spray Record already has an end time.",
      });
    }
    const diff = blockScopeDiff(t.block_ids, t.spray_application_block_ids);
    if (diff && (diff.added.length || diff.missing.length)) {
      issues.push({
        code: "block_scope_difference",
        severity: "info",
        label: "Block scope differs from original Spray Record",
        detail: `Trip has ${diff.tripCount} blocks; Spray Record has ${diff.sprayCount} application blocks. This may be blocks added during the job.`,
      });
    }
  }
  return issues;
}

export function blockScopeDiff(tripIds: string[] | null | undefined, sprayIds: string[] | null | undefined) {
  if (!Array.isArray(sprayIds) || sprayIds.length === 0) return null;
  const trip = new Set((tripIds ?? []).map((v) => String(v).toLowerCase()));
  const spray = new Set(sprayIds.map((v) => String(v).toLowerCase()));
  return {
    tripCount: trip.size,
    sprayCount: spray.size,
    added: [...trip].filter((id) => !spray.has(id)),
    missing: [...spray].filter((id) => !trip.has(id)),
  };
}

export const needsAttention = (t: IssueInput) => detectTripIssues(t).some((i) => i.severity === "warning");

function hasRuntimeState(t: Partial<AdminTripRow>): boolean {
  return (
    t.is_active === true ||
    t.is_paused === true ||
    t.active_tank_number != null ||
    t.is_filling_tank === true ||
    t.filling_tank_number != null
  );
}

/** Force Stop is only for Trips that are genuinely still running (no end time). */
export function canForceStop(t: Pick<AdminTripRow, "end_time" | "is_active" | "is_paused" | "active_tank_number" | "is_filling_tank" | "filling_tank_number">): boolean {
  if (t.end_time) return false;
  return t.is_active === true || t.is_paused === true || t.is_filling_tank === true;
}

export type TripActionId =
  | "repair_tank"
  | "repair_fill"
  | "repair_completion"
  | "close_spray"
  | "review_spray"
  | "compare_blocks"
  | "force_stop";

export const TRIP_ACTION_LABEL: Record<TripActionId, string> = {
  repair_tank: "Repair Tank State",
  repair_fill: "Repair Fill State",
  repair_completion: "Repair Completion State",
  close_spray: "Close Spray Record",
  review_spray: "Review Spray Record",
  compare_blocks: "Compare Blocks",
  force_stop: "Force Stop Trip",
};

const ISSUE_ACTION: Partial<Record<TripIssueCode, TripActionId>> = {
  stale_active_tank: "repair_tank",
  fill_state_mismatch: "repair_fill",
  completion_mismatch: "repair_completion",
  block_scope_difference: "compare_blocks",
};

function anyOpenFill(t: IssueInput) {
  return (t.tank_sessions ?? []).some((s) => hasValue(s.fillStartTime) && !hasValue(s.fillEndTime));
}

/** Action for one issue, only if the server preconditions (SQL 251) hold. */
export function actionForIssue(t: IssueInput, issue: TripIssue): TripActionId | null {
  if (issue.code === "spray_lifecycle_mismatch") {
    if (t.end_time && t.spray_record_id && !t.spray_record_end_time) return "close_spray";
    return "review_spray"; // never an automatic reopen
  }
  const a = ISSUE_ACTION[issue.code] ?? null;
  if (a === "repair_tank" && (t.end_time || anyOpenFill(t))) return null;
  if (a === "repair_fill" && t.end_time) return null;
  return a;
}

/** Contextual actions, surgical repairs first, Force Stop last. */
export function tripActions(t: IssueInput & Pick<AdminTripRow, "is_paused">): TripActionId[] {
  const out: TripActionId[] = [];
  for (const issue of detectTripIssues(t)) {
    const a = actionForIssue(t, issue);
    if (a && !out.includes(a)) out.push(a);
  }
  const order: TripActionId[] = ["repair_tank", "repair_fill", "repair_completion", "close_spray", "review_spray", "compare_blocks"];
  const sorted = order.filter((a) => out.includes(a));
  if (canForceStop(t as AdminTripRow)) sorted.push("force_stop");
  return sorted;
}

export interface ReconcileResult {
  status: "repaired" | "nothing_to_repair";
  trip_id: string;
  repairs: ("tank" | "fill" | "completion")[];
  previous_active_tank_number?: number | null;
  previous_filling_tank_number?: number | null;
  audit_event_id?: string;
}

export interface CloseSprayResult {
  status: "closed" | "already_closed";
  trip_id: string;
  spray_record_id?: string;
  end_time?: string;
  audit_event_id?: string;
}

export function describeReconcile(r: ReconcileResult): string {
  if (r.status === "nothing_to_repair" || r.repairs.length === 0) return "Nothing to repair — runtime state was already consistent. No changes made.";
  const parts: string[] = [];
  if (r.repairs.includes("tank"))
    parts.push(
      `Tank state repaired — stale active ${r.previous_active_tank_number != null ? `Tank ${r.previous_active_tank_number}` : "tank"} flag cleared. Tank Session and actual mix were unchanged.`,
    );
  if (r.repairs.includes("fill"))
    parts.push("Fill state repaired — stale filling flag cleared. Fill sessions were unchanged.");
  if (r.repairs.includes("completion"))
    parts.push("Completion state repaired — runtime flags closed. The existing end time was kept.");
  return parts.join(" ");
}

export function describeCloseSpray(r: CloseSprayResult): string {
  if (r.status === "already_closed") return "Spray Record was already closed. No changes made.";
  return "Spray Record closed at the Trip's completion time. Quantities, tanks, blocks and weather were unchanged.";
}

export function useReconcileTripRuntime() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (args: { tripId: string; reason: string }) => {
      const reason = args.reason.trim();
      if (!reason) return Promise.reject(new Error("A support reason is required"));
      return rpc<ReconcileResult>("admin_reconcile_trip_runtime", { p_trip_id: args.tripId, p_reason: reason });
    },
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: ADMIN_TRIPS_KEY });
      qc.invalidateQueries({ queryKey: adminTripKey(args.tripId) });
    },
  });
}

export function useCloseSprayRecordFromTrip() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (args: { tripId: string; reason: string }) => {
      const reason = args.reason.trim();
      if (!reason) return Promise.reject(new Error("A support reason is required"));
      return rpc<CloseSprayResult>("admin_close_spray_record_from_trip", { p_trip_id: args.tripId, p_reason: reason });
    },
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: ADMIN_TRIPS_KEY });
      qc.invalidateQueries({ queryKey: adminTripKey(args.tripId) });
    },
  });
}

/** Latest trustworthy operational activity (path points + tank sessions + pauses). */
export function lastOperationalActivity(detail: AdminTripDetail | null | undefined, row?: AdminTripRow | null): Date | null {
  const candidates: (Date | null)[] = [];
  const trip = detail?.trip;
  const lp = trip?.last_path_point;
  if (lp && typeof lp === "object") candidates.push(parseTripTime(lp.timestamp ?? lp.time ?? lp.recordedAt ?? lp.date));
  const sessions: any[] = Array.isArray(trip?.tank_sessions) ? trip!.tank_sessions : row?.tank_sessions ?? [];
  for (const s of sessions) {
    for (const k of ["endTime", "end_time", "startTime", "start_time", "fillEndTime", "fill_end_time", "fillStartTime", "fill_start_time"]) {
      candidates.push(parseTripTime(s?.[k]));
    }
  }
  for (const k of ["pause_timestamps", "resume_timestamps"]) {
    const arr = trip?.[k];
    if (Array.isArray(arr)) arr.forEach((v: unknown) => candidates.push(parseTripTime(v)));
  }
  const valid = candidates.filter((d): d is Date => !!d && !isNaN(d.getTime()));
  if (valid.length === 0) {
    const fallback = parseTripTime(trip?.start_time ?? row?.start_time);
    return fallback;
  }
  return new Date(Math.max(...valid.map((d) => d.getTime())));
}

export function formatDurationMs(ms: number | null): string {
  if (ms == null || !isFinite(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
