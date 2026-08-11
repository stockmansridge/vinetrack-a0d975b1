// Query helpers for yield reports.
//
// Reads are unchanged. Writes are limited to what the iOS backend already
// exposes:
//   - INSERT into historical_yield_records (Record Actual Yield)
//   - soft_delete_yield_estimation_session(p_id)
//   - soft_delete_historical_yield_record(p_id)
// No schema changes are made from the portal.
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
import { deriveMetrics } from "@/lib/paddockGeometry";
import type { SessionBlockInfo } from "@/lib/yieldSessionSummary";


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

// ---------------------------------------------------------------------------
// Blocks (area + effective vine count) — needed for tonnage parity with iOS.
// ---------------------------------------------------------------------------

export async function fetchYieldBlocks(vineyardId: string): Promise<SessionBlockInfo[]> {
  const { data, error } = await supabase
    .from("paddocks")
    .select(
      "id, name, variety, rows, polygon_points, vine_spacing, vine_count_override, row_length_override, row_length_overrides",
    )
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((p: any) => {
    const m = deriveMetrics(p);
    return {
      id: p.id as string,
      name: (p.name as string) ?? null,
      areaHa: m.areaHa > 0 ? m.areaHa : null,
      vineCount: m.vineCount,
    } satisfies SessionBlockInfo;
  });
}

// ---------------------------------------------------------------------------
// Soft deletes (RPC only — the portal never hard-deletes production data).
// ---------------------------------------------------------------------------

export async function softDeleteYieldEstimationSession(id: string): Promise<void> {
  const { error } = await (supabase as any).rpc("soft_delete_yield_estimation_session", {
    p_id: id,
  });
  if (error) throw error;
}

export async function softDeleteHistoricalYieldRecord(id: string): Promise<void> {
  const { error } = await (supabase as any).rpc("soft_delete_historical_yield_record", {
    p_id: id,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Record Actual Yield — parity with iOS RecordActualYieldSheet.
// ---------------------------------------------------------------------------

export interface RecordActualYieldInput {
  vineyardId: string;
  year: number;
  season?: string | null;
  blockId: string;
  blockName: string;
  variety?: string | null;
  areaHectares?: number | null;
  vineCount?: number | null;
  actualYieldTonnes: number;
  notes?: string | null;
}

export async function recordActualYield(input: RecordActualYieldInput): Promise<void> {
  const now = new Date().toISOString();
  const area = input.areaHectares && input.areaHectares > 0 ? input.areaHectares : 0;
  const variety = (input.variety ?? "").trim();
  const label = variety ? `${input.blockName} — ${variety}` : input.blockName;

  const blockResult = {
    paddockId: input.blockId,
    paddockName: label,
    areaHectares: area,
    yieldTonnes: input.actualYieldTonnes,
    yieldPerHectare: area > 0 ? input.actualYieldTonnes / area : 0,
    averageBunchesPerVine: 0,
    averageBunchWeightGrams: 0,
    totalVines: input.vineCount ?? 0,
    samplesRecorded: 0,
    damageFactor: 1.0,
    actualYieldTonnes: input.actualYieldTonnes,
    actualRecordedAt: now,
  };

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? null;

  const { error } = await (supabase as any).from("historical_yield_records").insert({
    vineyard_id: input.vineyardId,
    season: (input.season ?? "").trim(),
    year: input.year,
    archived_at: now,
    block_results: [blockResult],
    total_yield_tonnes: input.actualYieldTonnes,
    total_area_hectares: area,
    notes: (input.notes ?? "").trim(),
    created_by: userId,
    updated_by: userId,
    client_updated_at: now,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Block-level rows extracted from historical records (multi-vintage reporting).
// ---------------------------------------------------------------------------

export interface HistoricalBlockRow {
  recordId: string;
  season: string;
  year: number | null;
  blockId: string | null;
  blockName: string;
  areaHa: number | null;
  yieldTonnes: number | null;
  yieldPerHa: number | null;
  archivedAt: string | null;
}

export function extractHistoricalBlockRows(records: HistoricalYieldRecord[]): HistoricalBlockRow[] {
  const rows: HistoricalBlockRow[] = [];
  for (const r of records) {
    const seasonLabel = r.season?.trim() || (r.year != null ? String(r.year) : "—");
    const blocks = Array.isArray(r.block_results) ? r.block_results : [];
    if (!blocks.length) {
      rows.push({
        recordId: r.id,
        season: seasonLabel,
        year: r.year ?? null,
        blockId: null,
        blockName: "All blocks",
        areaHa: r.total_area_hectares ?? null,
        yieldTonnes: r.total_yield_tonnes ?? null,
        yieldPerHa:
          r.total_yield_tonnes != null && r.total_area_hectares
            ? r.total_yield_tonnes / r.total_area_hectares
            : null,
        archivedAt: r.archived_at ?? null,
      });
      continue;
    }
    for (const b of blocks as any[]) {
      const area = Number(b?.areaHectares ?? b?.area_hectares);
      const tonnes = Number(
        b?.actualYieldTonnes ?? b?.actual_yield_tonnes ?? b?.yieldTonnes ?? b?.yield_tonnes,
      );
      const areaHa = Number.isFinite(area) && area > 0 ? area : null;
      const yieldTonnes = Number.isFinite(tonnes) ? tonnes : null;
      rows.push({
        recordId: r.id,
        season: seasonLabel,
        year: r.year ?? null,
        blockId: (b?.paddockId ?? b?.paddock_id ?? null) as string | null,
        blockName: String(b?.paddockName ?? b?.paddock_name ?? "Unnamed block"),
        areaHa,
        yieldTonnes,
        yieldPerHa: yieldTonnes != null && areaHa ? yieldTonnes / areaHa : null,
        archivedAt: r.archived_at ?? null,
      });
    }
  }
  return rows;
}
