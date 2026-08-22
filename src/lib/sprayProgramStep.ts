// Spray Program Phase 1 — shared helpers for the Program (spray_jobs.is_template)
// surface of the portal.
//
// No new tables, no new columns: a Program Step IS a `spray_jobs` row with
// `is_template = true`. Everything here is presentation/derivation only.
import type { SprayApplication } from "@/lib/sprayApplicationDomain";
import type { SprayJob, SprayJobChemicalLine } from "@/lib/sprayJobsQuery";
import { chemicalLinesSummary } from "@/lib/sprayJobsQuery";
import { GROWTH_STAGE_LABEL } from "@/lib/vspWaterRate";
import { normaliseUnit } from "@/lib/rateBasis";

/* ------------------------------------------------------------ growth stage */

/**
 * Numeric E-L order so EL7 sorts before EL12. Rows with no stage sort last
 * (the sortable table already pushes nullish values to the end).
 */
export function growthStageOrder(code?: string | null): number | null {
  if (!code) return null;
  const m = /^\s*EL\s*(\d{1,2})/i.exec(String(code));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** "EL1" plus the plain-language description when one is known. */
export function growthStageDescription(code?: string | null): string | null {
  if (!code) return null;
  const label = GROWTH_STAGE_LABEL.get(code);
  if (!label) return null;
  // Stored labels already read "EL1 — Winter bud"; strip the leading code.
  const idx = label.indexOf("—");
  return idx >= 0 ? label.slice(idx + 1).trim() : label;
}

/* ------------------------------------------------------- product rendering */

/**
 * Basis-aware rate text for a stored chemical line. The basis actually stored
 * on the line decides the suffix — `/ha` is never assumed.
 */
export function chemicalLineRateText(line: SprayJobChemicalLine): string {
  const unit = normaliseUnit(line.unit) || (line.unit ?? "");
  const productBasis = (line as any).product_rate_basis as string | null | undefined;
  const legacyBasis = line.rate_basis as string | null | undefined;

  let suffix = "";
  if (productBasis === "per_100_litres") suffix = "/100 L";
  else if (productBasis === "per_100_metres") suffix = "/100 m";
  else if (productBasis === "treated_area") suffix = "/ha treated";
  else if (productBasis === "whole_block_area") suffix = "/ha";
  else if (legacyBasis === "per_100L" || legacyBasis === "per_100_litres") suffix = "/100 L";
  else if (legacyBasis === "per_hectare") suffix = "/ha";
  else if ((line as any).ratePer100L != null) suffix = "/100 L";
  else if ((line as any).ratePerHa != null) suffix = "/ha";

  if (line.rate == null) return "";
  return `${line.rate}${unit ? ` ${unit}` : ""}${suffix}`;
}

export function programLines(job: SprayJob): SprayJobChemicalLine[] {
  return (job.chemical_lines ?? []).filter((l) => (l?.name ?? "").trim());
}

/* -------------------------------------------------------------- search */

/** Program search covers stage, step name, targets, products, notes, method. */
export function programSearchHaystack(job: SprayJob): string {
  const stage = job.growth_stage_code ?? "";
  return [
    stage,
    growthStageDescription(stage),
    job.name,
    job.target,
    (job.targets ?? []).join(" "),
    job.operation_type,
    job.notes,
    chemicalLinesSummary(job.chemical_lines),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/* -------------------------------------------------------- Plan Spray prefill */

/**
 * Program Step → new Planned Spray prefill.
 *
 * Nothing is written here: the caller hands the result to the wizard as a NEW
 * draft, and only the wizard's Save creates a `spray_jobs` row. The Program
 * Step itself is never mutated.
 *
 * Application-specific decisions (blocks, planned date, operator) are
 * deliberately NOT prefilled.
 */
export function planSprayPrefillFromProgramStep(
  step: SprayApplication,
): Partial<SprayApplication> {
  return {
    id: null,
    isTemplate: false,
    status: "draft",
    name: step.name,
    operationType: step.operationType,
    mode: step.mode,
    headTarget: step.headTarget,
    targets: step.targets ? [...step.targets] : null,
    legacyTargetText: step.legacyTargetText,
    otherTargetNote: step.otherTargetNote,
    growthStageCode: step.growthStageCode,
    equipmentId: step.equipmentId,
    tractorId: step.tractorId,
    notes: step.notes,
    carrier: { ...step.carrier },
    products: step.products.map((p) => ({ ...p })),
    geometryOverride: { ...step.geometryOverride },
    totalTreatedBandWidthMetres: step.totalTreatedBandWidthMetres,
    tankCapacityLitres: step.tankCapacityLitres,
    // Never inherited from a Program Step:
    blockIds: [],
    plannedDate: null,
    operatorUserId: null,
    planProvenance: null,
  };
}
