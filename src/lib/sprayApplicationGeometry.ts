// Stage 3A — spray application geometry resolution.
//
// Geometry is resolved per block, with an explicit precedence and an explicit
// provenance. Nothing is silently defaulted: a block whose geometry cannot be
// established is reported as incomplete rather than assumed.
//
// Precedence (highest first):
//   1. operator override on the spray job / block
//   2. mapped row geometry (rows drawn on the block)
//   3. derived from gross area × row spacing
//   4. incomplete
import { deriveMetrics } from "@/lib/paddockGeometry";
import type { ApplicationMode, SprayGeometryOverride } from "@/lib/sprayApplicationDomain";

/**
 * Raw persisted vocabulary for `spray_jobs.geometry_source`.
 * NOTE: the raw strings below are the portal's canonical spelling; they must be
 * confirmed against the Rork sql/193 check constraint before Stage 3B writes.
 */
export type GeometrySource =
  | "operator_override"
  | "mapped_rows"
  | "derived_area_spacing"
  | "incomplete";

export type GeometryQuality = "complete" | "partial" | "incomplete";

export const GEOMETRY_SOURCE_LABEL: Record<GeometrySource, string> = {
  operator_override: "Operator override",
  mapped_rows: "Mapped rows",
  derived_area_spacing: "Derived from area × row spacing",
  incomplete: "Incomplete",
};

export const GEOMETRY_QUALITY_LABEL: Record<GeometryQuality, string> = {
  complete: "Complete",
  partial: "Partial",
  incomplete: "Incomplete",
};

export type ValueSource = "operator_override" | "mapped_rows" | "block_record" | "derived" | "unknown";

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
  geometrySource: GeometrySource;
  geometryQuality: GeometryQuality;
  /** Machine-readable reasons this block is not `complete`. */
  issues: string[];
}

export interface ApplicationGeometry {
  blocks: SprayBlockGeometry[];
  grossAreaHa: number | null;
  treatedAreaHa: number | null;
  canonicalRowLengthMetres: number | null;
  /** Area-weighted row spacing when spacings differ; the single value when uniform. */
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
  let geometrySource: GeometrySource = "incomplete";
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
    geometrySource = "derived_area_spacing";
  } else {
    issues.push("missing_row_length");
  }

  // --- treated area
  let treatedAreaHa: number | null = null;
  if (mode === "banded") {
    const band = pos(input.totalTreatedBandWidthMetres);
    if (band == null) {
      issues.push("missing_band_width");
    } else if (canonicalRowLengthMetres != null) {
      treatedAreaHa = (canonicalRowLengthMetres * band) / 10_000;
    } else if (grossAreaHa != null && rowSpacingMetres != null) {
      treatedAreaHa = grossAreaHa * (band / rowSpacingMetres);
    }
  } else {
    // Foliar and spreader treat the whole block area.
    treatedAreaHa = grossAreaHa;
  }
  if (treatedAreaHa == null) issues.push("missing_treated_area");

  let geometryQuality: GeometryQuality = "complete";
  if (grossAreaHa == null || treatedAreaHa == null) geometryQuality = "incomplete";
  else if (issues.length > 0 || geometrySource === "derived_area_spacing") geometryQuality = "partial";

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
    geometrySource,
    geometryQuality,
    issues,
  };
}

const SOURCE_RANK: Record<GeometrySource, number> = {
  incomplete: 0,
  derived_area_spacing: 1,
  mapped_rows: 2,
  operator_override: 3,
};

/** Aggregate per-block geometry into a single application-level geometry. */
export function buildApplicationGeometry(blocks: SprayBlockGeometry[]): ApplicationGeometry {
  const issues: string[] = [];
  if (!blocks.length) {
    return {
      blocks: [],
      grossAreaHa: null,
      treatedAreaHa: null,
      canonicalRowLengthMetres: null,
      rowSpacingMetres: null,
      uniformRowSpacing: true,
      geometrySource: "incomplete",
      geometryQuality: "incomplete",
      issues: ["no_blocks_selected"],
    };
  }

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
    knownSpacings.every((v) => Math.abs(v - knownSpacings[0]) < 1e-9);
  let rowSpacingMetres: number | null = null;
  if (uniformRowSpacing) {
    rowSpacingMetres = knownSpacings[0] ?? null;
  } else if (knownSpacings.length === blocks.length && grossAreaHa && grossAreaHa > 0) {
    const weighted = blocks.reduce(
      (acc, b) => acc + (b.rowSpacingMetres as number) * (b.grossAreaHa ?? 0),
      0,
    );
    rowSpacingMetres = weighted / grossAreaHa;
    issues.push("mixed_row_spacing");
  } else {
    issues.push("missing_row_spacing");
  }

  if (grossAreaHa == null) issues.push("missing_gross_area");
  if (treatedAreaHa == null) issues.push("missing_treated_area");
  if (canonicalRowLengthMetres == null) issues.push("missing_row_length");

  const geometrySource = blocks.reduce<GeometrySource>((worst, b) => {
    return SOURCE_RANK[b.geometrySource] < SOURCE_RANK[worst] ? b.geometrySource : worst;
  }, "operator_override");

  const geometryQuality: GeometryQuality = blocks.some((b) => b.geometryQuality === "incomplete")
    ? "incomplete"
    : blocks.some((b) => b.geometryQuality === "partial") || issues.length > 0
      ? "partial"
      : "complete";

  return {
    blocks,
    grossAreaHa,
    treatedAreaHa,
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
