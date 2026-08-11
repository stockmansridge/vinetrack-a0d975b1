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
// Blocks (area + effective vine count + variety allocations) — needed for
// tonnage parity with iOS and for Record Actual Yield's block → variety flow.
// NOTE: `paddocks` has NO `variety` column; varieties live in the
// `variety_allocations` jsonb (docs/supabase-schema.md §3.8).
// ---------------------------------------------------------------------------

export type YieldBlockInfo = SessionBlockInfo & { varietyAllocations: any };

export async function fetchYieldBlocks(vineyardId: string): Promise<YieldBlockInfo[]> {
  const { data, error } = await supabase
    .from("paddocks")
    .select(
      "id, name, rows, polygon_points, vine_spacing, vine_count_override, row_length_override, row_length_overrides, variety_allocations",
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
      varietyAllocations: p.variety_allocations ?? null,
    } satisfies YieldBlockInfo;
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
//
// A block can be mixed-planted, so one save may produce several variety
// specific results that all belong to the same physical block. Each entry is
// written as its own element of the existing `block_results` array, keeping
// `paddockId` identical and `variety`/`varietyId` discrete — the shape iOS and
// Android already read (they group by paddockId and display `paddockName`).
// ---------------------------------------------------------------------------

export interface ActualYieldVarietyEntry {
  variety?: string | null;
  varietyId?: string | null;
  actualYieldTonnes: number;
  /** Share of the block area attributed to this variety (hectares). */
  areaHectares?: number | null;
}

export interface RecordActualYieldInput {
  vineyardId: string;
  year: number;
  season?: string | null;
  blockId: string;
  blockName: string;
  areaHectares?: number | null;
  vineCount?: number | null;
  notes?: string | null;
  /** One entry per harvested variety in the block (at least one). */
  varieties: ActualYieldVarietyEntry[];
}

export async function recordActualYield(input: RecordActualYieldInput): Promise<void> {
  const now = new Date().toISOString();
  const entries = (input.varieties ?? []).filter(
    (e) => Number.isFinite(e.actualYieldTonnes) && e.actualYieldTonnes >= 0,
  );
  if (!entries.length) throw new Error("No variety yields to record");

  const blockArea = input.areaHectares && input.areaHectares > 0 ? input.areaHectares : 0;

  const blockResults = entries.map((e) => {
    const variety = (e.variety ?? "").trim();
    const area = e.areaHectares && e.areaHectares > 0 ? e.areaHectares : 0;
    return {
      paddockId: input.blockId,
      paddockName: variety ? `${input.blockName} — ${variety}` : input.blockName,
      // Block identity and harvested variety are preserved discretely as well as
      // in the display label, so iOS/Android can group by block × variety.
      blockName: input.blockName,
      variety: variety || null,
      varietyId: e.varietyId ?? null,
      areaHectares: area,
      yieldTonnes: e.actualYieldTonnes,
      yieldPerHectare: area > 0 ? e.actualYieldTonnes / area : 0,
      averageBunchesPerVine: 0,
      averageBunchWeightGrams: 0,
      totalVines: input.vineCount ?? 0,
      samplesRecorded: 0,
      damageFactor: 1.0,
      actualYieldTonnes: e.actualYieldTonnes,
      actualRecordedAt: now,
    };
  });

  const totalTonnes = blockResults.reduce((a, b) => a + b.yieldTonnes, 0);
  const summedArea = blockResults.reduce((a, b) => a + b.areaHectares, 0);

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? null;

  const { error } = await (supabase as any).from("historical_yield_records").insert({
    vineyard_id: input.vineyardId,
    season: (input.season ?? "").trim(),
    year: input.year,
    archived_at: now,
    block_results: blockResults,
    total_yield_tonnes: totalTonnes,
    total_area_hectares: blockArea || summedArea,
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
  variety: string | null;
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
        variety: null,
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
        blockName: String(b?.blockName ?? b?.block_name ?? b?.paddockName ?? b?.paddock_name ?? "Unnamed block"),
        variety: (b?.variety ?? b?.variety_name ?? b?.varietyName ?? null) as string | null,
        areaHa,
        yieldTonnes,
        yieldPerHa: yieldTonnes != null && areaHa ? yieldTonnes / areaHa : null,
        archivedAt: r.archived_at ?? null,
      });
    }
  }
  return rows;
}
