// Additive diagnostics + server-ranking envelope from `chemical-info-lookup`.
//
// Transitional contract (Rork chemical-intelligence handoff):
//
//   * When the response carries server ranking metadata, the portal renders
//     candidates in EXACTLY the order the server supplied. It must not
//     re-sort, float store/saved products, fuzzy-match, or substitute one
//     registration for another.
//   * When the deployed function is older and the metadata is absent, the
//     existing portal behaviour is preserved unchanged.
//   * Diagnostics are troubleshooting data only. They are never surfaced on
//     the normal Chemical screen and never influence lookup, ranking,
//     selection or UI behaviour.
//
// Unknown / future diagnostic fields are tolerated and preserved verbatim.

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s === "" ? undefined : s;
};

const num = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const bool = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;

/* --------------------------------------------------------- ranking rows */

export interface ServerRankingMetadata {
  rankTier?: string;
  rankRelevance?: number;
  rankScore?: number;
  rankReason?: string;
  registerOrder?: number;
}

/** A candidate row exactly as the server ordered it. */
export interface RankedCandidate<T = Record<string, unknown>> {
  /** Zero-based position in the server-supplied order. Never recomputed. */
  index: number;
  ranking: ServerRankingMetadata;
  /** True when this row carried any server ranking field. */
  serverRanked: boolean;
  raw: T;
}

const RANK_KEYS = [
  "rank_tier",
  "rankTier",
  "rank_relevance",
  "rankRelevance",
  "rank_score",
  "rankScore",
  "rank_reason",
  "rankReason",
  "register_order",
  "registerOrder",
];

export function parseRankingMetadata(row: unknown): ServerRankingMetadata {
  const o = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  return {
    rankTier: str(o.rank_tier ?? o.rankTier),
    rankRelevance: num(o.rank_relevance ?? o.rankRelevance),
    rankScore: num(o.rank_score ?? o.rankScore),
    rankReason: str(o.rank_reason ?? o.rankReason),
    registerOrder: num(o.register_order ?? o.registerOrder),
  };
}

export const hasRankingMetadata = (row: unknown): boolean => {
  const o = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  return RANK_KEYS.some((k) => o[k] != null && o[k] !== "");
};

/* ------------------------------------------------------- ranking summary */

export interface RankingSummary {
  ambiguous?: boolean;
  ambiguityReason?: string;
  candidateCount?: number;
  tieBreak?: string;
  /** Any additional summary fields the server sent. */
  extra?: Record<string, unknown>;
}

const SUMMARY_KEYS = [
  "ambiguous",
  "is_ambiguous",
  "ambiguity_reason",
  "ambiguityReason",
  "candidate_count",
  "candidateCount",
  "tie_break",
  "tieBreak",
];

export function parseRankingSummary(payload: unknown): RankingSummary | null {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, any>;
  const raw = root.ranking_summary ?? root.rankingSummary ?? root.ranking;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!SUMMARY_KEYS.includes(k)) extra[k] = v;
  return {
    ambiguous: bool(o.ambiguous ?? o.is_ambiguous),
    ambiguityReason: str(o.ambiguity_reason ?? o.ambiguityReason),
    candidateCount: num(o.candidate_count ?? o.candidateCount),
    tieBreak: str(o.tie_break ?? o.tieBreak),
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

/* ------------------------------------------------------------ envelope */

export interface LookupDiagnostics {
  correlationId?: string;
  requestId?: string;
  resolverVersion?: string;
  model?: string;
  durationMs?: number;
  cacheHit?: boolean;
  /** Every diagnostic field, including unknown/future ones. */
  raw: Record<string, unknown>;
}

const DIAG_KEYS = [
  "correlation_id",
  "correlationId",
  "request_id",
  "requestId",
  "resolver_version",
  "resolverVersion",
  "model",
  "duration_ms",
  "durationMs",
  "cache_hit",
  "cacheHit",
];

export function parseLookupDiagnostics(payload: unknown): LookupDiagnostics | null {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, any>;
  const raw = root.diagnostics ?? root.diagnostic ?? root._diagnostics;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    correlationId: str(o.correlation_id ?? o.correlationId),
    requestId: str(o.request_id ?? o.requestId),
    resolverVersion: str(o.resolver_version ?? o.resolverVersion),
    model: str(o.model),
    durationMs: num(o.duration_ms ?? o.durationMs),
    cacheHit: bool(o.cache_hit ?? o.cacheHit),
    raw: { ...o },
  };
}

/** Unknown diagnostic keys, for troubleshooting views only. */
export function unknownDiagnosticFields(d: LookupDiagnostics | null): string[] {
  if (!d) return [];
  return Object.keys(d.raw).filter((k) => !DIAG_KEYS.includes(k));
}

/* ------------------------------------------------------------ candidates */

function candidateArray(payload: unknown): unknown[] {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, any>;
  for (const key of ["candidates", "results", "matches", "products"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  return [];
}

export interface ServerRankedCandidates<T = Record<string, unknown>> {
  /** True when ANY candidate carried server ranking metadata. */
  serverRanked: boolean;
  /** Server order, preserved exactly. Never re-sorted by the portal. */
  candidates: RankedCandidate<T>[];
  summary: RankingSummary | null;
  diagnostics: LookupDiagnostics | null;
}

/**
 * Decode candidates in server order. When `serverRanked` is false the caller
 * keeps its existing (legacy) behaviour; when it is true the caller MUST
 * render `candidates` in the supplied order without reordering.
 */
export function parseServerRankedCandidates<T = Record<string, unknown>>(
  payload: unknown,
): ServerRankedCandidates<T> {
  const rows = candidateArray(payload);
  const candidates = rows.map((raw, index) => ({
    index,
    ranking: parseRankingMetadata(raw),
    serverRanked: hasRankingMetadata(raw),
    raw: raw as T,
  }));
  return {
    serverRanked: candidates.some((c) => c.serverRanked),
    candidates,
    summary: parseRankingSummary(payload),
    diagnostics: parseLookupDiagnostics(payload),
  };
}
