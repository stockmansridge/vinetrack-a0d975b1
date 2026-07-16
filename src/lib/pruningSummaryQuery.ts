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
import { IOS_SUPABASE_URL, iosSupabase } from "@/integrations/ios-supabase/client";

export interface PruningVineyardSummaryBlock {
  paddock_id: string;
  paddock_name?: string | null;
  season_id?: string | null;
  row_count?: number | null;
  total_vines?: number | null;
  vines_pruned?: number | null;
  vines_remaining?: number | null;
  total_row_equivalents?: number | null;
  completed_row_equivalents?: number | null;
  progress?: number | null;                 // 0..1
  estimated_completion_date?: string | null; // yyyy-mm-dd
  status?: string | null;                    // complete | at_risk | on_track | overdue | in_progress | not_started
  due_date?: string | null;
  raw: any;
}

export interface PruningVineyardSummaryDiagnostics {
  projectUrl: string;
  request: {
    vineyardId: string;
    seasonYear: number;
    seasonYearType: string;
  };
  rawData: any;
  rawError: any;
  responseKind: "object" | "one-element-array" | "array" | "null" | "other";
  fieldNames: string[];
  blockArrayFieldName: "blocks";
  blockCount: number;
  blockFieldNames: string[];
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
  diagnostics: PruningVineyardSummaryDiagnostics;
  // Raw untouched RPC payload — kept for forward compatibility and
  // debugging. UI must prefer the normalised fields above.
  raw: any;
}

function responseKind(data: any): PruningVineyardSummaryDiagnostics["responseKind"] {
  if (data == null) return "null";
  if (Array.isArray(data)) return data.length === 1 ? "one-element-array" : "array";
  if (typeof data === "object") return "object";
  return "other";
}

function assertObject(raw: any): asserts raw is Record<string, any> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Unexpected pruning summary RPC response: expected an object payload");
  }
}

function requireField<T = any>(raw: Record<string, any>, key: string): T {
  if (!(key in raw)) {
    throw new Error(`Unexpected pruning summary RPC response: missing required field ${key}`);
  }
  return raw[key] as T;
}

function numRequired(raw: Record<string, any>, key: string): number {
  const n = Number(requireField(raw, key));
  if (!Number.isFinite(n)) {
    throw new Error(`Unexpected pruning summary RPC response: field ${key} is not numeric`);
  }
  return n;
}

function normaliseRpcStatus(status: any): string | null {
  if (status == null) return null;
  const s = String(status).trim();
  if (!s) return null;
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

/** SQL 115 exact installed contract, verified from live network response:
 *  object payload with top-level `blocks`, `vines_pruned`,
 *  `completion_fraction`, and row-equivalent totals. Missing contract fields
 *  are errors, not legitimate zero values. */
function normalise(data: any, error: any, vineyardId: string, seasonYear: number): PruningVineyardSummary {
  const kind = responseKind(data);
  const raw = Array.isArray(data) ? data[0] : data;
  assertObject(raw);

  const blocksRaw = requireField<any[]>(raw, "blocks");
  if (!Array.isArray(blocksRaw)) {
    throw new Error("Unexpected pruning summary RPC response: blocks is not an array");
  }

  const requiredTopLevel = [
    "vineyard_id",
    "season_year",
    "total_vines",
    "vines_pruned",
    "vines_remaining",
    "completion_fraction",
    "completed_row_equivalents",
    "total_row_equivalents",
  ];
  for (const key of requiredTopLevel) requireField(raw, key);

  const numOrNull = (v: any): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const completedRE = numRequired(raw, "completed_row_equivalents");
  const totalRE = numRequired(raw, "total_row_equivalents");
  const overall = numRequired(raw, "completion_fraction");

  const blocks: PruningVineyardSummaryBlock[] = blocksRaw.map((b: any, index) => {
    assertObject(b);
    for (const key of ["paddock_id", "total_vines", "vines_pruned", "total_row_equivalents", "completed_row_equivalents", "status"]) {
      requireField(b, `blocks[${index}].${key}`.replace(/^blocks\[\d+\]\./, ""));
    }
    const blockCompleted = Number(b.completed_row_equivalents);
    const blockTotal = Number(b.total_row_equivalents);
    return {
      paddock_id: String(b.paddock_id).toLowerCase(),
      paddock_name: b.name ?? null,
      season_id: b.season_id ?? null,
      row_count: numOrNull(b.row_count),
      total_vines: numOrNull(b.total_vines),
      vines_pruned: numOrNull(b.vines_pruned),
      vines_remaining: numOrNull(b.vines_remaining),
      total_row_equivalents: numOrNull(b.total_row_equivalents),
      completed_row_equivalents: numOrNull(b.completed_row_equivalents),
      progress: Number.isFinite(blockCompleted) && Number.isFinite(blockTotal) && blockTotal > 0
        ? blockCompleted / blockTotal
        : null,
      estimated_completion_date: b.projected_completion_date ?? null,
      status: normaliseRpcStatus(b.status),
      due_date: b.due_date ?? null,
      raw: b,
    };
  });

  const diagnostics: PruningVineyardSummaryDiagnostics = {
    projectUrl: IOS_SUPABASE_URL,
    request: {
      vineyardId,
      seasonYear,
      seasonYearType: typeof seasonYear,
    },
    rawData: data,
    rawError: error,
    responseKind: kind,
    fieldNames: Object.keys(raw),
    blockArrayFieldName: "blocks",
    blockCount: blocksRaw.length,
    blockFieldNames: blocksRaw[0] && typeof blocksRaw[0] === "object" ? Object.keys(blocksRaw[0]) : [],
  };

  return {
    vineyard_id: String(raw.vineyard_id),
    season_year: Number(raw.season_year),
    overall_progress: overall,
    total_row_equivalents: totalRE,
    completed_row_equivalents: completedRE,
    total_vines: numRequired(raw, "total_vines"),
    vines_pruned: numRequired(raw, "vines_pruned"),
    vines_remaining: numRequired(raw, "vines_remaining"),
    vines_per_day: numOrNull(raw.vines_per_day),
    vines_per_labour_hour: numOrNull(raw.vines_per_labour_hour),
    blocks_complete: numOrNull(raw.blocks_complete) ?? 0,
    blocks_at_risk: numOrNull(raw.blocks_at_risk) ?? 0,
    blocks_total: numOrNull(raw.blocks_total) ?? blocks.length,
    projected_completion_date: raw.projected_completion_date ?? null,
    blocks,
    diagnostics,
    raw,
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
      const { data, error } = await (iosSupabase as any).rpc("get_pruning_vineyard_summary", {
        p_vineyard_id: vineyardId,
        p_season_year: seasonYear,
      });
      if (error) throw error;
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug("[pruning] summary RPC", { vineyardId, seasonYear, type: typeof seasonYear, data, error });
      }
      return normalise(data, error, vineyardId!, seasonYear!);
    },
  });
}
