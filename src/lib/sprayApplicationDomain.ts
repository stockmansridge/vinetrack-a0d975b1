// Stage 3A — canonical Spray Application domain model.
//
// One vocabulary for the whole portal: application mode, operation type,
// structured targets, head target, carrier basis and per-product rate basis.
// Display labels are NEVER identity — every stored value here is a stable raw
// string that matches the Rork-verified backend contract (sql/191–195, iOS and
// Android).
//
// This module is additive. Legacy spray_jobs / templates keep loading through
// `fromLegacySprayJob`, which never fabricates facts it cannot prove: an
// unknown legacy value becomes `null` plus a compatibility note.
import type { SprayJob, SprayJobChemicalLine } from "@/lib/sprayJobsQuery";
import {
  type SprayTarget,
  type WriteActivityGroup,
  type WriteVerificationStatus,
} from "@/lib/chemicalIntelligenceWrite";
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";
import {
  normaliseCanopyDensity,
  normaliseCanopySize,
  normaliseCanopyType,
  type CanopyDensity,
  type CanopySize,
  type CanopyType,
} from "@/lib/sprayCanopy";
import type { SprayJobPlanProvenance } from "@/lib/resistance/sprayJobPlanLink";
import { provenanceFromJobRow } from "@/lib/resistance/sprayJobPlanLink";
import {
  readChemistryStamp,
  stampDivergesFromCurrent,
  type JobChemistryStamp,
} from "@/lib/resistance/sprayJobChemistryStamp";


export type { SprayTarget };

/* ------------------------------------------------------- application mode */

/**
 * `spray_jobs.application_mode` — the confirmed contract has exactly two
 * values. `foliar` and `spreader` are NOT application modes; they live on
 * `operation_type` (below) and both map to `whole_block`.
 */
export type ApplicationMode = "whole_block" | "banded";
export const APPLICATION_MODES: ApplicationMode[] = ["whole_block", "banded"];
export const APPLICATION_MODE_LABEL: Record<ApplicationMode, string> = {
  whole_block: "Whole block",
  banded: "Banded",
};

/**
 * `spray_jobs.operation_type` — the legacy display vocabulary is retained in
 * persistence because it still distinguishes Foliar from Spreader for product
 * and UI semantics (and for Resistance Check context).
 */
export type OperationType = "foliar" | "spreader" | "banded";
export const OPERATION_TYPES: OperationType[] = ["foliar", "spreader", "banded"];
export const OPERATION_TYPE_LABEL: Record<OperationType, string> = {
  foliar: "Foliar Spray",
  spreader: "Spreader",
  banded: "Banded Spray",
};

const OPERATION_TYPE_ALIAS: Record<string, OperationType> = {
  "foliar spray": "foliar",
  foliar: "foliar",
  "banded spray": "banded",
  banded: "banded",
  "band spray": "banded",
  spreader: "spreader",
  "spreader application": "spreader",
  fertiliser: "spreader",
};

export function normaliseOperationType(value: unknown): OperationType | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  return OPERATION_TYPE_ALIAS[raw] ?? null;
}

/** Confirmed mapping: Foliar → whole_block, Spreader → whole_block, Banded → banded. */
export const OPERATION_TYPE_TO_MODE: Record<OperationType, ApplicationMode> = {
  foliar: "whole_block",
  spreader: "whole_block",
  banded: "banded",
};

export function normaliseApplicationMode(value: unknown): ApplicationMode | null {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if ((APPLICATION_MODES as string[]).includes(raw)) return raw as ApplicationMode;
  const op = normaliseOperationType(String(value ?? "").trim().toLowerCase());
  return op ? OPERATION_TYPE_TO_MODE[op] : null;
}

/* ------------------------------------------------------------- targets */

export const SPRAY_TARGETS: SprayTarget[] = [
  "powdery_mildew",
  "downy_mildew",
  "botrytis",
  "weeds",
  "nutrition_biostimulant",
  "other",
];

export const SPRAY_TARGET_LABEL: Record<SprayTarget, string> = {
  powdery_mildew: "Powdery mildew",
  downy_mildew: "Downy mildew",
  botrytis: "Botrytis",
  weeds: "Weeds",
  nutrition_biostimulant: "Nutrition / biostimulant",
  other: "Other",
};

/**
 * Any target identifier that may live in `spray_jobs.targets` — a built-in
 * SprayTarget, or a vineyard's own slug from the SQL 204 library. Custom slugs
 * are first-class: they are stored on the spray and must never be dropped.
 */
export type SprayTargetIdentifier = SprayTarget | (string & {});

/** Normalises to a slug without requiring it to be a built-in target. */
export function normaliseSprayTargetIdentifier(value: unknown): string | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return raw || null;
}

export function normaliseSprayTarget(value: unknown): SprayTarget | null {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (SPRAY_TARGETS as string[]).includes(raw) ? (raw as SprayTarget) : null;
}

/**
 * Explicit, conservative compatibility map for legacy free-text targets.
 * Anything not listed stays unstructured — historical prose is never guessed
 * into a structured target.
 */
const LEGACY_TARGET_COMPAT: Record<string, SprayTarget> = {
  "powdery mildew": "powdery_mildew",
  powdery: "powdery_mildew",
  pm: "powdery_mildew",
  "downy mildew": "downy_mildew",
  downy: "downy_mildew",
  dm: "downy_mildew",
  botrytis: "botrytis",
  "botrytis bunch rot": "botrytis",
  weeds: "weeds",
  weed: "weeds",
  "weed control": "weeds",
};

export function legacyTargetCompat(text: string | null | undefined): SprayTarget | null {
  const raw = (text ?? "").trim().toLowerCase();
  if (!raw) return null;
  return normaliseSprayTarget(raw) ?? LEGACY_TARGET_COMPAT[raw] ?? null;
}

/* ---------------------------------------------------------- head target */

export type HeadTarget = "full_canopy" | "bunch_line" | "leaf_zone";
export const HEAD_TARGETS: HeadTarget[] = ["full_canopy", "bunch_line", "leaf_zone"];
export const HEAD_TARGET_LABEL: Record<HeadTarget, string> = {
  full_canopy: "Full canopy",
  bunch_line: "Bunch line",
  leaf_zone: "Leaf zone",
};

export function normaliseHeadTarget(value: unknown): HeadTarget | null {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (HEAD_TARGETS as string[]).includes(raw) ? (raw as HeadTarget) : null;
}

/** Head target is foliar-only: Banded Spray and Spreader must persist NULL. */
export const headTargetAllowed = (operationType: OperationType | null): boolean =>
  operationType === "foliar";

/**
 * Persisted `spray_head_target` for an operation type. Never carries an old
 * foliar head target through when the operation type changes.
 */
export function persistedHeadTarget(
  operationType: OperationType | null,
  headTarget: HeadTarget | null,
): HeadTarget | null {
  return headTargetAllowed(operationType) ? headTarget : null;
}

/* --------------------------------------------- spray volume (carrier) basis */

/**
 * Persisted `spray_jobs.carrier_volume_basis` — how the SPRAYER OUTPUT (water)
 * is known for this application. It is not a chemical label rate basis.
 *
 *  - `l_per_100m` — calibrated per 100 m of row (vineyard row-length workflow)
 *  - `l_per_ha`   — calibrated by area
 *  - `manual`     — the operator states the TOTAL water being mixed/applied
 *                   (knapsack, spot spraying); canopy and geometry are bypassed
 */
export type CarrierBasis = "l_per_ha" | "l_per_100m" | "manual";
/** Only the two calibrated bases; `manual` is a deliberate bypass. */
export const CALIBRATED_CARRIER_BASES: CarrierBasis[] = ["l_per_100m", "l_per_ha"];
export const CARRIER_BASES: CarrierBasis[] = ["l_per_ha", "l_per_100m", "manual"];
export const CARRIER_BASIS_LABEL: Record<CarrierBasis, string> = {
  l_per_ha: "L/ha",
  l_per_100m: "L/100 m of row",
  manual: "Manual total water",
};

/** Longer wording used where the choice is being made, not just displayed. */
export const CARRIER_BASIS_CHOICE_LABEL: Record<CarrierBasis, string> = {
  l_per_100m: "L/100 m of row",
  l_per_ha: "L/ha",
  manual: "Manual — I know the total water",
};

export const CARRIER_BASIS_CHOICE_HINT: Record<CarrierBasis, string> = {
  l_per_100m: "Sprayer calibrated per 100 metres of row — the vineyard row-length workflow.",
  l_per_ha: "Sprayer calibrated by area. The same canopy answer sets the recommendation.",
  manual: "Knapsack, spot spraying, or any job where the total tank water is already known.",
};

/**
 * Vineyard-level preference (`vineyards.spray_carrier_volume_basis`) may also
 * be `either`. That is a preference, never an application carrier basis.
 */
export type CarrierBasisPreference = CarrierBasis | "either";

export function normaliseCarrierBasis(value: unknown): CarrierBasis | null {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if ((CARRIER_BASES as string[]).includes(raw)) return raw as CarrierBasis;
  if (raw === "litres_per_hectare" || raw === "l/ha" || raw === "per_hectare" || raw === "per_ha")
    return "l_per_ha";
  if (raw === "litres_per_100m" || raw === "l/100m" || raw === "per_100m") return "l_per_100m";
  if (raw === "total" || raw === "manual_total" || raw === "total_water") return "manual";
  return null;
}


export function normaliseCarrierBasisPreference(value: unknown): CarrierBasisPreference | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "either") return "either";
  return normaliseCarrierBasis(value);
}

/* --------------------------------------------------- product rate basis */

/**
 * Product label basis, deliberately independent of the carrier basis.
 *  - `whole_block_area` → gross / whole-block hectares (also the meaning of an
 *                         absent legacy rate basis).
 *  - `treated_area`     → treated hectares (banded band area).
 *  - `per_100_litres`   → per 100 L of carrier volume.
 *  - `per_100_metres`   → per 100 m of canonical row length.
 */
export type ProductRateBasis =
  | "whole_block_area"
  | "treated_area"
  | "per_100_litres"
  | "per_100_metres";
export const PRODUCT_RATE_BASES: ProductRateBasis[] = [
  "whole_block_area",
  "treated_area",
  "per_100_litres",
  "per_100_metres",
];
export const PRODUCT_RATE_BASIS_LABEL: Record<ProductRateBasis, string> = {
  whole_block_area: "Per hectare (whole block)",
  treated_area: "Per treated hectare",
  per_100_litres: "Per 100 L carrier",
  per_100_metres: "Per 100 m of row",
};

export function normaliseProductRateBasis(value: unknown): ProductRateBasis | null {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if ((PRODUCT_RATE_BASES as string[]).includes(raw)) return raw as ProductRateBasis;
  if (raw === "per_100l" || raw === "per_100_l" || raw === "per100l") return "per_100_litres";
  if (raw === "per_100_m" || raw === "per_100m" || raw === "per100m") return "per_100_metres";
  if (raw === "per_hectare" || raw === "per_ha" || raw === "gross_area") return "whole_block_area";
  if (raw === "per_treated_hectare" || raw === "per_treated_ha") return "treated_area";
  return null;
}

/* ------------------------------------------------------------- products */

export interface SprayProductLine {
  /** Stable saved_chemicals identity. Name alone is never identity. */
  savedChemicalId: string | null;
  productName: string | null;
  /** Operator-selected rate. Never auto-set to the label maximum. */
  rate: number | null;
  /** Chemical unit only ("L", "mL", "kg", "g") — the basis lives separately. */
  unit: string | null;
  rateBasis: ProductRateBasis | null;
  /** Structured label range, when Chemical Intelligence provides one. */
  labelMinRate?: number | null;
  labelMaxRate?: number | null;
  labelRateUnit?: string | null;
  /** Structured resistance groups carried for the future Resistance Check. */
  activityGroups: WriteActivityGroup[];
  /** Trust state travels with the line; it never blocks calculation. */
  verificationStatus: WriteVerificationStatus;
  /** Full read model when the caller has it (optional). */
  intelligence?: ChemicalIntelligence | null;
  /** Legacy display string preserved verbatim for historical fidelity. */
  legacyChemicalGroup?: string | null;
  /**
   * P8 — the chemistry stamp this line was loaded with. Re-saved verbatim so
   * editing an unrelated field can never re-stamp the job from a Saved
   * Chemical that has changed since.
   */
  chemistryStamp?: JobChemistryStamp | null;
  costPerUnit?: number | null;
  notes?: string | null;
}

/* ---------------------------------------------------------- application */

export interface SprayGeometryOverride {
  grossAreaHa?: number | null;
  rowSpacingMetres?: number | null;
  canonicalRowLengthMetres?: number | null;
}

export interface SprayCarrierInput {
  basis: CarrierBasis | null;
  litresPerHectare?: number | null;
  /** Dilute / runoff reference in L/ha, when the author works in L/ha. */
  diluteLitresPerHectare?: number | null;
  /** Applied (actual) L/100 m — `spray_jobs.applied_litres_per_100m`. */
  appliedLitresPer100m?: number | null;
  /** Dilute / runoff L/100 m — `spray_jobs.dilute_litres_per_100m`. */
  diluteLitresPer100m?: number | null;
  /**
   * Persisted `concentration_factor`. When present on an existing job/record it
   * is authoritative history and is never silently re-derived.
   */
  concentrationFactor?: number | null;
  /* ---- canopy answer (drives the AWRI dilute/runoff recommendation) ---- */
  /**
   * Trellis form. Not persisted by the current spray_jobs contract — see the
   * persistence audit in `docs/`; only size/density round-trip today
   * (`vsp_canopy_size` / `vsp_canopy_density`).
   */
  canopyType?: CanopyType | null;
  canopySize?: CanopySize | null;
  canopyDensity?: CanopyDensity | null;
  /**
   * Whether the operator sprays at the AWRI recommendation or at their own
   * sprayer output. `null` = not yet answered.
   */
  sprayerOutputChoice?: "recommended" | "custom" | null;
  /** Manual basis only: the total water being mixed/applied, in litres. */
  manualTotalLitres?: number | null;
}


export interface SprayApplication {
  id: string | null;
  vineyardId: string | null;
  isTemplate: boolean;
  name: string | null;
  plannedDate: string | null;
  status: string | null;
  /** Persisted `application_mode` — whole_block | banded. */
  mode: ApplicationMode | null;
  /** Persisted `operation_type` — retained alongside the mode. */
  operationType: OperationType | null;
  /**
   * Structured targets (`spray_jobs.targets text[]`).
   * `null` = never recorded / unknown. `[]` = explicitly no targets.
   */
  targets: SprayTargetIdentifier[] | null;
  /** Legacy single free-text target, kept as compatibility context only. */
  legacyTargetText: string | null;
  /** Optional explanatory note for the structured `other` target. */
  otherTargetNote: string | null;
  headTarget: HeadTarget | null;
  growthStageCode: string | null;
  tractorId: string | null;
  equipmentId: string | null;
  operatorUserId: string | null;
  notes: string | null;
  /** Planned block selection (`spray_job_paddocks`) — stable paddock UUIDs. */
  blockIds: string[];
  geometryOverride: SprayGeometryOverride;
  /** Total treated width per row (both sides combined), not width per side. */
  totalTreatedBandWidthMetres: number | null;
  carrier: SprayCarrierInput;
  products: SprayProductLine[];
  tankCapacityLitres: number | null;
  /**
   * Explicit operator confirmation that the equipment shown is the equipment
   * being used for THIS application. A value prefilled from a Program Step or
   * an existing job is never confirmation; changing the spray unit or tractor
   * invalidates it. Session state — deliberately not persisted.
   */
  equipmentConfirmed: boolean;
  /**
   * SQL 201 Resistance Plan provenance. `null` for legacy/unlinked jobs and
   * for every template. The frozen snapshot inside it — never the current
   * plan — is the authority on original planned intent.
   */
  planProvenance: SprayJobPlanProvenance | null;
  /** Non-fatal notes describing what could not be resolved from legacy data. */
  compatibilityNotes: string[];
}

export const emptySprayApplication = (): SprayApplication => ({
  id: null,
  vineyardId: null,
  isTemplate: false,
  name: null,
  plannedDate: null,
  status: null,
  mode: null,
  operationType: null,
  targets: null,
  legacyTargetText: null,
  otherTargetNote: null,
  headTarget: null,
  growthStageCode: null,
  tractorId: null,
  equipmentId: null,
  operatorUserId: null,
  notes: null,
  blockIds: [],
  geometryOverride: {},
  totalTreatedBandWidthMetres: null,
  carrier: { basis: null },
  products: [],
  tankCapacityLitres: null,
  equipmentConfirmed: false,
  planProvenance: null,
  compatibilityNotes: [],
});

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const positive = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

/* ------------------------------------------------ legacy job → domain */

/** Strip a "/ha", "/100L" or "/100m" suffix from a legacy composed unit string. */
function chemUnitOnly(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const stripped = unit
    .replace(/\s*\/\s*(ha|100\s*l|100litre|100 litres|100\s*m|100m)\b/i, "")
    .trim();
  return stripped || unit;
}

/** Absent rate basis on a legacy line means whole-block hectares. */
function legacyLineBasis(line: SprayJobChemicalLine): ProductRateBasis {
  // Stage 3B canonical basis wins when the operator has deliberately saved one.
  const canonical = normaliseProductRateBasis((line as any).product_rate_basis);
  if (canonical) return canonical;
  const explicit = normaliseProductRateBasis(line.rate_basis);
  if (explicit) return explicit;
  const u = (line.unit ?? "").toLowerCase().replace(/\s+/g, "");
  if (u.includes("/100l")) return "per_100_litres";
  if (u.includes("/100m")) return "per_100_metres";
  if (u.includes("/ha")) return "whole_block_area";
  if (line.ratePer100L != null) return "per_100_litres";
  return "whole_block_area";
}

export interface LegacyAdapterOptions {
  /** Planned blocks from `spray_job_paddocks`. */
  paddockIds?: string[];
  /**
   * Optional current Chemical Intelligence per saved chemical id. Only used to
   * attach structured groups/verification for lines that already reference a
   * saved chemical — nothing is invented for unlinked lines.
   */
  intelligenceById?: Map<string, ChemicalIntelligence>;
  /** Equipment tank capacity in litres, when known. */
  tankCapacityLitres?: number | null;
}

/**
 * Convert an existing spray_jobs row (job OR template) into the Stage 3A
 * domain. Historical rows are never rewritten, and unknown facts stay unknown.
 */
export function fromLegacySprayJob(
  job: SprayJob & Record<string, any>,
  opts: LegacyAdapterOptions = {},
): SprayApplication {
  const app = emptySprayApplication();
  const notes: string[] = [];

  app.id = job.id ?? null;
  app.vineyardId = job.vineyard_id ?? null;
  app.isTemplate = !!job.is_template;
  app.name = job.name ?? null;
  app.plannedDate = job.planned_date ?? null;
  app.status = job.status ?? null;

  app.operationType = normaliseOperationType(job.operation_type);
  app.mode =
    normaliseApplicationMode(job.application_mode) ??
    (app.operationType ? OPERATION_TYPE_TO_MODE[app.operationType] : null);
  if (!app.mode && (job.operation_type || job.application_mode)) {
    notes.push(
      `Unrecognised application mode "${job.application_mode ?? job.operation_type}" — left unset.`,
    );
  }

  const hasTargetsColumn = Array.isArray(job.targets);
  // Custom identifiers are preserved verbatim — an unknown slug is a fact the
  // vineyard recorded, not a parse failure.
  const structuredTargets = hasTargetsColumn
    ? (job.targets.map(normaliseSprayTargetIdentifier).filter(Boolean) as SprayTargetIdentifier[])
    : [];
  app.legacyTargetText = job.target ?? null;
  if (hasTargetsColumn) {
    // An explicitly empty array is a recorded fact and stays empty.
    app.targets = structuredTargets;
  } else if (job.target) {
    const compat = legacyTargetCompat(job.target);
    if (compat) app.targets = [compat];
    else notes.push(`Legacy target "${job.target}" has no safe structured mapping — kept as free text.`);
  }

  // Head target is foliar-only; it is never carried through for banded/spreader.
  app.headTarget = persistedHeadTarget(app.operationType, normaliseHeadTarget(job.spray_head_target));
  if (job.spray_head_target && app.headTarget == null && app.operationType) {
    notes.push("Head target is foliar-only — dropped for this operation type.");
  }
  app.growthStageCode = job.growth_stage_code ?? null;
  app.tractorId = job.tractor_id ?? null;
  app.equipmentId = job.equipment_id ?? null;
  app.operatorUserId = job.operator_user_id ?? null;
  app.notes = job.notes ?? null;
  // Templates never carry plan provenance, even if a row somehow has it.
  app.planProvenance = app.isTemplate ? null : provenanceFromJobRow(job);
  app.blockIds = [...(opts.paddockIds ?? [])];
  if (app.isTemplate && (opts.paddockIds?.length ?? 0) === 0) {
    notes.push("Templates do not carry blocks in the current contract — blocks must be chosen per job.");
  }

  // Geometry: only operator-authored values on the job count as an override.
  app.geometryOverride = {
    grossAreaHa: positive(job.gross_area_ha),
    rowSpacingMetres: positive(job.row_spacing_metres),
    canonicalRowLengthMetres: positive(job.canonical_row_length_metres),
  };
  app.totalTreatedBandWidthMetres = positive(job.band_width_total_metres);
  if (app.mode === "banded" && app.totalTreatedBandWidthMetres == null) {
    notes.push("Banded application has no recorded total treated band width.");
  }

  const persistedBasis = normaliseCarrierBasis(job.carrier_volume_basis);
  const legacyLPerHa = positive(job.spray_rate_per_ha);
  const persistedCf = positive(job.concentration_factor);
  const canopySize = normaliseCanopySize(job.vsp_canopy_size);
  const canopyDensity = normaliseCanopyDensity(job.vsp_canopy_density);
  // Trellis form has no column in the current spray_jobs contract, so it is
  // NOT guessed on reopen — assuming VSP would silently produce a wrong
  // sprawl recommendation. The recorded applied volume stays authoritative;
  // only the recommendation needs the canopy answered again.
  const canopyType: CanopyType | null = normaliseCanopyType((job as any).canopy_type);
  if (!canopyType && (canopySize || canopyDensity)) {
    notes.push(
      "Canopy trellis form is not stored on this job — re-answer it to see the recommended dilute volume. The recorded spray volume is unchanged.",
    );
  }

  const basis = persistedBasis ?? (legacyLPerHa != null ? "l_per_ha" : null);
  // Dilute L/ha may not be stored; it is exactly recoverable from the persisted
  // concentration factor (CF = dilute ÷ applied) rather than being guessed.
  const diluteLPerHa =
    positive((job as any).dilute_litres_per_hectare) ??
    (persistedCf != null && legacyLPerHa != null ? persistedCf * legacyLPerHa : null);
  app.carrier = {
    basis,
    litresPerHectare: basis === "manual" ? null : legacyLPerHa,
    diluteLitresPerHectare: basis === "manual" ? null : diluteLPerHa,
    appliedLitresPer100m: positive(job.applied_litres_per_100m),
    diluteLitresPer100m: positive(job.dilute_litres_per_100m),
    concentrationFactor: basis === "manual" ? 1 : persistedCf,
    canopyType: basis === "manual" ? null : canopyType,
    canopySize: basis === "manual" ? null : canopySize,
    canopyDensity: basis === "manual" ? null : canopyDensity,
    // The choice itself has no column. It is inferred, never guessed wrongly:
    // a recorded sprayer output means the operator set their own volume; a
    // canopy answer with no recorded output means they took the canopy
    // recommendation.
    sprayerOutputChoice:
      basis === "manual"
        ? null
        : (basis === "l_per_ha" ? legacyLPerHa : positive(job.applied_litres_per_100m)) != null
          ? "custom"
          : canopySize && canopyDensity
            ? "recommended"
            : null,

    manualTotalLitres: basis === "manual" ? positive(job.water_volume) : null,
  };
  if (!persistedBasis && legacyLPerHa != null) {
    notes.push("Carrier basis not recorded — inferred L/ha from the legacy spray_rate_per_ha value.");
  }


  app.products = (job.chemical_lines ?? []).map((line) => {
    const id = (line.savedChemicalId ?? line.chemical_id ?? null) || null;
    const intel = id ? opts.intelligenceById?.get(id) ?? null : null;
    const basis = legacyLineBasis(line);
    if (!id) notes.push(`Product "${line.name ?? "unnamed"}" is not linked to a saved chemical.`);

    // P8 — the chemistry frozen on the line when the job was created is the
    // authority. The live Saved Chemical is attached for label/rate guidance
    // but never silently replaces the recorded groups or evidence quality.
    const stamp = readChemistryStamp(line);
    const liveGroups: WriteActivityGroup[] = intel
      ? intel.activityGroups
          .filter((g) => !!g.code)
          .map((g) => ({
            scheme: (g.scheme === "NA" || g.scheme === "UNKNOWN"
              ? "not_applicable"
              : g.scheme.toLowerCase()) as WriteActivityGroup["scheme"],
            code: g.code as string,
          }))
      : [];
    if (stamp && stampDivergesFromCurrent(stamp, intel)) {
      notes.push(
        `Chemistry for "${line.name ?? "product"}" has changed in the Chemical Store since this job was created — the job keeps the chemistry it was created with.`,
      );
    }
    return {
      savedChemicalId: id,
      productName: line.name ?? null,
      rate: num(line.rate) ?? num(line.ratePerHa) ?? num(line.ratePer100L),
      unit: chemUnitOnly(line.unit),
      rateBasis: basis,
      labelMinRate: null,
      labelMaxRate: null,
      labelRateUnit: null,
      chemistryStamp: stamp,
      activityGroups: stamp ? stamp.activity_groups : liveGroups,
      verificationStatus: (stamp?.verification_status ??
        intel?.verification.status ??
        "unverified") as WriteVerificationStatus,
      intelligence: intel,
      legacyChemicalGroup: (line as any).chemical_group ?? null,
      costPerUnit: num(line.costPerUnit),
      notes: line.notes ?? null,
    } satisfies SprayProductLine;
  });


  // For a manual application `water_volume` is the total water the operator
  // entered — it is not a tank size and must never be read back as one.
  app.tankCapacityLitres =
    positive(opts.tankCapacityLitres) ??
    (app.carrier.basis === "manual" ? null : positive(job.water_volume));
  app.compatibilityNotes = notes;
  return app;
}

/* ------------------------------------------- resistance candidate seam */

/**
 * The clean object Stage 3B / Resistance Check will consume. Stage 3A only
 * assembles the facts — it evaluates nothing. `mode` and `operationType` are
 * both carried: whole_block is NOT a synonym for Foliar, and the resistance
 * engine may need the operation context.
 */
export interface CandidateApplication {
  vineyardId: string | null;
  date: string | null;
  blockIds: string[];
  targets: SprayTargetIdentifier[] | null;
  mode: ApplicationMode | null;
  operationType: OperationType | null;
  headTarget: HeadTarget | null;
  products: {
    savedChemicalId: string | null;
    productName: string | null;
    activityGroups: WriteActivityGroup[];
    verificationStatus: WriteVerificationStatus;
  }[];
  geometryQuality: string | null;
}

export function buildCandidateApplication(
  app: SprayApplication,
  geometryQuality?: string | null,
): CandidateApplication {
  return {
    vineyardId: app.vineyardId,
    date: app.plannedDate,
    blockIds: [...app.blockIds],
    targets: app.targets ? [...app.targets] : null,
    mode: app.mode,
    operationType: app.operationType,
    headTarget: app.headTarget,
    products: app.products.map((p) => ({
      savedChemicalId: p.savedChemicalId,
      productName: p.productName,
      activityGroups: p.activityGroups,
      verificationStatus: p.verificationStatus,
    })),
    geometryQuality: geometryQuality ?? null,
  };
}
