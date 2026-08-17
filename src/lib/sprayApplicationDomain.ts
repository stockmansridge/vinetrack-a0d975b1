// Stage 3A — canonical Spray Application domain model.
//
// One vocabulary for the whole portal: application mode, structured targets,
// head target, carrier basis and per-product rate basis. Display labels are
// NEVER identity — every stored value here is a stable raw string that matches
// the Rork/backend contract (sql/191–195).
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

export type { SprayTarget };

/* ------------------------------------------------------- application mode */

export type ApplicationMode = "foliar" | "banded" | "spreader";
export const APPLICATION_MODES: ApplicationMode[] = ["foliar", "banded", "spreader"];
export const APPLICATION_MODE_LABEL: Record<ApplicationMode, string> = {
  foliar: "Foliar",
  banded: "Banded",
  spreader: "Spreader",
};

/** Legacy `spray_jobs.operation_type` display labels → canonical raw mode. */
const LEGACY_OPERATION_TYPE: Record<string, ApplicationMode> = {
  "foliar spray": "foliar",
  foliar: "foliar",
  "banded spray": "banded",
  banded: "banded",
  "band spray": "banded",
  spreader: "spreader",
  "spreader application": "spreader",
  fertiliser: "spreader",
};

export function normaliseApplicationMode(value: unknown): ApplicationMode | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if ((APPLICATION_MODES as string[]).includes(raw)) return raw as ApplicationMode;
  return LEGACY_OPERATION_TYPE[raw] ?? null;
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

/* -------------------------------------------------------- carrier basis */

export type CarrierBasis = "litres_per_hectare" | "litres_per_100m";
export const CARRIER_BASES: CarrierBasis[] = ["litres_per_hectare", "litres_per_100m"];
export const CARRIER_BASIS_LABEL: Record<CarrierBasis, string> = {
  litres_per_hectare: "L/ha",
  litres_per_100m: "L/100 m of row",
};

export function normaliseCarrierBasis(value: unknown): CarrierBasis | null {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if ((CARRIER_BASES as string[]).includes(raw)) return raw as CarrierBasis;
  if (raw === "l_per_ha" || raw === "l/ha" || raw === "per_hectare") return "litres_per_hectare";
  if (raw === "l_per_100m" || raw === "l/100m" || raw === "per_100m") return "litres_per_100m";
  return null;
}

/* --------------------------------------------------- product rate basis */

/**
 * Product label basis, deliberately independent of the carrier basis.
 *  - `per_hectare`          → gross / whole-block hectares (legacy meaning of
 *                             `per_hectare`; never re-read as treated area).
 *  - `per_treated_hectare`  → treated hectares (banded band area).
 *  - `per_100_litres`       → per 100 L of carrier volume.
 */
export type ProductRateBasis = "per_hectare" | "per_treated_hectare" | "per_100_litres";
export const PRODUCT_RATE_BASES: ProductRateBasis[] = [
  "per_hectare",
  "per_treated_hectare",
  "per_100_litres",
];
export const PRODUCT_RATE_BASIS_LABEL: Record<ProductRateBasis, string> = {
  per_hectare: "Per hectare (whole block)",
  per_treated_hectare: "Per treated hectare",
  per_100_litres: "Per 100 L carrier",
};

export function normaliseProductRateBasis(value: unknown): ProductRateBasis | null {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if ((PRODUCT_RATE_BASES as string[]).includes(raw)) return raw as ProductRateBasis;
  if (raw === "per_100l" || raw === "per_100_l" || raw === "per100l") return "per_100_litres";
  if (raw === "per_ha") return "per_hectare";
  if (raw === "per_treated_ha" || raw === "treated_area") return "per_treated_hectare";
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
  /** Applied (actual) L/100 m — `spray_jobs.applied_litres_per_100m`. */
  appliedLitresPer100m?: number | null;
  /** Dilute / runoff L/100 m — `spray_jobs.dilute_litres_per_100m`. */
  diluteLitresPer100m?: number | null;
  /** Persisted `concentration_factor` when the author supplied one. */
  concentrationFactor?: number | null;
}

export interface SprayApplication {
  id: string | null;
  vineyardId: string | null;
  isTemplate: boolean;
  name: string | null;
  plannedDate: string | null;
  status: string | null;
  mode: ApplicationMode | null;
  /** Structured targets (`spray_jobs.targets text[]`). */
  targets: SprayTarget[];
  /** Legacy single free-text target, kept as compatibility context only. */
  legacyTargetText: string | null;
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
  targets: [],
  legacyTargetText: null,
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

/** Strip a "/ha" or "/100L" suffix from a legacy composed unit string. */
function chemUnitOnly(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const stripped = unit.replace(/\s*\/\s*(ha|100\s*l|100litre|100 litres)\b/i, "").trim();
  return stripped || unit;
}

function legacyLineBasis(line: SprayJobChemicalLine): ProductRateBasis | null {
  const explicit = normaliseProductRateBasis(line.rate_basis);
  if (explicit) return explicit;
  const u = (line.unit ?? "").toLowerCase().replace(/\s+/g, "");
  if (u.includes("/100l")) return "per_100_litres";
  if (u.includes("/ha")) return "per_hectare";
  if (line.ratePer100L != null) return "per_100_litres";
  if (line.ratePerHa != null) return "per_hectare";
  return null;
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

  app.mode = normaliseApplicationMode(job.application_mode) ?? normaliseApplicationMode(job.operation_type);
  if (!app.mode && (job.operation_type || job.application_mode)) {
    notes.push(`Unrecognised application mode "${job.application_mode ?? job.operation_type}" — left unset.`);
  }

  const structuredTargets = Array.isArray(job.targets)
    ? (job.targets.map(normaliseSprayTarget).filter(Boolean) as SprayTarget[])
    : [];
  app.legacyTargetText = job.target ?? null;
  if (structuredTargets.length) {
    app.targets = structuredTargets;
  } else if (job.target) {
    const compat = legacyTargetCompat(job.target);
    if (compat) app.targets = [compat];
    else notes.push(`Legacy target "${job.target}" has no safe structured mapping — kept as free text.`);
  }

  app.headTarget = normaliseHeadTarget(job.spray_head_target);
  app.growthStageCode = job.growth_stage_code ?? null;
  app.tractorId = job.tractor_id ?? null;
  app.equipmentId = job.equipment_id ?? null;
  app.operatorUserId = job.operator_user_id ?? null;
  app.notes = job.notes ?? null;
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
  app.carrier = {
    basis: persistedBasis ?? (legacyLPerHa != null ? "litres_per_hectare" : null),
    litresPerHectare: legacyLPerHa,
    appliedLitresPer100m: positive(job.applied_litres_per_100m),
    diluteLitresPer100m: positive(job.dilute_litres_per_100m),
    concentrationFactor: positive(job.concentration_factor),
  };
  if (!persistedBasis && legacyLPerHa != null) {
    notes.push("Carrier basis not recorded — inferred L/ha from the legacy spray_rate_per_ha value.");
  }

  app.products = (job.chemical_lines ?? []).map((line) => {
    const id = (line.savedChemicalId ?? line.chemical_id ?? null) || null;
    const intel = id ? opts.intelligenceById?.get(id) ?? null : null;
    const basis = legacyLineBasis(line);
    if (!basis) notes.push(`Product "${line.name ?? "unnamed"}" has no resolvable rate basis.`);
    if (!id) notes.push(`Product "${line.name ?? "unnamed"}" is not linked to a saved chemical.`);
    return {
      savedChemicalId: id,
      productName: line.name ?? null,
      rate: num(line.rate) ?? num(line.ratePerHa) ?? num(line.ratePer100L),
      unit: chemUnitOnly(line.unit),
      rateBasis: basis,
      labelMinRate: null,
      labelMaxRate: null,
      labelRateUnit: null,
      activityGroups: intel
        ? intel.activityGroups
            .filter((g) => !!g.code)
            .map((g) => ({
              scheme: (g.scheme === "NA" || g.scheme === "UNKNOWN"
                ? "not_applicable"
                : g.scheme.toLowerCase()) as WriteActivityGroup["scheme"],
              code: g.code as string,
            }))
        : [],
      verificationStatus: (intel?.verification.status ?? "unverified") as WriteVerificationStatus,
      intelligence: intel,
      legacyChemicalGroup: (line as any).chemical_group ?? null,
      costPerUnit: num(line.costPerUnit),
      notes: line.notes ?? null,
    } satisfies SprayProductLine;
  });

  app.tankCapacityLitres = positive(opts.tankCapacityLitres) ?? positive(job.water_volume);
  app.compatibilityNotes = notes;
  return app;
}

/* ------------------------------------------- resistance candidate seam */

/**
 * The clean object Stage 3B / Resistance Check will consume. Stage 3A only
 * assembles the facts — it evaluates nothing.
 */
export interface CandidateApplication {
  vineyardId: string | null;
  date: string | null;
  blockIds: string[];
  targets: SprayTarget[];
  mode: ApplicationMode | null;
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
    targets: [...app.targets],
    mode: app.mode,
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
