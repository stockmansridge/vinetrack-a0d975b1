// Parent pruning activity data layer — SQL 166.
//
// All reads and writes go through the shared parent-activity RPCs on the
// VineTrack (iOS) project. The portal never fans out to the legacy
// single-block `record_pruning_entry` / `update_pruning_entry` RPCs from the
// multi-block editor.
//
// Verified signatures:
//   record_pruning_activity(p_payload jsonb)
//   update_pruning_activity(p_activity_id uuid, p_activity jsonb, p_allocations jsonb)
//   get_pruning_activity(p_activity_id uuid)
//   list_pruning_activities(p_vineyard_id uuid, p_include_reversed boolean)
//   reverse_pruning_activity(p_activity_id uuid, p_reason text)
//
// The RPCs return canonical JSON. Field names are read defensively (a small
// alias list per field) so a harmless naming difference between platforms
// cannot blank the report — but nothing is invented: a missing value stays
// null, and labour figures are never derived by summing allocations.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import type { PruningActivityDraft } from "@/lib/pruningActivityContract";
import { activityObject, allocationObjects, buildActivityPayload } from "@/lib/pruningActivityContract";

// ---------------------------------------------------------------- helpers

const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase as any).rpc(name, args);

function pick<T = any>(src: any, keys: string[], fallback: T | null = null): T | null {
  if (!src || typeof src !== "object") return fallback;
  for (const k of keys) {
    const v = src[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return fallback;
}

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: any): string => (v == null ? "" : String(v));

// ---------------------------------------------------------------- types

export interface ActivitySegment {
  row: number;
  segment: number;
  row_id: string | null;
  label: string;
}

export interface ActivityAllocation {
  id: string | null;
  activityId: string | null;
  paddockId: string;
  blockName: string;
  variety: string;
  seasonId: string | null;
  seasonYear: number | null;
  vintageYear: number | null;
  segments: ActivitySegment[];
  rowNumbers: number[];
  rowsLabel: string;
  quarters: number;
  rowEquivalents: number;
  vines: number;
}

export interface PruningActivity {
  id: string;
  vineyardId: string | null;
  date: string;
  worker: string;
  method: string;
  startTime: string | null;
  finishTime: string | null;
  labourHours: number | null;
  hourlyRate: number | null;
  labourCost: number | null;
  notes: string;
  workTaskId: string | null;
  workTaskLabel: string | null;
  workTaskStatus: string | null;
  seasonYear: number | null;
  vintageYear: number | null;
  createdById: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isReversed: boolean;
  /** Canonical totals from the server (canonical.totals / parent fields). */
  quarters: number;
  rowEquivalents: number;
  vines: number;
  rowCount: number;
  /** Season data problems detected on the canonical payload. */
  seasonIssues: string[];
  seasonMismatch: boolean;
  hasSeasonLink: boolean;
  allocations: ActivityAllocation[];
  /** Untouched server object, for diagnostics/export fallbacks. */
  raw: any;
}

export interface ActivitySaveConflict {
  paddock_id?: string | null;
  row?: number;
  segment?: number;
  reason?: string;
}

export interface ActivitySaveResult {
  activity: PruningActivity | null;
  conflicts: ActivitySaveConflict[];
  stale: boolean;
  error: string | null;
  raw: any;
}

// ---------------------------------------------------------------- format

/** Compact a list of row numbers into "1–4, 7, 10–12". */
export function formatRowRanges(rows: number[]): string {
  const nums = Array.from(new Set(rows.filter((n) => Number.isFinite(n)))).sort((a, b) => a - b);
  if (!nums.length) return "—";
  const parts: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i];
    if (n === prev + 1) { prev = n; continue; }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return parts.join(", ");
}

/** Minutes between two time/timestamp values; rolls over midnight. */
export function durationMinutesBetween(start: string | null, finish: string | null): number | null {
  const toMinutes = (v: string | null): number | null => {
    if (!v) return null;
    const raw = v.trim();
    if (raw.includes("T") || (raw.includes(" ") && raw.length > 10)) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
    }
    const hm = /^(\d{1,2}):(\d{2})/.exec(raw);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
    return null;
  };
  const a = toMinutes(start);
  const b = toMinutes(finish);
  if (a == null || b == null) return null;
  const diff = b - a;
  return diff >= 0 ? diff : diff + 24 * 60;
}

// ---------------------------------------------------------------- normalise

function normaliseSegments(raw: any): ActivitySegment[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((s: any) => ({
    row: Number(pick(s, ["row", "row_number", "rowNumber"]) ?? 0),
    segment: Number(pick(s, ["segment", "segment_number", "quarter"]) ?? 0),
    row_id: (pick(s, ["row_id", "paddock_row_id"]) as string) ?? null,
    label: str(pick(s, ["label", "row_label"]) ?? pick(s, ["row", "row_number"]) ?? ""),
  }));
}

function normaliseAllocation(raw: any, activityId: string | null): ActivityAllocation {
  const segments = normaliseSegments(pick(raw, ["segments", "quarters", "row_segments"]) ?? []);
  const rowNumbers = Array.from(new Set(segments.map((s) => s.row))).sort((a, b) => a - b);
  const quarters = num(pick(raw, ["quarters", "quarter_count", "segment_count"])) ?? segments.length;
  const rowEq = num(pick(raw, ["row_equivalents", "row_equivalents_completed", "rowEquivalents"]))
    ?? quarters / 4;
  return {
    id: (pick(raw, ["id", "allocation_id"]) as string) ?? null,
    activityId: (pick(raw, ["activity_id", "pruning_activity_id"]) as string) ?? activityId,
    paddockId: str(pick(raw, ["paddock_id", "block_id", "paddockId"])),
    blockName: str(pick(raw, ["paddock_name", "block_name", "block", "name"]) ?? "—") || "—",
    variety: str(pick(raw, ["variety", "varieties", "variety_name"]) ?? "") || "—",
    seasonId: (pick(raw, ["season_id", "pruning_season_id"]) as string) ?? null,
    seasonYear: num(pick(raw, ["season_year", "pruning_season_year"])),
    vintageYear: num(pick(raw, ["vintage_year", "vintage"])),
    segments,
    rowNumbers,
    rowsLabel: formatRowRanges(rowNumbers),
    quarters,
    rowEquivalents: rowEq,
    vines: num(pick(raw, ["estimated_vines", "vines", "estimated_vines_completed"])) ?? 0,
  };
}

/** Accepts a bare activity row, `{activity, allocations}`, or `{canonical:{…}}`. */
export function normaliseActivity(input: any): PruningActivity | null {
  if (!input || typeof input !== "object") return null;
  const envelope = pick(input, ["canonical", "data", "result"]) ?? input;
  const a = pick(envelope, ["activity", "pruning_activity"]) ?? envelope;
  const id = str(pick(a, ["id", "activity_id", "pruning_activity_id"]));
  if (!id) return null;

  const allocRaw =
    pick(envelope, ["allocations", "activity_allocations", "blocks"]) ??
    pick(a, ["allocations", "activity_allocations", "blocks"]) ??
    [];
  const allocations = (Array.isArray(allocRaw) ? allocRaw : []).map((r) => normaliseAllocation(r, id));

  const totals = pick(envelope, ["totals"]) ?? pick(a, ["totals"]) ?? {};

  const quarters = num(pick(totals, ["quarters", "quarter_count"]))
    ?? num(pick(a, ["quarters", "quarter_count", "total_quarters"]))
    ?? allocations.reduce((s, x) => s + x.quarters, 0);
  const rowEq = num(pick(totals, ["row_equivalents", "rowEquivalents"]))
    ?? num(pick(a, ["row_equivalents", "row_equivalents_completed", "total_row_equivalents"]))
    ?? quarters / 4;
  const vines = num(pick(totals, ["vines", "estimated_vines"]))
    ?? num(pick(a, ["estimated_vines", "estimated_vines_completed", "total_vines"]))
    ?? allocations.reduce((s, x) => s + x.vines, 0);

  const rowNumbers = new Set<number>();
  allocations.forEach((x) => x.rowNumbers.forEach((n) => rowNumbers.add(n)));

  const seasonYear = num(pick(a, ["season_year", "pruning_season_year"]))
    ?? allocations.map((x) => x.seasonYear).find((y) => y != null)
    ?? null;
  const vintageYear = num(pick(a, ["vintage_year", "vintage"]))
    ?? allocations.map((x) => x.vintageYear).find((y) => y != null)
    ?? null;

  const date = str(pick(a, ["entry_date", "activity_date", "date"]));
  const expectedSeason = date ? Number(date.slice(0, 4)) : null;
  const seasonIssues: string[] = [];
  if (seasonYear != null && expectedSeason != null && seasonYear !== expectedSeason) {
    seasonIssues.push(
      `Season ${seasonYear} does not match the year the work was recorded (${expectedSeason}).`,
    );
  }
  if (
    seasonYear != null && vintageYear != null &&
    vintageYear !== seasonYear && vintageYear !== seasonYear + 1
  ) {
    seasonIssues.push(`Vintage ${vintageYear} is not consistent with season ${seasonYear}.`);
  }
  const allocSeasons = new Set(allocations.map((x) => x.seasonYear).filter((y) => y != null));
  if (allocSeasons.size > 1) {
    seasonIssues.push("Allocations of this activity are linked to different pruning seasons.");
  }

  const deletedAt = pick(a, ["deleted_at", "reversed_at"]);

  return {
    id,
    vineyardId: (pick(a, ["vineyard_id"]) as string) ?? null,
    date,
    worker: str(pick(a, ["worker_or_crew", "worker", "crew"]) ?? "") || "—",
    method: str(pick(a, ["method", "pruning_method"]) ?? "") || "—",
    startTime: (pick(a, ["start_time", "started_at"]) as string) ?? null,
    finishTime: (pick(a, ["finish_time", "finished_at"]) as string) ?? null,
    labourHours: num(pick(a, ["labour_hours", "hours"])),
    hourlyRate: num(pick(a, ["hourly_rate", "rate_per_hour"])),
    labourCost: num(pick(a, ["labour_cost", "total_labour_cost", "cost"])),
    notes: str(pick(a, ["notes"]) ?? ""),
    workTaskId: (pick(a, ["work_task_id"]) as string) ?? null,
    workTaskLabel: (pick(a, ["work_task_label", "work_task_title", "work_task_type"]) as string) ?? null,
    workTaskStatus: (pick(a, ["work_task_status"]) as string) ?? null,
    seasonYear,
    vintageYear,
    createdById: (pick(a, ["created_by", "created_by_user_id"]) as string) ?? null,
    createdAt: (pick(a, ["created_at"]) as string) ?? null,
    updatedAt: (pick(a, ["updated_at"]) as string) ?? null,
    isReversed: !!deletedAt || pick(a, ["reversed", "is_reversed"]) === true
      || str(pick(a, ["status"])).toLowerCase() === "reversed",
    quarters,
    rowEquivalents: rowEq,
    vines,
    rowCount: rowNumbers.size,
    seasonIssues,
    seasonMismatch: seasonIssues.length > 0,
    hasSeasonLink: seasonYear != null,
    allocations,
    raw: envelope,
  };
}

function normaliseSaveResult(data: any): ActivitySaveResult {
  const envelope = data && typeof data === "object" ? data : {};
  const conflictsRaw =
    pick(envelope, ["conflicts", "quarter_conflicts", "rejected"]) ?? [];
  return {
    activity: normaliseActivity(envelope),
    conflicts: Array.isArray(conflictsRaw) ? conflictsRaw : [],
    stale: pick(envelope, ["stale"]) === true,
    error: (pick(envelope, ["error", "error_message"]) as string) ?? null,
    raw: envelope,
  };
}

// ---------------------------------------------------------------- reads

export const ACTIVITY_QK = {
  list: (vineyardId: string | null, includeReversed: boolean) =>
    ["pruning", "activities", vineyardId, includeReversed] as const,
  one: (id: string | null) => ["pruning", "activity", id] as const,
  export: (vineyardId: string | null) => ["pruning", "activity-export", vineyardId] as const,
};

export function usePruningActivities(vineyardId: string | null, includeReversed = true) {
  return useQuery({
    queryKey: ACTIVITY_QK.list(vineyardId, includeReversed),
    enabled: !!vineyardId,
    queryFn: async (): Promise<PruningActivity[]> => {
      const { data, error } = await rpc("list_pruning_activities", {
        p_vineyard_id: vineyardId,
        p_include_reversed: includeReversed,
      });
      if (error) throw error;
      const rows = Array.isArray(data)
        ? data
        : Array.isArray((data as any)?.activities)
        ? (data as any).activities
        : data
        ? [data]
        : [];
      return rows
        .map((r: any) => normaliseActivity(r))
        .filter((r): r is PruningActivity => !!r);
    },
  });
}

export async function fetchPruningActivity(activityId: string): Promise<PruningActivity | null> {
  const { data, error } = await rpc("get_pruning_activity", { p_activity_id: activityId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return normaliseActivity(row);
}

export function usePruningActivityDetail(activityId: string | null) {
  return useQuery({
    queryKey: ACTIVITY_QK.one(activityId),
    enabled: !!activityId,
    queryFn: () => fetchPruningActivity(activityId!),
  });
}

/**
 * Allocation-detail export view. Rows are returned exactly as the view
 * produces them — activity labour, hourly rate and labour cost appear ONLY on
 * the primary allocation row and are deliberately not filled down.
 */
export function useAllocationExportRows(vineyardId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ACTIVITY_QK.export(vineyardId),
    enabled: !!vineyardId && enabled,
    queryFn: async (): Promise<Record<string, any>[]> => {
      const { data, error } = await (supabase as any)
        .from("pruning_activity_allocation_export")
        .select("*")
        .eq("vineyard_id", vineyardId);
      if (error) throw error;
      return (data ?? []) as Record<string, any>[];
    },
  });
}

// ---------------------------------------------------------------- writes

function useActivityInvalidation() {
  const qc = useQueryClient();
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["pruning"] }),
      qc.invalidateQueries({ queryKey: ["workTasks"] }),
      qc.invalidateQueries({ queryKey: ["costReports"] }),
    ]);
    await qc.refetchQueries({ queryKey: ["pruning"], type: "active" });
  };
}

export interface SaveActivityInput {
  draft: PruningActivityDraft;
  vineyardId: string;
  /** Client-generated uuid; reuse on retry — the RPC is idempotent on id. */
  activityId: string;
}

export async function recordPruningActivity(input: SaveActivityInput): Promise<ActivitySaveResult> {
  const payload = buildActivityPayload(input.draft, input.vineyardId, input.activityId);
  const { data, error } = await rpc("record_pruning_activity", { p_payload: payload });
  if (error) throw new Error(friendlySaveError(error));
  return normaliseSaveResult(data);
}

export async function updatePruningActivity(input: SaveActivityInput): Promise<ActivitySaveResult> {
  const { data, error } = await rpc("update_pruning_activity", {
    p_activity_id: input.activityId,
    p_activity: activityObject(input.draft, input.vineyardId, input.activityId),
    // FULL desired allocation array — never only the changed allocations.
    p_allocations: allocationObjects(input.draft),
  });
  if (error) throw new Error(friendlySaveError(error));
  return normaliseSaveResult(data);
}

/** Turn raw Postgres constraint noise into something a grower can act on. */
export function friendlySaveError(error: any): string {
  const msg = String(error?.message ?? error ?? "");
  if (msg.includes("pruning_entries_activity_block_unique")) {
    return (
      "This activity already has a record for one of these blocks. " +
      "Close and reopen the activity so it reloads the latest allocations, then apply your change again. " +
      "If it keeps happening, the block is recorded twice on the server and needs to be cleaned up."
    );
  }
  return msg;
}


export function useSavePruningActivity(mode: "create" | "edit") {
  const invalidate = useActivityInvalidation();
  return useMutation({
    mutationFn: (input: SaveActivityInput) =>
      mode === "create" ? recordPruningActivity(input) : updatePruningActivity(input),
    onSuccess: invalidate,
  });
}

export function useReversePruningActivity() {
  const invalidate = useActivityInvalidation();
  return useMutation({
    mutationFn: async (vars: { activityId: string; reason?: string }) => {
      const { data, error } = await rpc("reverse_pruning_activity", {
        p_activity_id: vars.activityId,
        p_reason: vars.reason ?? null,
      });
      if (error) throw error;
      const result = normaliseSaveResult(data);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: invalidate,
  });
}
