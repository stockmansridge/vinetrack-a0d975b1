// SQL 115: server-authoritative pruning summary.
//
// This is the SOLE source of truth for vineyard-level pruning statistics
// (progress, vines, rates, ETA) and per-block totals. Do not recompute
// these numbers on the client — differences between the portal, iOS and
// Android must come from the RPC only.
//
// Local calculation helpers in pruningCalc.ts are retained for
// interactive row-selection previews only (Record Pruning, block-detail
// row grid).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

export interface PruningVineyardSummaryBlock {
  paddock_id: string;
  paddock_name?: string | null;
  total_vines?: number | null;
  vines_pruned?: number | null;
  vines_remaining?: number | null;
  total_row_equivalents?: number | null;
  completed_row_equivalents?: number | null;
  progress?: number | null;                 // 0..1
  estimated_completion_date?: string | null; // yyyy-mm-dd
  status?: string | null;                    // complete | at_risk | on_track | overdue | in_progress | not_started
  due_date?: string | null;
}

export interface PruningVineyardSummary {
  vineyard_id: string;
  season_year: number;
  overall_progress: number;              // 0..1
  total_row_equivalents: number;
  completed_row_equivalents: number;
  total_vines: number;
  vines_pruned: number;
  vines_remaining: number;
  vines_per_day: number | null;
  vines_per_labour_hour: number | null;
  blocks_complete: number;
  blocks_at_risk: number;
  blocks_total: number;
  projected_completion_date: string | null;
  blocks: PruningVineyardSummaryBlock[];
  // Raw untouched RPC payload — kept for forward compatibility and
  // debugging. UI must prefer the normalised fields above.
  raw: any;
}

/** Coerce whatever the RPC returns into the normalised shape. Field
 *  names are read defensively (snake_case first, camelCase second) so
 *  small naming differences in the installed signature don't break the
 *  portal. If a field is missing it falls through as null / 0. */
function normalise(raw: any, vineyardId: string, seasonYear: number): PruningVineyardSummary {
  const r = raw ?? {};
  const pick = <T,>(...keys: string[]): T | null => {
    for (const k of keys) {
      const v = r?.[k];
      if (v !== undefined && v !== null) return v as T;
    }
    return null;
  };
  const num = (v: any): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
  const numOrNull = (v: any): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // Vineyard-level progress is derived directly from the RPC's own
  // row-equivalent totals. Those two fields (completed_row_equivalents /
  // total_row_equivalents) are the same numbers the RPC uses server-side
  // and match iOS/Android exactly, so the ratio can't drift and there's
  // no ambiguity about whether a "progress" field is a fraction (0..1)
  // or a percentage (0..100).
  const completedRE = num(pick("completed_row_equivalents", "row_equivalents_completed", "completedRowEquivalents"));
  const totalRE = num(pick("total_row_equivalents", "totalRowEquivalents"));
  const derivedFraction = totalRE > 0 ? completedRE / totalRE : 0;

  // Read the RPC's own progress field (if present) purely for a
  // dev-mode consistency check. Never used as the display value.
  const rpcProgressRaw = pick<number>(
    "overall_progress_fraction",
    "completion_fraction",
    "progress_fraction",
    "overall_progress",
    "progress",
    "progress_pct",
    "progress_percent",
    "overall_progress_pct",
  );
  if (import.meta.env.DEV && rpcProgressRaw != null) {
    const rpcNum = Number(rpcProgressRaw);
    if (Number.isFinite(rpcNum)) {
      const rpcAsFraction = rpcNum > 1.5 ? rpcNum / 100 : rpcNum;
      if (Math.abs(rpcAsFraction - derivedFraction) > 0.01) {
        // eslint-disable-next-line no-console
        console.warn("[pruning] RPC progress field disagrees with row-equivalent ratio", {
          rpcProgress: rpcNum,
          rpcAsFraction,
          derivedFraction,
          completedRE,
          totalRE,
        });
      }
    }
  }

  const overall = derivedFraction;
  const blocksRaw: any[] = (pick<any[]>("blocks", "block_breakdown", "per_block") ?? []) as any[];
  const blocks: PruningVineyardSummaryBlock[] = blocksRaw.map((b: any) => ({
    paddock_id: b?.paddock_id ?? b?.paddockId ?? b?.id,
    paddock_name: b?.paddock_name ?? b?.name ?? null,
    total_vines: numOrNull(b?.total_vines ?? b?.vines_total ?? b?.totalVines),
    vines_pruned: numOrNull(b?.vines_pruned ?? b?.vines_completed ?? b?.vinesPruned),
    vines_remaining: numOrNull(b?.vines_remaining ?? b?.vinesRemaining),
    total_row_equivalents: numOrNull(b?.total_row_equivalents ?? b?.total_rows ?? b?.totalRowEquivalents),
    completed_row_equivalents: numOrNull(b?.completed_row_equivalents ?? b?.row_equivalents_completed ?? b?.completedRowEquivalents),
    progress: (() => {
      const p = numOrNull(b?.progress ?? b?.progress_pct ?? b?.percent_complete);
      if (p == null) return null;
      return p > 1.5 ? p / 100 : p;
    })(),
    estimated_completion_date: b?.estimated_completion_date ?? b?.eta ?? null,
    status: b?.status ?? b?.due_status ?? null,
    due_date: b?.due_date ?? null,
  }));
  return {
    vineyard_id: vineyardId,
    season_year: seasonYear,
    overall_progress: overall,
    total_row_equivalents: num(pick("total_row_equivalents", "totalRowEquivalents")),
    completed_row_equivalents: num(pick("completed_row_equivalents", "row_equivalents_completed", "completedRowEquivalents")),
    total_vines: num(pick("total_vines", "vines_total", "totalVines")),
    vines_pruned: num(pick("vines_pruned", "vines_completed", "vinesPruned")),
    vines_remaining: num(pick("vines_remaining", "vinesRemaining")),
    vines_per_day: numOrNull(pick("vines_per_day", "vinesPerDay")),
    vines_per_labour_hour: numOrNull(pick("vines_per_labour_hour", "vines_per_hour", "vinesPerLabourHour")),
    blocks_complete: num(pick("blocks_complete", "blocksComplete")),
    blocks_at_risk: num(pick("blocks_at_risk", "blocksAtRisk")),
    blocks_total: num(pick("blocks_total", "total_blocks", "blocksTotal")) || blocks.length,
    projected_completion_date:
      (pick<string>("projected_completion_date", "projected_completion", "vineyard_estimated_completion_date", "eta") as string | null) ??
      null,
    blocks,
    raw: r,
  };
}

export function usePruningVineyardSummary(
  vineyardId: string | null,
  seasonYear: number | null,
) {
  return useQuery({
    // Broad ["pruning", ...] prefix ensures existing pruning mutations
    // (record/reverse/settings) invalidate this hook automatically.
    queryKey: ["pruning", "summary", vineyardId, seasonYear],
    enabled: !!vineyardId && !!seasonYear,
    queryFn: async (): Promise<PruningVineyardSummary> => {
      const { data, error } = await (supabase as any).rpc("get_pruning_vineyard_summary", {
        p_vineyard_id: vineyardId,
        p_season_year: seasonYear,
      });
      if (error) throw error;
      // The RPC may return a single row (object) or an array with one row
      // depending on how it's defined (RETURNS TABLE vs RETURNS record).
      const payload = Array.isArray(data) ? data[0] : data;
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug("[pruning] summary RPC", { vineyardId, seasonYear, payload });
      }
      return normalise(payload, vineyardId!, seasonYear!);
    },
  });
}
