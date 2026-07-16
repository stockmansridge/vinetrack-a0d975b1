// Shared pruning queries/mutations. Reads pruning_* tables directly.
// All WRITES go through RPCs: record_pruning_entry, delete_pruning_entry,
// soft_delete_pruning_season. Season INSERT/UPDATE is allowed subject to RLS.
//
// Cross-platform sync: pruning_seasons IDs are deterministic (see
// `pruningSeasonId`) AND we always resolve the live row before writing —
// if a row already exists for (vineyard, paddock, season_year) we adopt
// its id whatever it is, and only insert with the deterministic id when
// none exists. Never generate random season IDs.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { pruningSeasonId } from "@/lib/pruningSeasonId";

export type PruningMethod = "spur" | "cane" | "mechanical" | "mixed";
export type PruningStatus = "active" | "complete" | "archived";

export interface PruningSeason {
  id: string;
  vineyard_id: string;
  paddock_id: string;
  season_year: number;
  start_date: string | null;
  due_date: string | null;
  pruning_method: PruningMethod | string;
  assigned_crew: string;
  working_days: number[]; // 0=Sun ... 6=Sat (ISO-like); iOS uses 1=Mon..7=Sun. We store as-is.
  manual_row_count: number | null;
  estimated_labour_hours: number | null;
  notes: string;
  status: PruningStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PruningEntry {
  id: string;
  vineyard_id: string;
  pruning_season_id: string;
  paddock_id: string;
  entry_date: string;
  worker_or_crew: string;
  labour_hours: number | null;
  start_time: string | null;
  finish_time: string | null;
  pruning_method: string;
  notes: string;
  row_equivalents_completed: number;
  estimated_vines_completed: number;
  work_task_id: string | null;
  /** SQL 119: production/costing vintage resolved server-side from the
   *  vineyard's season settings + entry_date. Authoritative for cost
   *  reports — do NOT derive from entry_date on the client. */
  vintage_year: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}


export interface PruningRowSegment {
  id: string;
  pruning_entry_id: string | null;
  pruning_season_id: string;
  vineyard_id: string;
  paddock_id: string;
  paddock_row_id: string | null;
  row_number: number;
  segment_number: number; // 1..4
  row_label: string;
  completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
}

const QK = {
  seasons: (vineyardId: string) => ["pruning", "seasons", vineyardId] as const,
  entries: (seasonId: string) => ["pruning", "entries", seasonId] as const,
  segments: (seasonId: string) => ["pruning", "segments", seasonId] as const,
};

// ---------- Seasons ----------

export function usePruningSeasons(vineyardId: string | null) {
  return useQuery({
    queryKey: QK.seasons(vineyardId ?? ""),
    enabled: !!vineyardId,
    queryFn: async (): Promise<PruningSeason[]> => {
      const { data, error } = await supabase
        .from("pruning_seasons")
        .select("*")
        .eq("vineyard_id", vineyardId!)
        .is("deleted_at", null)
        .order("season_year", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PruningSeason[];
    },
  });
}

export interface SeasonUpsertInput {
  id?: string;
  vineyard_id: string;
  paddock_id: string;
  season_year: number;
  start_date?: string | null;
  due_date?: string | null;
  pruning_method: string;
  assigned_crew: string;
  working_days: number[];
  manual_row_count?: number | null;
  estimated_labour_hours?: number | null;
  notes?: string;
  status?: PruningStatus;
}

/**
 * Resolve the live pruning_seasons row id for (vineyard, paddock, season_year),
 * or return the deterministic id that a fresh insert would use. Never caches
 * across sessions — always re-query. Callers that then insert MUST be prepared
 * for a benign duplicate-key error caused by a concurrent client (retry the
 * resolve in that case).
 */
export async function resolvePruningSeasonId(
  vineyardId: string,
  paddockId: string,
  seasonYear: number,
): Promise<{ id: string; existed: boolean }> {
  const { data, error } = await supabase
    .from("pruning_seasons")
    .select("id")
    .eq("vineyard_id", vineyardId)
    .eq("paddock_id", paddockId)
    .eq("season_year", seasonYear)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (data?.id) return { id: data.id, existed: true };
  return { id: pruningSeasonId(vineyardId, paddockId, seasonYear), existed: false };
}

export function useUpsertPruningSeason(vineyardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SeasonUpsertInput) => {
      const payload = {
        ...input,
        client_updated_at: new Date().toISOString(),
      };
      // Resolve-then-adopt: always look up the live row first so we don't
      // create a duplicate season with a different id than iOS/Android used.
      const resolved = input.id
        ? { id: input.id, existed: true }
        : await resolvePruningSeasonId(input.vineyard_id, input.paddock_id, input.season_year);

      if (resolved.existed) {
        const { data, error } = await supabase
          .from("pruning_seasons")
          .update(payload)
          .eq("id", resolved.id)
          .select("*")
          .maybeSingle();
        if (error) throw error;
        return data as PruningSeason;
      }
      const { data, error } = await supabase
        .from("pruning_seasons")
        .insert({ id: resolved.id, ...payload })
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as PruningSeason;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pruning", "seasons", vineyardId] }),
  });
}

export function useDeletePruningSeason(vineyardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("soft_delete_pruning_season", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pruning", "seasons", vineyardId] }),
  });
}

// ---------- Entries + Segments (per season) ----------

export function usePruningEntries(seasonId: string | null) {
  return useQuery({
    queryKey: QK.entries(seasonId ?? ""),
    enabled: !!seasonId,
    queryFn: async (): Promise<PruningEntry[]> => {
      const { data, error } = await supabase
        .from("pruning_entries")
        .select("*")
        .eq("pruning_season_id", seasonId!)
        .is("deleted_at", null)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PruningEntry[];
    },
  });
}

export function usePruningSegments(seasonId: string | null) {
  return useQuery({
    queryKey: QK.segments(seasonId ?? ""),
    enabled: !!seasonId,
    queryFn: async (): Promise<PruningRowSegment[]> => {
      const { data, error } = await supabase
        .from("pruning_row_segments")
        .select("*")
        .eq("pruning_season_id", seasonId!);
      if (error) throw error;
      return (data ?? []) as PruningRowSegment[];
    },
  });
}

// ---------- Record / reverse ----------

export interface RecordSegmentInput {
  rowNumber: number;
  segmentNumber: number;
  paddockRowId: string | null;
  rowLabel: string;
}

export interface RecordEntryInput {
  entryId?: string;
  vineyardId: string;
  seasonId: string;
  paddockId: string;
  seasonYear: number;
  entryDate: string; // yyyy-mm-dd
  worker: string;
  labourHours: number | null;
  startTime: string | null; // ISO
  finishTime: string | null; // ISO
  method: string;
  notes: string;
  estimatedVines: number;
  segments: RecordSegmentInput[];
  /** SQL 113: durable link to a work_tasks row. Null to leave unlinked. */
  workTaskId?: string | null;
}

export interface RecordEntryResult {
  entry_id: string;
  /** Server-canonical season the entry was attached to. May differ from
   *  the id the caller passed if the server adopted a different row. */
  season_id?: string;
  requested: number;
  attributed: number;
  deleted?: boolean;
}

export function useRecordPruningEntry(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    // Idempotency: entryId must be supplied and reused on retry. The RPC is
    // idempotent on p_id, so the SAME uuid is safe to replay; do NOT roll a
    // fresh uuid here or a retry would double-save.
    mutationFn: async (input: RecordEntryInput): Promise<RecordEntryResult> => {
      const entryId = input.entryId ?? crypto.randomUUID();
      const { data, error } = await (supabase as any).rpc("record_pruning_entry", {
        p_id: entryId,
        p_vineyard_id: input.vineyardId,
        p_season_id: input.seasonId,
        p_paddock_id: input.paddockId,
        p_season_year: input.seasonYear,
        p_entry_date: input.entryDate,
        p_worker: input.worker,
        p_labour_hours: input.labourHours ?? null,
        p_start_time: input.startTime ?? null,
        p_finish_time: input.finishTime ?? null,
        p_method: input.method,
        p_notes: input.notes,
        p_estimated_vines: Math.max(0, Math.round(input.estimatedVines)),
        p_client_updated_at: new Date().toISOString(),
        p_segments: input.segments.map((s) => ({
          row: s.rowNumber,
          segment: s.segmentNumber,
          row_id: s.paddockRowId ?? null,
          label: s.rowLabel,
        })),
        p_work_task_id: input.workTaskId ?? null,
      });
      // Never swallow RPC errors as success — a 409 / duplicate-key is NOT
      // "already saved" for our purposes; surface it so the caller can retry
      // idempotently with the same entryId.
      if (error) throw error;
      return data as RecordEntryResult;
    },
    onSuccess: async (data) => {
      // The server may have attached the entry to a canonical season row
      // that differs from the id the caller passed — invalidate BOTH.
      const canonicalSeasonId = data?.season_id ?? seasonId;
      await Promise.all([
        qc.invalidateQueries({ queryKey: QK.entries(seasonId) }),
        qc.invalidateQueries({ queryKey: QK.segments(seasonId) }),
        qc.invalidateQueries({ queryKey: QK.entries(canonicalSeasonId) }),
        qc.invalidateQueries({ queryKey: QK.segments(canonicalSeasonId) }),
        qc.invalidateQueries({ queryKey: ["pruning"] }),
      ]);
      await qc.refetchQueries({ queryKey: ["pruning"], type: "active" });
    },
  });
}

export function useReversePruningEntry(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await (supabase as any).rpc("delete_pruning_entry", { p_id: entryId });
      if (error) throw error;
      // Re-read segments for this entry so we can log the post-reversal state.
      if (import.meta.env.DEV) {
        const { data: segs } = await supabase
          .from("pruning_row_segments")
          .select("row_number, paddock_row_id, segment_number, completed, pruning_entry_id, completed_at")
          .eq("pruning_season_id", seasonId);
        const linked = (segs ?? []).filter((s: any) => s.pruning_entry_id === entryId);
        const completedAfter = (segs ?? []).filter((s: any) => s.completed === true);
        // eslint-disable-next-line no-console
        console.debug("[pruning] reverse", {
          entryId,
          seasonId,
          linkedSegmentsAfter: linked.length,
          totalSegments: segs?.length ?? 0,
          segmentsCompletedAfter: completedAfter.length,
          refreshedSegments: segs,
        });
      }
    },
    onSuccess: async () => {
      // Broad invalidation — reversal touches segments, entries, season totals
      // and any block/vineyard summaries derived from them.
      await Promise.all([
        qc.invalidateQueries({ queryKey: QK.entries(seasonId) }),
        qc.invalidateQueries({ queryKey: QK.segments(seasonId) }),
        qc.invalidateQueries({ queryKey: ["pruning"] }),
      ]);
      await qc.refetchQueries({ queryKey: ["pruning"], type: "active" });
    },
  });
}

/** SQL 113: link, unlink, or retry-link an existing pruning entry to a Work Task. */
export async function setPruningEntryWorkTask(entryId: string, workTaskId: string | null) {
  const { error } = await (supabase as any).rpc("set_pruning_entry_work_task", {
    p_entry_id: entryId,
    p_work_task_id: workTaskId,
  });
  if (error) throw error;
}
