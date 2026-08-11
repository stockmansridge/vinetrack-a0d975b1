// Allocation-level planting identity for Yields.
//
// A block may contain several allocations of the SAME grape variety that are
// only distinguished by clone / rootstock (e.g. three Pinot Noir plantings).
// Yield must never be duplicated across those plantings, so every display and
// aggregation needs a planting identity rather than Block + Variety alone.
//
// Identity priority (see docs — no schema change is made from the portal):
//   1. Stable allocation id stored on `paddocks.variety_allocations[].id`
//   2. Block + Variety + cloneKey + rootstockKey (catalogue identity)
//   3. Legacy fallback: stored clone / rootstock display snapshots
//
// Picking records (sql/180 `picking_records`) currently store block, variety
// and a clone *display snapshot* only — there is no allocation id, clone_key
// or rootstock_key on the record. Therefore a pick can be matched to an
// allocation only when the clone snapshot resolves to exactly ONE allocation
// of that variety. Anything ambiguous stays "Unallocated within block/variety"
// and is never guessed or duplicated.
import type { ResolvedAllocation } from "@/lib/varietyResolver";

export interface AllocationUnit {
  /** Stable allocation id when the block config has one. */
  id: string | null;
  /** Synthetic, stable-within-block identity used for aggregation. */
  key: string;
  variety: string | null;
  cloneLabel: string | null;
  cloneKey: string | null;
  rootstockLabel: string | null;
  rootstockKey: string | null;
  percent: number | null;
  /** Allocated hectares (block area × allocation share). */
  areaHa: number | null;
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Compact planting label: "Clone 777 · 101-14" (empty parts dropped). */
export function plantingLabel(a: {
  cloneLabel?: string | null;
  rootstockLabel?: string | null;
}): string | null {
  const parts = [a.cloneLabel, a.rootstockLabel]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);
  return parts.length ? parts.join(" · ") : null;
}

/** Full identity label: "Pinot Noir · Clone 777 · 101-14". */
export function allocationLabel(a: {
  variety?: string | null;
  cloneLabel?: string | null;
  rootstockLabel?: string | null;
}): string {
  const planting = plantingLabel(a);
  const variety = (a.variety ?? "").trim() || "Unspecified variety";
  return planting ? `${variety} · ${planting}` : variety;
}

/**
 * Build the allocation units for one block. Hectares are apportioned from the
 * stored allocation percentages so the parts add back to the block area; when
 * no percentages are stored the block area is split evenly (that is the same
 * assumption the rest of the Yield stack already makes).
 */
export function buildAllocationUnits(args: {
  blockId: string;
  areaHa?: number | null;
  allocations: ResolvedAllocation[];
}): AllocationUnit[] {
  const { blockId, allocations } = args;
  const area = typeof args.areaHa === "number" && args.areaHa > 0 ? args.areaHa : null;
  const percents = allocations.map((a) =>
    typeof a.percent === "number" && a.percent > 0 ? a.percent : 0,
  );
  const sum = percents.reduce((x, y) => x + y, 0);

  return allocations.map((a, i) => {
    const cloneKey = ((a.raw as any)?.cloneKey ?? (a.raw as any)?.clone_key ?? null) as string | null;
    const rootstockKey = ((a.raw as any)?.rootstockKey ??
      (a.raw as any)?.rootstock_key ??
      (a.raw as any)?.root_stock_key ??
      null) as string | null;
    const share =
      area == null
        ? null
        : sum > 0
        ? (area * percents[i]) / sum
        : area / (allocations.length || 1);
    const identity =
      a.id ??
      [norm(a.name), norm(cloneKey ?? a.clone), norm(rootstockKey ?? a.rootstock)].join("|");
    return {
      id: a.id ?? null,
      key: `${blockId}::${identity}::${i}`,
      variety: (a.name ?? "").trim() || null,
      cloneLabel: (a.clone ?? "").trim() || null,
      cloneKey,
      rootstockLabel: (a.rootstock ?? "").trim() || null,
      rootstockKey,
      percent: typeof a.percent === "number" ? a.percent : null,
      areaHa: share,
    } satisfies AllocationUnit;
  });
}

export interface AllocationMatch {
  /** Matched allocation key, or null when it cannot be resolved safely. */
  key: string | null;
  reason:
    | "planting-group-key"
    | "allocation-id"
    | "single-variety-allocation"
    | "clone-snapshot"
    | "ambiguous"
    | "no-variety-match"
    | "no-allocations";
}

export interface AllocationMatchHints {
  /** Authoritative planting-group key stored on the record (sql/184). */
  plantingGroupKey?: string | null;
  /** Member `variety_allocations[].id` values stored with the record. */
  allocationIds?: string[] | null;
  /** Rootstock display snapshot, when the record carries one. */
  rootstock?: string | null;
}

/**
 * Resolve one harvest record to a planting.
 *
 * The stored planting-group key wins outright; member allocation ids are the
 * next authority. Without either, the clone (and rootstock) snapshots are used
 * and anything still ambiguous is reported as such — the caller shows
 * "Planting not linked" rather than guessing or duplicating the harvest.
 */
export function matchAllocation(
  units: AllocationUnit[],
  variety: string | null | undefined,
  clone: string | null | undefined,
  hints: AllocationMatchHints = {},
): AllocationMatch {
  if (!units.length) return { key: null, reason: "no-allocations" };
  const groupKey = norm(hints.plantingGroupKey);
  if (groupKey) {
    const byGroup = units.find((u) => plantingGroupIdentity(u) === groupKey);
    if (byGroup) return { key: byGroup.key, reason: "planting-group-key" };
  }
  const ids = (hints.allocationIds ?? []).map(norm).filter(Boolean);
  if (ids.length) {
    // Works for physical allocations and for planting groups, which carry every
    // member allocation id so a section-level id still resolves to its group.
    const byId = units.find(
      (u) =>
        ids.includes(norm(u.id)) ||
        ((u as PlantingGroup).allocationIds ?? []).some((id) => ids.includes(norm(id))),
    );
    if (byId) return { key: byId.key, reason: "allocation-id" };
  }
  const v = norm(variety);
  const candidates = v ? units.filter((u) => norm(u.variety) === v) : units.slice();
  if (!candidates.length) return { key: null, reason: "no-variety-match" };
  if (candidates.length === 1) {
    return { key: candidates[0].key, reason: "single-variety-allocation" };
  }
  const c = norm(clone);
  let byClone = candidates.filter((u) => norm(u.cloneLabel) === c || norm(u.cloneKey) === c);
  const rs = norm(hints.rootstock);
  if (byClone.length > 1 && rs) {
    const byRootstock = byClone.filter(
      (u) => norm(u.rootstockLabel) === rs || norm(u.rootstockKey) === rs,
    );
    if (byRootstock.length) byClone = byRootstock;
  }
  if (byClone.length === 1) return { key: byClone[0].key, reason: "clone-snapshot" };
  return { key: null, reason: "ambiguous" };
}


/**
 * Selectable planting label. Allocated area is included because two plantings
 * of the same variety may share clone AND rootstock — the area (and the stable
 * allocation id behind the option) is what keeps them distinguishable.
 */
export function allocationOptionLabel(
  u: AllocationUnit,
  areaUnitLabel = "ha",
): string {
  const parts = [u.variety?.trim() || "Unspecified variety", u.cloneLabel, u.rootstockLabel]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  if (u.areaHa != null && u.areaHa > 0) {
    parts.push(`${Number(u.areaHa).toFixed(2)} ${areaUnitLabel}`);
  } else if (u.percent != null) {
    parts.push(`${u.percent}%`);
  }
  return parts.join(" · ");
}


// ---------------------------------------------------------------------------
// Planting groups (production reporting unit)
//
// A physical `variety_allocations[]` entry is a configuration section, NOT a
// reporting unit. Two sections of the same Variety + Clone + Rootstock in the
// same block are analytically one planting and must be reported (and picked)
// as one group with the summed hectares. Block Setup keeps showing every
// physical section — this grouping applies to Yield reporting and Picking
// selection only.
//
// Identity: block + variety + clone identity + rootstock identity, using the
// stable catalogue keys when present and the display snapshots as fallback.
// ---------------------------------------------------------------------------

export interface PlantingGroup extends AllocationUnit {
  /** Canonical, block-scoped `planting_group_key` written on picking records. */
  groupKey: string;
  /** Every physical allocation id behind the group (may be empty for legacy). */
  allocationIds: string[];
  /** Member allocation unit keys (physical sections). */
  memberKeys: string[];
  /** Number of physical sections combined into this group. */
  sectionCount: number;
}


/** Stable, deterministic planting-group key for one block. */
export function plantingGroupIdentity(u: {
  variety?: string | null;
  cloneKey?: string | null;
  cloneLabel?: string | null;
  rootstockKey?: string | null;
  rootstockLabel?: string | null;
}): string {
  return [
    norm(u.variety),
    norm(u.cloneKey || u.cloneLabel),
    norm(u.rootstockKey || u.rootstockLabel),
  ].join("|");
}

/**
 * Combine physical allocations into planting groups. Hectares and percentages
 * are summed so a block's groups always reconcile back to the block total.
 */
export function buildPlantingGroups(units: AllocationUnit[]): PlantingGroup[] {
  const out: PlantingGroup[] = [];
  const byIdentity = new Map<string, PlantingGroup>();
  for (const u of units) {
    const blockId = u.key.split("::")[0] ?? "";
    const identity = plantingGroupIdentity(u);
    const key = `${blockId}::group::${identity}`;
    const existing = byIdentity.get(key);
    if (existing) {
      if (u.areaHa != null) existing.areaHa = (existing.areaHa ?? 0) + u.areaHa;
      if (u.percent != null) existing.percent = (existing.percent ?? 0) + u.percent;
      if (u.id) existing.allocationIds.push(u.id);
      existing.memberKeys.push(u.key);
      existing.sectionCount += 1;
      // Keep the first non-empty display snapshots.
      existing.cloneLabel = existing.cloneLabel ?? u.cloneLabel;
      existing.rootstockLabel = existing.rootstockLabel ?? u.rootstockLabel;
      continue;
    }
    const group: PlantingGroup = {
      id: null,
      key,
      groupKey: identity,

      variety: u.variety,
      cloneLabel: u.cloneLabel,
      cloneKey: u.cloneKey,
      rootstockLabel: u.rootstockLabel,
      rootstockKey: u.rootstockKey,
      percent: u.percent,
      areaHa: u.areaHa,
      allocationIds: u.id ? [u.id] : [],
      memberKeys: [u.key],
      sectionCount: 1,
    };
    byIdentity.set(key, group);
    out.push(group);
  }
  return out;
}

/** Group option label, e.g. "Pinot Noir · Clone 777 · Richter 110 · 1.26 ha · 2 sections". */
export function plantingGroupOptionLabel(g: PlantingGroup, areaUnitLabel = "ha"): string {
  const base = allocationOptionLabel(g, areaUnitLabel);
  return g.sectionCount > 1 ? `${base} · ${g.sectionCount} sections` : base;
}
