// READ-ONLY query helper for yield reports. No writes.
//
// Schema (docs/supabase-schema.md §3.13):
//   yield_estimation_sessions: payload jsonb (full session document),
//     is_completed, completed_at, session_created_at, plus standard sync
//     columns (id, vineyard_id, created_at, updated_at, deleted_at,
//     created_by, updated_by, client_updated_at, sync_version).
//
//   historical_yield_records: season, year, archived_at,
//     total_yield_tonnes, total_area_hectares, notes, block_results jsonb,
//     plus standard sync columns.
//
//   No top-level paddock_id / variety / block_id on either table — those
//   live inside `payload` / `block_results` JSONB. Therefore the only safe
//   relationship is `vineyard_id`.
import { supabase } from "@/integrations/ios-supabase/client";

export interface YieldEstimationSession {
  id: string;
  vineyard_id: string;
  payload?: any;
  is_completed?: boolean | null;
  completed_at?: string | null;
  session_created_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface HistoricalYieldRecord {
  id: string;
  vineyard_id: string;
  season?: string | null;
  year?: number | null;
  archived_at?: string | null;
  total_yield_tonnes?: number | null;
  total_area_hectares?: number | null;
  notes?: string | null;
  block_results?: any;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface YieldReportsQueryResult {
  sessions: YieldEstimationSession[];
  historical: HistoricalYieldRecord[];
  source: "vineyard_id" | "empty";
  sessionCount: number;
  historicalCount: number;
  deletedExcludedSessions: number;
  deletedExcludedHistorical: number;
  missingSeason: number;
  missingYieldFields: number;
}

export async function fetchYieldReportsForVineyard(
  vineyardId: string,
): Promise<YieldReportsQueryResult> {
  const [sessRes, histRes] = await Promise.all([
    supabase
      .from("yield_estimation_sessions")
      .select("*")
      .eq("vineyard_id", vineyardId)
      .is("deleted_at", null),
    supabase
      .from("historical_yield_records")
      .select("*")
      .eq("vineyard_id", vineyardId)
      .is("deleted_at", null),
  ]);
  if (sessRes.error) throw sessRes.error;
  if (histRes.error) throw histRes.error;

  const sessions = (sessRes.data ?? []) as YieldEstimationSession[];
  const historical = (histRes.data ?? []) as HistoricalYieldRecord[];

  const total = sessions.length + historical.length;
  return {
    sessions,
    historical,
    source: total ? "vineyard_id" : "empty",
    sessionCount: sessions.length,
    historicalCount: historical.length,
    deletedExcludedSessions: 0,
    deletedExcludedHistorical: 0,
    missingSeason: historical.filter((r) => !r.season && r.year == null).length,
    missingYieldFields: historical.filter(
      (r) => r.total_yield_tonnes == null && r.total_area_hectares == null,
    ).length,
  };
}
