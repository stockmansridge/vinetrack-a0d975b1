// Fertiliser Calculator — explicit Per Vine count basis.
//
//   actual       = physical/manual count: valid block vine_count_override →
//                  COMPLETE row-effective total (only when ≥1 row override and
//                  every row resolves) → unavailable. Never the theoretical count.
//   assumed_full = theoretical full planting: effective total row length
//                  (geometry, honouring row-length overrides) ÷ vine spacing,
//                  ignoring block and per-row vine-count overrides.
//   snapshot     = an existing record opened without a persisted basis: its
//                  stored allocation vine counts stay authoritative.
//   manual       = no blocks selected; the typed vine count is used directly.
//
// vine_count_basis is persisted on fertiliser_records (SQL 265): actual |
// assumed_full | manual, NULL for legacy records (no default, no backfill).
import { deriveMetrics } from "./paddockGeometry";
import { physicalVineCountOverride } from "./paddockRowVines";

export const VINE_COUNT_BASIS_PERSISTED = true;
export type PersistedVineCountBasis = VineCountBasis | "manual";

/**
 * The vine_count_basis to write. `undefined` = omit the column so an edited
 * record keeps its stored value (legacy NULL stays NULL). A snapshot never
 * recalculates: edits preserve, duplicates inherit the source's stored basis.
 */
export function vineCountBasisForSave(args: {
  mode: "perHectare" | "perVine";
  selectedBlockCount: number;
  basis: DialogVineBasis;
  isEdit: boolean;
  sourceBasis?: string | null;
}): PersistedVineCountBasis | null | undefined {
  if (args.mode !== "perVine") return undefined;
  if (args.selectedBlockCount === 0) return "manual";
  if (args.basis === "actual" || args.basis === "assumed_full") return args.basis;
  if (args.isEdit) return undefined;
  const s = args.sourceBasis;
  return s === "actual" || s === "assumed_full" || s === "manual" ? s : null;
}

export type VineCountBasis = "actual" | "assumed_full";
export type DialogVineBasis = VineCountBasis | "snapshot";
export type ActualVineSource = "block_override" | "row_overrides" | "unavailable";

export function actualVineCount(paddock: any): { actualVineCount: number | null; actualVineCountSource: ActualVineSource } {
  const p = physicalVineCountOverride(paddock);
  if (!p) return { actualVineCount: null, actualVineCountSource: "unavailable" };
  return {
    actualVineCount: p.count,
    actualVineCountSource: p.source === "block_override" ? "block_override" : "row_overrides",
  };
}

export type AssumedFullUnavailable = "no_row_length" | "no_vine_spacing";

export function assumedFullVineCount(paddock: any): { count: number | null; reason: AssumedFullUnavailable | null } {
  const spacing = Number(paddock?.vine_spacing);
  const m = deriveMetrics({ ...(paddock ?? {}), vine_count_override: null });
  if (!(m.totalRowLengthM > 0)) return { count: null, reason: "no_row_length" };
  if (!Number.isFinite(spacing) || spacing <= 0) return { count: null, reason: "no_vine_spacing" };
  return { count: Math.floor(m.totalRowLengthM / spacing), reason: null };
}

export interface BasisBlock {
  id: string;
  name: string;
  areaHa: number;
  /** Stored snapshot (existing records) or the legacy default. */
  vineCount: number;
  actualVineCount: number | null;
  actualVineCountSource: ActualVineSource;
  assumedFullVineCount: number | null;
  assumedFullReason: AssumedFullUnavailable | null;
}

export interface ResolvedBlock<T extends BasisBlock> {
  block: T;
  vineCount: number;
  sourceLabel: string | null;
}

const listNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * Resolve the vine counts that drive a Per Vine calculation. Per Hectare and
 * snapshot keep the block's stored/legacy vineCount untouched.
 */
export function resolveVineBasis<T extends BasisBlock>(
  selected: T[],
  mode: "perHectare" | "perVine",
  basis: DialogVineBasis,
  snapshotIds?: Set<string>,
): { blocks: ResolvedBlock<T>[]; issues: string[] } {
  if (mode !== "perVine" || selected.length === 0) {
    return { blocks: selected.map((b) => ({ block: b, vineCount: b.vineCount, sourceLabel: null })), issues: [] };
  }
  if (basis === "snapshot") {
    const outside = selected.filter((b) => !snapshotIds?.has(b.id)).map((b) => b.name);
    return {
      blocks: selected.map((b) => ({ block: b, vineCount: b.vineCount, sourceLabel: "Stored" })),
      issues: outside.length
        ? [`Choose a vine count basis — ${listNames(outside)} ${outside.length > 1 ? "are" : "is"} not part of the stored record.`]
        : [],
    };
  }
  if (basis === "actual") {
    const missing = selected.filter((b) => b.actualVineCount == null).map((b) => b.name);
    return {
      blocks: selected.map((b) => ({
        block: b,
        vineCount: b.actualVineCount ?? 0,
        sourceLabel: b.actualVineCountSource === "block_override" ? "Actual · Block override"
          : b.actualVineCountSource === "row_overrides" ? "Actual · Row counts" : "Actual · unavailable",
      })),
      issues: missing.length
        ? [`Actual vine count is not available for ${listNames(missing)}. Add a vine-count override in Block Setup or use Assumed full vine count.`]
        : [],
    };
  }
  const issues = selected
    .filter((b) => b.assumedFullVineCount == null)
    .map((b) => `Assumed full vine count cannot be calculated for ${b.name} because ${b.assumedFullReason === "no_vine_spacing" ? "vine spacing" : "row length"} is not available.`);
  return {
    blocks: selected.map((b) => ({ block: b, vineCount: b.assumedFullVineCount ?? 0, sourceLabel: "Assumed full" })),
    issues,
  };
}
