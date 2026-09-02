// Canonical seasonal base-estimate contract (SQL 221).
//
// The DATABASE is the only authority for the base (pre-bunch-sampling) yield
// estimate: `get_season_yield_base_overview(p_vineyard_id, p_vintage)` returns
// vintage-scoped block and variety rows built from the shared Pruning Yield
// Calculator inputs. The Portal never re-derives an estimate from settings.
//
// The Portal keeps ONE thing of its own: the existing area-weighted Damage
// Adjustment engine (`lib/damageImpact`). The database deliberately does not
// return damage-adjusted numbers, so this module applies the Portal engine to
// the DB base estimates — block first, then aggregates varieties and totals.
//
// Unknown is NEVER zero: a block or variety whose base estimate could not be
// calculated reports `tonnes === null` plus the DB's `setup_warnings`, and the
// UI must render "—" for it.

export interface SeasonYieldGroupRow {
  estimate_id?: string | null;
  variety_key?: string | null;
  variety_name?: string | null;
  clone?: string | null;
  rootstock?: string | null;
  planting_group_key?: string | null;
  variety_allocation_ids?: string[] | null;
  allocation_percent?: number | null;
  is_unallocated?: boolean | null;
  base_estimate_tonnes?: number | null;
  is_estimate_available?: boolean | null;
  setup_warnings?: string[] | null;
  estimate_source?: string | null;
  calculated_at?: string | null;
  source_session_id?: string | null;
}

export interface SeasonYieldBlockRow {
  paddock_id: string;
  block_name?: string | null;
  area_hectares?: number | null;
  groups?: SeasonYieldGroupRow[] | null;
  base_estimate_tonnes?: number | null;
  known_base_estimate_tonnes?: number | null;
  is_estimate_available?: boolean | null;
  is_estimate_complete?: boolean | null;
  has_estimates?: boolean | null;
  setup_warnings?: string[] | null;
  estimate_source?: string | null;
  calculated_at?: string | null;
  source_inputs?: Record<string, unknown> | null;
}

export interface SeasonYieldVarietyRow {
  variety_key?: string | null;
  variety_name?: string | null;
  variety_identity?: string | null;
  planting_group_keys?: string[] | null;
  paddock_ids?: string[] | null;
  is_unallocated?: boolean | null;
  base_estimate_tonnes?: number | null;
  known_base_estimate_tonnes?: number | null;
  is_estimate_available?: boolean | null;
  is_estimate_complete?: boolean | null;
}

/** Exact payload returned by `get_season_yield_base_overview`. */
export interface SeasonYieldBaseOverview {
  vineyard_id: string;
  vintage: number;
  blocks?: SeasonYieldBlockRow[] | null;
  varieties?: SeasonYieldVarietyRow[] | null;
  blocks_total?: number | null;
  blocks_available?: number | null;
  blocks_unavailable?: number | null;
  blocks_with_estimates?: number | null;
  blocks_missing_estimates?: number | null;
  is_estimate_complete?: boolean | null;
  base_estimate_tonnes?: number | null;
  total_base_estimate_tonnes?: number | null;
  known_base_estimate_tonnes?: number | null;
  setup_warnings?: string[] | null;
  estimate_source?: string | null;
  calculated_at?: string | null;
  source_inputs?: Record<string, unknown> | null;
}

export interface SeasonYieldGroupEstimate {
  varietyKey: string | null;
  varietyName: string | null;
  clone: string | null;
  rootstock: string | null;
  plantingGroupKey: string | null;
  allocationIds: string[];
  allocationPercent: number | null;
  /** DB base estimate — null when unknown (never 0). */
  baseTonnes: number | null;
  /** Base after the Portal damage engine (equals base when damage is off). */
  tonnes: number | null;
  isAvailable: boolean;
  warnings: string[];
}

export interface SeasonYieldBlockEstimate {
  paddockId: string;
  blockName: string | null;
  areaHa: number | null;
  baseTonnes: number | null;
  /** Damage-adjusted estimate for the block (null when unknown). */
  tonnes: number | null;
  /** 0–100 block loss from the Portal damage engine for this vintage. */
  damageLossPct: number;
  damageRecordCount: number;
  damageApplied: boolean;
  isAvailable: boolean;
  isComplete: boolean;
  warnings: string[];
  estimateSource: string | null;
  calculatedAt: string | null;
  sourceInputs: Record<string, unknown> | null;
  groups: SeasonYieldGroupEstimate[];
}

export interface SeasonYieldVarietyEstimate {
  varietyKey: string;
  varietyName: string | null;
  /** Null while any contributing planting is missing an estimate. */
  tonnes: number | null;
  /** Sum of the plantings that DO have an estimate. */
  knownTonnes: number;
  isComplete: boolean;
  warnings: string[];
}

export interface SeasonYieldEstimateModel {
  vintage: number | null;
  applyDamage: boolean;
  blocks: SeasonYieldBlockEstimate[];
  varieties: SeasonYieldVarietyEstimate[];
  /** Total across all blocks — null unless every block has an estimate. */
  totalTonnes: number | null;
  knownTonnes: number;
  isComplete: boolean;
  blocksTotal: number;
  blocksAvailable: number;
  blocksMissing: number;
  warnings: string[];
  calculatedAt: string | null;
}

export const SETUP_WARNING_LABELS: Record<string, string> = {
  missing_pruning_settings: "Pruning Yield Calculator inputs not set for this block",
  missing_vine_count: "Vine count / vines per hectare not set",
  missing_area: "Block area not set",
  missing_bunch_weight: "Average bunch weight not set",
  missing_variety_allocations: "No variety allocation configured",
  allocation_percent_normalized: "Variety allocation percentages did not total 100% and were normalised",
  no_estimate: "No base estimate has been calculated yet",
};

export const setupWarningLabel = (code: string): string =>
  SETUP_WARNING_LABELS[code] ??
  code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const uniq = (list: string[]): string[] => Array.from(new Set(list.filter(Boolean)));

/** 0–100 loss per paddock, from the Portal damage engine. */
export interface BlockDamage {
  lossPct: number;
  recordCount: number;
}

/**
 * Apply the Portal damage engine to the canonical DB base estimates and
 * aggregate blocks → varieties → totals.
 *
 * Damage is applied at BLOCK level (the engine is area-weighted against block
 * area) and then flows proportionally into that block's plantings, so variety
 * totals and Grape Allocation availability always reconcile to the blocks.
 */
export function buildSeasonYieldEstimates(args: {
  overview: SeasonYieldBaseOverview | null | undefined;
  /** Vintage-filtered damage per paddock id. Ignored when applyDamage is false. */
  damageByBlock?: Map<string, BlockDamage> | null;
  applyDamage: boolean;
}): SeasonYieldEstimateModel {
  const { overview, applyDamage } = args;
  const damageByBlock = args.damageByBlock ?? new Map<string, BlockDamage>();

  const blocks: SeasonYieldBlockEstimate[] = (overview?.blocks ?? []).map((b) => {
    const damage = damageByBlock.get(b.paddock_id);
    const lossPct = applyDamage ? Math.max(0, Math.min(100, damage?.lossPct ?? 0)) : 0;
    const factor = 1 - lossPct / 100;

    const groups: SeasonYieldGroupEstimate[] = (b.groups ?? []).map((g) => {
      const base = g.is_estimate_available === false ? null : num(g.base_estimate_tonnes);
      return {
        varietyKey: g.variety_key ?? null,
        varietyName: g.variety_name ?? null,
        clone: g.clone ?? null,
        rootstock: g.rootstock ?? null,
        plantingGroupKey: g.planting_group_key ?? null,
        allocationIds: (g.variety_allocation_ids ?? []).filter(Boolean) as string[],
        allocationPercent: num(g.allocation_percent),
        baseTonnes: base,
        tonnes: base == null ? null : base * factor,
        isAvailable: base != null,
        warnings: uniq(g.setup_warnings ?? []),
      };
    });

    const blockBase =
      b.is_estimate_available === false ? null : num(b.base_estimate_tonnes);
    const groupsAvailable = groups.length > 0 && groups.every((g) => g.isAvailable);
    const base = blockBase ?? (groupsAvailable ? groups.reduce((a, g) => a + (g.baseTonnes ?? 0), 0) : null);

    return {
      paddockId: b.paddock_id,
      blockName: b.block_name ?? null,
      areaHa: num(b.area_hectares),
      baseTonnes: base,
      tonnes: base == null ? null : base * factor,
      damageLossPct: lossPct,
      damageRecordCount: damage?.recordCount ?? 0,
      damageApplied: applyDamage && lossPct > 0,
      isAvailable: base != null,
      isComplete: b.is_estimate_complete !== false && base != null,
      warnings: uniq(b.setup_warnings ?? []),
      estimateSource: b.estimate_source ?? null,
      calculatedAt: b.calculated_at ?? null,
      sourceInputs: (b.source_inputs as Record<string, unknown> | null) ?? null,
      groups,
    };
  });

  // Varieties are aggregated from the block plantings so damage always flows
  // through. A variety is only "complete" when every planting has an estimate.
  const varietyMap = new Map<string, SeasonYieldVarietyEstimate>();
  for (const b of blocks) {
    for (const g of b.groups) {
      const key = (g.varietyKey ?? g.varietyName ?? "").trim().toLowerCase();
      if (!key) continue;
      const row =
        varietyMap.get(key) ??
        ({
          varietyKey: key,
          varietyName: g.varietyName ?? null,
          tonnes: 0,
          knownTonnes: 0,
          isComplete: true,
          warnings: [],
        } as SeasonYieldVarietyEstimate);
      if (g.isAvailable) {
        row.knownTonnes += g.tonnes ?? 0;
      } else {
        row.isComplete = false;
        row.warnings = uniq([...row.warnings, ...g.warnings, ...b.warnings]);
      }
      if (!row.varietyName && g.varietyName) row.varietyName = g.varietyName;
      varietyMap.set(key, row);
    }
  }
  const varieties = Array.from(varietyMap.values())
    .map((v) => ({ ...v, tonnes: v.isComplete ? v.knownTonnes : null }))
    .sort((a, b) => (a.varietyName ?? a.varietyKey).localeCompare(b.varietyName ?? b.varietyKey));

  const blocksAvailable = blocks.filter((b) => b.isAvailable).length;
  const knownTonnes = blocks.reduce((a, b) => a + (b.tonnes ?? 0), 0);
  const isComplete = blocks.length > 0 && blocksAvailable === blocks.length;

  return {
    vintage: overview?.vintage ?? null,
    applyDamage,
    blocks,
    varieties,
    totalTonnes: isComplete ? knownTonnes : null,
    knownTonnes,
    isComplete,
    blocksTotal: blocks.length,
    blocksAvailable,
    blocksMissing: blocks.length - blocksAvailable,
    warnings: uniq([
      ...(overview?.setup_warnings ?? []),
      ...blocks.flatMap((b) => b.warnings),
    ]),
    calculatedAt: overview?.calculated_at ?? null,
  };
}

/** Estimated tonnes per variety for Grape Allocation availability.
 *  Keys use the allocation model's variety key (display name, lowercased) so
 *  availability lines up with stored allocations. Incomplete varieties are
 *  OMITTED so the panel shows "—", never 0 t. */
export function estimatedTonnesByVariety(
  model: SeasonYieldEstimateModel,
  keyOf: (name: string | null) => string = (name) =>
    (name ?? "").trim().toLowerCase(),
): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of model.varieties) {
    if (v.tonnes == null) continue;
    const k = keyOf(v.varietyName ?? v.varietyKey);
    out.set(k, (out.get(k) ?? 0) + v.tonnes);
  }
  return out;
}

/**
 * Split a block-level estimate across that block's plantings.
 *
 * Priority: the DB's own per-planting base estimates (proportional), then the
 * canonical allocation percentages, then an equal split. Used when a Bunch
 * Count Trip supersedes the base estimate for a block — the trip gives one
 * block number, and it must still land on the DB's planting identities.
 */
export function splitBlockEstimateToGroups(
  block: SeasonYieldBlockEstimate,
  blockTonnes: number | null,
): (number | null)[] {
  const groups = block.groups;
  if (!groups.length) return [];
  if (blockTonnes == null) return groups.map(() => null);

  const bases = groups.map((g) => g.baseTonnes);
  const baseSum = bases.reduce<number>((a, b) => a + (b ?? 0), 0);
  if (bases.every((b) => b != null) && baseSum > 0) {
    return bases.map((b) => (blockTonnes * (b as number)) / baseSum);
  }

  const percents = groups.map((g) =>
    g.allocationPercent != null && g.allocationPercent > 0 ? g.allocationPercent : 0,
  );
  const pctSum = percents.reduce((a, b) => a + b, 0);
  if (pctSum > 0) return percents.map((p) => (blockTonnes * p) / pctSum);

  return groups.map(() => blockTonnes / groups.length);
}
