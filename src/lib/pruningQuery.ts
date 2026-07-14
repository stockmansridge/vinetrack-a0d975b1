// Shared pruning queries/mutations. Reads pruning_* tables directly.
// All WRITES go through RPCs: record_pruning_entry, delete_pruning_entry,
// soft_delete_pruning_season. Season INSERT/UPDATE is allowed subject to RLS.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

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
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PruningRowSegment {
  id: string;
  pruning_entry_id: string;
  pruning_season_id: string;
  vineyard_id: string;
  paddock_id: string;
  paddock_row_id: string | null;
  row_number: number;
  segment_number: number; // 1..4
  row_label: string;
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

export function useUpsertPruningSeason(vineyardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SeasonUpsertInput) => {
      const payload = {
        ...input,
        client_updated_at: new Date().toISOString(),
      };
      if (input.id) {
        const { data, error } = await supabase
          .from("pruning_seasons")
          .update(payload)
          .eq("id", input.id)
          .select("*")
          .maybeSingle();
        if (error) throw error;
        return data as PruningSeason;
      }
      const id = crypto.randomUUID();
      const { data, error } = await supabase
        .from("pruning_seasons")
        .insert({ id, ...payload })
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
}

export interface RecordEntryResult {
  entry_id: string;
  requested: number;
  attributed: number;
  deleted?: boolean;
}

export function useRecordPruningEntry(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
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
      });
      if (error) throw error;
      return data as RecordEntryResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.entries(seasonId) });
      qc.invalidateQueries({ queryKey: QK.segments(seasonId) });
    },
  });
}

export function useReversePruningEntry(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await (supabase as any).rpc("delete_pruning_entry", { p_id: entryId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.entries(seasonId) });
      qc.invalidateQueries({ queryKey: QK.segments(seasonId) });
    },
  });
}
