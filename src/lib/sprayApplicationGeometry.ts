// Stage 3A — spray application geometry resolution.
//
// Geometry is resolved per block, with an explicit precedence and an explicit
// provenance. Nothing is silently defaulted: a block whose geometry cannot be
// established is reported as unavailable rather than assumed.
//
// Precedence (highest first):
//   1. operator override on the spray job / block
//   2. mapped row geometry (rows drawn on the block)
//   3. derived from gross area × row spacing
//   4. unavailable
import { deriveMetrics } from "@/lib/paddockGeometry";
import type { ApplicationMode, SprayGeometryOverride } from "@/lib/sprayApplicationDomain";

/**
 * Canonical persisted vocabulary for `spray_jobs.geometry_source`
 * (Rork-verified against SQL 191–195, iOS and Android).
 */
export type GeometrySource =
  | "operator_override"
  | "mapped_rows"
  | "derived_from_area_and_spacing"
  | "unavailable";

/**
 * Deprecated SQL 191 value. Read-tolerated as historical operator/stored
 * override behaviour; NEVER written.
 */
export const DEPRECATED_GEOMETRY_SOURCE = "stored_row_length" as const;

export function normaliseGeometrySource(value: unknown): GeometrySource | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === DEPRECATED_GEOMETRY_SOURCE) return "operator_override";
  if (raw === "derived_area_spacing") return "derived_from_area_and_spacing";
  if (raw === "incomplete") return "unavailable";
  return (
    ["operator_override", "mapped_rows", "derived_from_area_and_spacing", "unavailable"] as string[]
  ).includes(raw)
    ? (raw as GeometrySource)
    : null;
}

/** Geometry quality is a separate axis from geometry source. */
export type GeometryQuality = "authoritative" | "derived" | "incomplete";

/** Persisted/domain vocabulary describing how the treated area was produced. */
export type TreatedAreaMethod =
  | "canonical_row_length"
  | "area_and_spacing_fallback"
  | "whole_block"
  | "unavailable";

export const GEOMETRY_SOURCE_LABEL: Record<GeometrySource, string> = {
  operator_override: "Operator override",
  mapped_rows: "Mapped rows",
  derived_from_area_and_spacing: "Derived from area × row spacing",
  unavailable: "Unavailable",
};

export const GEOMETRY_QUALITY_LABEL: Record<GeometryQuality, string> = {
  authoritative: "Authoritative",
  derived: "Derived",
  incomplete: "Incomplete",
};

export const TREATED_AREA_METHOD_LABEL: Record<TreatedAreaMethod, string> = {
  canonical_row_length: "Row length × band width",
  area_and_spacing_fallback: "Area × band ÷ row spacing",
  whole_block: "Whole block area",
  unavailable: "Unavailable",
};

export type ValueSource = "operator_override" | "mapped_rows" | "block_record" | "derived" | "unknown";

/** Mobile parity tolerance for "same" row spacing: 1 mm. */
export const ROW_SPACING_TOLERANCE_M = 0.001;

export interface SprayBlockGeometry {
  blockId: string;
  blockName: string | null;
  grossAreaHa: number | null;
  grossAreaSource: ValueSource;
  rowSpacingMetres: number | null;
  rowSpacingSource: ValueSource;
  /** Total row length across the block, in metres. */
  canonicalRowLengthMetres: number | null;
  rowLengthSource: ValueSource;
  rowCount: number | null;
  /** Treated hectares for the current application mode / band width. */
  treatedAreaHa: number | null;
  treatedAreaMethod: TreatedAreaMethod;
  geometrySource: GeometrySource;
  geometryQuality: GeometryQuality;
  /** Machine-readable reasons this block is not fully resolved. */
  issues: string[];
}

export interface ApplicationGeometry {
  blocks: SprayBlockGeometry[];
  grossAreaHa: number | null;
  treatedAreaHa: number | null;
  treatedAreaMethod: TreatedAreaMethod;
  canonicalRowLengthMetres: number | null;
  /** Only set when every block shares the same spacing (within 1 mm). */
  rowSpacingMetres: number | null;
  uniformRowSpacing: boolean;
  geometrySource: GeometrySource;
  geometryQuality: GeometryQuality;
  issues: string[];
}

const pos = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Recorded block hectares, when the block row carries one. */
function recordedArea(paddock: any): number | null {
  return pos(paddock?.area_ha) ?? pos(paddock?.hectares) ?? null;
}

export interface BlockGeometryInput {
  /** Raw paddock row (polygon_points / rows / row_width / overrides). */
  paddock: any;
  /** Operator override captured on the spray job for this block. */
  override?: SprayGeometryOverride | null;
  mode: ApplicationMode | null;
  /** Total treated band width per row (both sides combined), in metres. */
  totalTreatedBandWidthMetres?: number | null;
}

export function resolveBlockGeometry(input: BlockGeometryInput): SprayBlockGeometry {
  const { paddock, override, mode } = input;
  const issues: string[] = [];
  const metrics = deriveMetrics(paddock);

  // --- gross area
  let grossAreaHa: number | null = null;
  let grossAreaSource: ValueSource = "unknown";
  if (pos(override?.grossAreaHa) != null) {
    grossAreaHa = pos(override?.grossAreaHa);
    grossAreaSource = "operator_override";
  } else if (metrics.areaHa > 0) {
    grossAreaHa = metrics.areaHa;
    grossAreaSource = "mapped_rows";
  } else if (recordedArea(paddock) != null) {
    grossAreaHa = recordedArea(paddock);
    grossAreaSource = "block_record";
  } else {
    issues.push("missing_gross_area");
  }

  // --- row spacing
  let rowSpacingMetres: number | null = null;
  let rowSpacingSource: ValueSource = "unknown";
  if (pos(override?.rowSpacingMetres) != null) {
    rowSpacingMetres = pos(override?.rowSpacingMetres);
    rowSpacingSource = "operator_override";
  } else if (pos(paddock?.row_width) != null) {
    rowSpacingMetres = pos(paddock?.row_width);
    rowSpacingSource = "block_record";
  } else {
    issues.push("missing_row_spacing");
  }

  // --- canonical row length
  let canonicalRowLengthMetres: number | null = null;
  let rowLengthSource: ValueSource = "unknown";
  let geometrySource: GeometrySource = "unavailable";
  if (pos(override?.canonicalRowLengthMetres) != null) {
    canonicalRowLengthMetres = pos(override?.canonicalRowLengthMetres);
    rowLengthSource = "operator_override";
    geometrySource = "operator_override";
  } else if (metrics.totalRowLengthM > 0 && metrics.rowLengthSource !== "geometry") {
    // Per-row / block-level length overrides are operator-authored.
    canonicalRowLengthMetres = metrics.totalRowLengthM;
    rowLengthSource = "operator_override";
    geometrySource = "operator_override";
  } else if (metrics.totalRowLengthM > 0) {
    canonicalRowLengthMetres = metrics.totalRowLengthM;
    rowLengthSource = "mapped_rows";
    geometrySource = "mapped_rows";
  } else if (grossAreaHa != null && rowSpacingMetres != null) {
    canonicalRowLengthMetres = (grossAreaHa * 10_000) / rowSpacingMetres;
    rowLengthSource = "derived";
    geometrySource = "derived_from_area_and_spacing";
  } else {
    issues.push("missing_row_length");
  }

  // --- treated area
  let treatedAreaHa: number | null = null;
  let treatedAreaMethod: TreatedAreaMethod = "unavailable";
  if (mode === "banded") {
    const band = pos(input.totalTreatedBandWidthMetres);
    if (band == null) {
      issues.push("missing_band_width");
    } else if (canonicalRowLengthMetres != null && rowLengthSource !== "derived") {
      treatedAreaHa = (canonicalRowLengthMetres * band) / 10_000;
      treatedAreaMethod = "canonical_row_length";
    } else if (grossAreaHa != null && rowSpacingMetres != null) {
      treatedAreaHa = grossAreaHa * (band / rowSpacingMetres);
      treatedAreaMethod = "area_and_spacing_fallback";
    }
  } else if (mode === "whole_block") {
    treatedAreaHa = grossAreaHa;
    if (treatedAreaHa != null) treatedAreaMethod = "whole_block";
  } else {
    // Mode unknown — treat as whole block area if we have it, but say so.
    treatedAreaHa = grossAreaHa;
    if (treatedAreaHa != null) treatedAreaMethod = "whole_block";
  }
  if (treatedAreaHa == null) issues.push("missing_treated_area");

  let geometryQuality: GeometryQuality;
  if (grossAreaHa == null || treatedAreaHa == null || geometrySource === "unavailable") {
    geometryQuality = "incomplete";
  } else if (geometrySource === "derived_from_area_and_spacing" || issues.length > 0) {
    geometryQuality = "derived";
  } else {
    geometryQuality = "authoritative";
  }

  return {
    blockId: String(paddock?.id ?? ""),
    blockName: paddock?.name ?? null,
    grossAreaHa,
    grossAreaSource,
    rowSpacingMetres,
    rowSpacingSource,
    canonicalRowLengthMetres,
    rowLengthSource,
    rowCount: metrics.rowCount > 0 ? metrics.rowCount : null,
    treatedAreaHa,
    treatedAreaMethod,
    geometrySource,
    geometryQuality,
    issues,
  };
}

const SOURCE_RANK: Record<GeometrySource, number> = {
  unavailable: 0,
  derived_from_area_and_spacing: 1,
  mapped_rows: 2,
  operator_override: 3,
};

/**
 * Aggregate treated-area method. Mobile behaviour: when the selected blocks
 * resolved their treated area by different methods, the aggregate method is
 * `area_and_spacing_fallback`.
 */
function aggregateTreatedAreaMethod(blocks: SprayBlockGeometry[]): TreatedAreaMethod {
  if (!blocks.length) return "unavailable";
  if (blocks.some((b) => b.treatedAreaMethod === "unavailable" || b.treatedAreaHa == null))
    return "unavailable";
  const distinct = new Set(blocks.map((b) => b.treatedAreaMethod));
  if (distinct.size === 1) return blocks[0].treatedAreaMethod;
  return "area_and_spacing_fallback";
}

/** Aggregate per-block geometry into a single application-level geometry. */
export function buildApplicationGeometry(blocks: SprayBlockGeometry[]): ApplicationGeometry {
  const issues: string[] = [];
  if (!blocks.length) {
    return {
      blocks: [],
      grossAreaHa: null,
      treatedAreaHa: null,
      treatedAreaMethod: "unavailable",
      canonicalRowLengthMetres: null,
      rowSpacingMetres: null,
      uniformRowSpacing: true,
      geometrySource: "unavailable",
      geometryQuality: "incomplete",
      issues: ["no_blocks_selected"],
    };
  }

  // A single unresolved block makes the total unresolved — never a partial sum.
  const sum = (pick: (b: SprayBlockGeometry) => number | null): number | null => {
    const values = blocks.map(pick);
    if (values.some((v) => v == null)) return null;
    return values.reduce<number>((acc, v) => acc + (v as number), 0);
  };

  const grossAreaHa = sum((b) => b.grossAreaHa);
  const treatedAreaHa = sum((b) => b.treatedAreaHa);
  const canonicalRowLengthMetres = sum((b) => b.canonicalRowLengthMetres);

  const spacings = blocks.map((b) => b.rowSpacingMetres);
  const knownSpacings = spacings.filter((v): v is number => v != null);
  const uniformRowSpacing =
    knownSpacings.length === blocks.length &&
    knownSpacings.every((v) => Math.abs(v - knownSpacings[0]) <= ROW_SPACING_TOLERANCE_M);
  let rowSpacingMetres: number | null = null;
  if (uniformRowSpacing) {
    rowSpacingMetres = knownSpacings[0] ?? null;
  } else if (knownSpacings.length === blocks.length) {
    // Spacings differ beyond tolerance — never averaged.
    issues.push("mixed_row_spacing");
  } else {
    issues.push("missing_row_spacing");
  }

  if (grossAreaHa == null) issues.push("missing_gross_area");
  if (treatedAreaHa == null) issues.push("missing_treated_area");
  if (canonicalRowLengthMetres == null) issues.push("missing_row_length");
  if (blocks.some((b) => b.geometryQuality === "incomplete")) issues.push("incomplete_block_geometry");

  const geometrySource = blocks.reduce<GeometrySource>((worst, b) => {
    return SOURCE_RANK[b.geometrySource] < SOURCE_RANK[worst] ? b.geometrySource : worst;
  }, "operator_override");

  const geometryQuality: GeometryQuality = blocks.some((b) => b.geometryQuality === "incomplete")
    ? "incomplete"
    : blocks.some((b) => b.geometryQuality === "derived") || issues.length > 0
      ? "derived"
      : "authoritative";

  return {
    blocks,
    grossAreaHa,
    treatedAreaHa,
    treatedAreaMethod: aggregateTreatedAreaMethod(blocks),
    canonicalRowLengthMetres,
    rowSpacingMetres,
    uniformRowSpacing,
    geometrySource,
    geometryQuality,
    issues: Array.from(new Set(issues)),
  };
}

/** Convenience: resolve every selected block and aggregate in one call. */
export function resolveApplicationGeometry(args: {
  paddocks: any[];
  blockIds: string[];
  mode: ApplicationMode | null;
  override?: SprayGeometryOverride | null;
  totalTreatedBandWidthMetres?: number | null;
}): ApplicationGeometry {
  const byId = new Map(args.paddocks.map((p) => [String(p?.id ?? ""), p]));
  const blocks = args.blockIds
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .map((paddock) =>
      resolveBlockGeometry({
        paddock,
        override: args.override ?? null,
        mode: args.mode,
        totalTreatedBandWidthMetres: args.totalTreatedBandWidthMetres ?? null,
      }),
    );
  return buildApplicationGeometry(blocks);
}
