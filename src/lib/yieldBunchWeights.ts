// Master bunch weights (live table public.yield_bunch_weights + RPCs).
//
//   paddock_id NULL  → vineyard-wide VARIETY master
//   paddock_id set   → BLOCK + VARIETY override
//
// Resolution (mirrors resolve_yield_bunch_weight): block + variety override,
// then variety master, else NOT CONFIGURED. There is deliberately no 150 g
// (0.15 kg) production fallback — unknown stays unknown.
//
// Writes go only through upsert_yield_bunch_weight / soft_delete_yield_bunch_weight.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { varietyKeyOf } from "@/lib/grapeAllocationModel";
import { resolvePaddockAllocations, type GrapeVarietyMap } from "@/lib/varietyResolver";

export const YIELD_BUNCH_WEIGHTS_KEY = "yield_bunch_weights";

export interface YieldBunchWeightRow {
  id: string;
  vineyard_id: string;
  paddock_id: string | null;
  variety_key: string;
  variety_name: string | null;
  bunch_weight_grams: number;
  updated_at: string | null;
}

export type BunchWeightSource = "block_override" | "variety_default" | "not_configured";
export type BlockBunchWeightSource = BunchWeightSource | "mixed" | "unavailable";

export interface ResolvedBunchWeight {
  grams: number | null;
  source: BunchWeightSource;
  recordId: string | null;
}

export interface ResolvedBlockBunchWeight {
  grams: number | null;
  source: BlockBunchWeightSource;
}

export const BUNCH_WEIGHT_SOURCE_LABEL: Record<BlockBunchWeightSource, string> = {
  block_override: "Block override",
  variety_default: "Variety master",
  mixed: "Block override + Variety master",
  not_configured: "Not configured",
  unavailable: "Unavailable (weights not loaded)",
};

const WRITE_ROLES = new Set(["owner", "manager", "supervisor"]);
export const canEditBunchWeights = (role: string | null | undefined) =>
  WRITE_ROLES.has(String(role ?? "").toLowerCase());

/** DB canonical form (upsert/resolve RPCs use lower(btrim(p_variety_key))). */
export const canonicalVarietyKey = (k: string | null | undefined) => String(k ?? "").trim().toLowerCase();

export const BUNCH_WEIGHT_PAGE_SIZE = 1000;

/** Thrown when a read is partial, inconsistent or outside the requested vineyard. */
export class BunchWeightReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BunchWeightReadError";
  }
}

/**
 * Reads EVERY active row for one vineyard: stable (id) ordering, exact count,
 * paged so no server page limit can truncate it. The result is rejected —
 * never partially returned — if the pages don't add up to the exact count,
 * an id repeats, a row belongs to another vineyard, or a stored key isn't in
 * canonical lower+trim form.
 */
export async function fetchYieldBunchWeights(
  vineyardId: string,
  pageSize = BUNCH_WEIGHT_PAGE_SIZE,
): Promise<YieldBunchWeightRow[]> {
  const want = vineyardId.toLowerCase();
  const out: YieldBunchWeightRow[] = [];
  const seen = new Set<string>();
  let expected: number | null = null;
  for (let from = 0; ; from += pageSize) {
    const { data, error, count } = await (supabase as any)
      .from("yield_bunch_weights")
      .select("id, vineyard_id, paddock_id, variety_key, variety_name, bunch_weight_grams, updated_at", {
        count: "exact",
      })
      .eq("vineyard_id", vineyardId)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (typeof count !== "number") throw new BunchWeightReadError("Bunch weight read returned no exact count.");
    if (expected == null) expected = count;
    else if (count !== expected) throw new BunchWeightReadError("Bunch weights changed while loading; refresh to retry.");
    const page = (data ?? []) as any[];
    for (const r of page) {
      const id = String(r.id ?? "").toLowerCase();
      if (!id || seen.has(id)) throw new BunchWeightReadError("Bunch weight read returned a repeated row.");
      if (String(r.vineyard_id ?? "").toLowerCase() !== want)
        throw new BunchWeightReadError("Bunch weight read returned a row from another vineyard.");
      const key = String(r.variety_key ?? "");
      if (!key || canonicalVarietyKey(key) !== key)
        throw new BunchWeightReadError("Bunch weight read returned a non-canonical variety key.");
      seen.add(id);
      out.push({ ...r, bunch_weight_grams: Number(r.bunch_weight_grams) });
    }
    if (out.length > expected) throw new BunchWeightReadError("Bunch weight read returned more rows than counted.");
    if (out.length === expected) return out;
    if (page.length < pageSize) throw new BunchWeightReadError("Bunch weight read was incomplete; refresh to retry.");
  }
}

export function useYieldBunchWeights(vineyardId: string | null | undefined) {
  return useQuery({
    queryKey: [YIELD_BUNCH_WEIGHTS_KEY, vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchYieldBunchWeights(vineyardId!),
  });
}

export type BunchWeightReadStatus = "idle" | "loading" | "unavailable" | "stale" | "current";

/**
 * One status for every consumer. "stale" = last confirmed rows kept after a
 * failed refetch (must be labelled as such); "unavailable" = no confirmed rows.
 */
export function bunchWeightReadStatus(q: {
  data?: unknown;
  isError?: boolean;
  isLoading?: boolean;
  fetchStatus?: string;
}): BunchWeightReadStatus {
  if (q.data) return q.isError ? "stale" : "current";
  if (q.isError) return "unavailable";
  if (q.isLoading) return "loading";
  return "idle";
}

/** Rows usable for resolution; null means weights are unknown (not "not configured"). */
export function usableBunchWeightRows(
  status: BunchWeightReadStatus,
  data: YieldBunchWeightRow[] | undefined,
): YieldBunchWeightRow[] | null {
  return status === "current" || status === "stale" ? data ?? null : null;
}

export const UNAVAILABLE_BLOCK_WEIGHT: ResolvedBlockBunchWeight = { grams: null, source: "unavailable" };

export async function upsertYieldBunchWeight(input: {
  vineyardId: string;
  paddockId: string | null;
  varietyKey: string;
  varietyName: string | null;
  grams: number;
}): Promise<void> {
  const { error } = await (supabase as any).rpc("upsert_yield_bunch_weight", {
    p_vineyard_id: input.vineyardId,
    p_paddock_id: input.paddockId,
    p_variety_key: input.varietyKey,
    p_variety_name: input.varietyName,
    p_bunch_weight_grams: input.grams,
  });
  if (error) throw error;
}

export async function softDeleteYieldBunchWeight(id: string): Promise<void> {
  const { error } = await (supabase as any).rpc("soft_delete_yield_bunch_weight", { p_id: id });
  if (error) throw error;
}

/** One planting's bunch-weight identity, taken from paddocks.variety_allocations. */
export interface BlockVarietyIdentity {
  /** Stored canonical varietyKey (authority). */
  key: string;
  name: string;
  percent: number | null;
  /**
   * True ONLY when the allocation has no stored varietyKey (genuinely legacy
   * data). The key is then derived from the display name as an explicit,
   * flagged compatibility fallback. A stored key is never replaced.
   */
  legacyKey: boolean;
}

export function blockVarietyIdentities(
  varietyAllocations: unknown,
  varietyMap: GrapeVarietyMap,
): BlockVarietyIdentity[] {
  const out: BlockVarietyIdentity[] = [];
  for (const a of resolvePaddockAllocations(varietyAllocations, varietyMap)) {
    const raw = (a.raw ?? {}) as any;
    const stored = String(raw.varietyKey ?? raw.variety_key ?? "").trim();
    const name = a.name ?? raw.name ?? raw.varietyName ?? raw.variety ?? null;
    if (stored) {
      out.push({ key: stored, name: name ?? stored, percent: a.percent ?? null, legacyKey: false });
    } else if (name) {
      out.push({ key: varietyKeyOf(name), name, percent: a.percent ?? null, legacyKey: true });
    }
  }
  return out;
}

const valid = (g: unknown): g is number => typeof g === "number" && Number.isFinite(g) && g > 0;

/**
 * Block + variety override, then variety master, else not configured.
 * Matching is by canonical variety_key (lower+trim, as the DB RPCs) — never by display name.
 */
export function resolveBunchWeight(
  rows: YieldBunchWeightRow[],
  blockId: string | null,
  varietyKey: string | null | undefined,
): ResolvedBunchWeight {
  const vk = canonicalVarietyKey(varietyKey);
  const bk = blockId ? blockId.toLowerCase() : null;
  // Newest first (then id) so duplicate active rows resolve deterministically
  // instead of depending on PostgREST row order.
  const sameVariety = vk
    ? rows
        .filter((r) => canonicalVarietyKey(r.variety_key) === vk && valid(r.bunch_weight_grams))
        .sort(
          (a, b) =>
            String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")) ||
            String(a.id).localeCompare(String(b.id)),
        )
    : [];
  const override = bk ? sameVariety.find((r) => r.paddock_id?.toLowerCase() === bk) : undefined;
  if (override) return { grams: override.bunch_weight_grams, source: "block_override", recordId: override.id };
  const master = sameVariety.find((r) => r.paddock_id == null);
  if (master) return { grams: master.bunch_weight_grams, source: "variety_default", recordId: master.id };
  return { grams: null, source: "not_configured", recordId: null };
}

/**
 * One weight for a whole block (a trip records bunches per block). A
 * single-variety block uses that variety's weight. A mixed block uses the
 * planting-share-weighted mean, and only when EVERY variety is configured —
 * otherwise it is not configured (never partially guessed).
 */
export function resolveBlockBunchWeight(
  rows: YieldBunchWeightRow[],
  blockId: string,
  varieties: { key: string; percent?: number | null }[],
): ResolvedBlockBunchWeight {
  const keyed = varieties.filter((v) => v.key);
  if (!keyed.length) return { grams: null, source: "not_configured" };
  const resolved = keyed.map((v) => ({ ...resolveBunchWeight(rows, blockId, v.key), percent: v.percent }));
  if (resolved.some((r) => r.grams == null)) return { grams: null, source: "not_configured" };
  const sources = new Set(resolved.map((r) => r.source));
  const source: BlockBunchWeightSource = sources.size === 1 ? resolved[0].source : "mixed";
  if (resolved.length === 1) return { grams: resolved[0].grams, source };
  const pcts = resolved.map((r) => (r.percent != null && r.percent > 0 ? r.percent : 0));
  const sum = pcts.reduce((a, b) => a + b, 0);
  const grams =
    sum > 0
      ? resolved.reduce((a, r, i) => a + (r.grams as number) * pcts[i], 0) / sum
      : resolved.reduce((a, r) => a + (r.grams as number), 0) / resolved.length;
  return { grams, source };
}
