// Stage 3B — draft lifecycle for the guided Spray Job workflow.
//
// One canonical `SprayApplication` draft lives for the whole workflow. Steps
// patch parts of it; every number shown anywhere derives from the Stage 3A
// calculation layer applied to this draft. Nothing here does spray maths.
import {
  OPERATION_TYPE_TO_MODE,
  emptySprayApplication,
  fromLegacySprayJob,
  type OperationType,
  type SprayApplication,
  type SprayProductLine,
} from "@/lib/sprayApplicationDomain";
import type { SprayJob } from "@/lib/sprayJobsQuery";
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";
import type { WriteActivityGroup, WriteVerificationStatus } from "@/lib/chemicalIntelligenceWrite";
import type { SprayCalculationResult, SprayDiagnostic } from "@/lib/sprayCalculation";

/* ------------------------------------------------------------- hydration */

export function hydrateDraft(args: {
  vineyardId: string;
  job: SprayJob | null;
  isTemplate: boolean;
  paddockIds?: string[];
  intelligenceById?: Map<string, ChemicalIntelligence>;
  tankCapacityLitres?: number | null;
}): SprayApplication {
  if (!args.job) {
    const app = emptySprayApplication();
    app.vineyardId = args.vineyardId;
    app.isTemplate = args.isTemplate;
    app.status = args.isTemplate ? null : "draft";
    app.tankCapacityLitres = args.tankCapacityLitres ?? null;
    return app;
  }
  const app = fromLegacySprayJob(args.job, {
    paddockIds: args.paddockIds ?? [],
    intelligenceById: args.intelligenceById,
    tankCapacityLitres: args.tankCapacityLitres ?? null,
  });
  app.vineyardId = args.job.vineyard_id ?? args.vineyardId;
  return app;
}

/* ------------------------------------------------- operation change safety */

/**
 * Changing the operation type clears only what is genuinely incompatible:
 *  - head target is foliar-only,
 *  - band width belongs to banded applications,
 *  - spreader applications carry no liquid carrier.
 * Blocks, products, notes and dates are never discarded.
 */
export function applyOperationType(app: SprayApplication, op: OperationType | null): SprayApplication {
  const mode = op ? OPERATION_TYPE_TO_MODE[op] : null;
  const next: SprayApplication = {
    ...app,
    operationType: op,
    mode,
    headTarget: op === "foliar" ? app.headTarget : null,
    totalTreatedBandWidthMetres: mode === "banded" ? app.totalTreatedBandWidthMetres : null,
  };
  if (op === "spreader") {
    next.carrier = { basis: null };
  }
  return next;
}

/* ----------------------------------------------------------- product lines */

import {
  soleConfirmedDefault,
  productRateBasisFor,
} from "@/lib/chemicalDefaultRateHandoff";

export function productLineFromChemical(args: {
  savedChemicalId: string | null;
  productName: string | null;
  unit: string | null;
  intelligence?: ChemicalIntelligence | null;
  costPerUnit?: number | null;
}): SprayProductLine {
  const intel = args.intelligence ?? null;
  const activityGroups: WriteActivityGroup[] = (intel?.activityGroups ?? [])
    .filter((g) => !!g.code)
    .map((g) => ({
      scheme: (g.scheme === "NA" || g.scheme === "UNKNOWN"
        ? "not_applicable"
        : g.scheme.toLowerCase()) as WriteActivityGroup["scheme"],
      code: g.code as string,
    }));
  // Rate prefill (release contract): ONLY a confirmed persisted default may
  // pre-fill, and only when a single canonical basis is confirmed. No unit
  // conversion, no label-rate fallback, no first-rate guessing. When nothing
  // qualifies the operator still chooses deliberately.
  const sole = soleConfirmedDefault(intel?.defaultRates ?? null);
  const prefillRate = sole ? sole.value ?? sole.min_value ?? null : null;
  const prefillBasis =
    sole && prefillRate != null ? productRateBasisFor(sole.basis) : null;
  return {
    savedChemicalId: args.savedChemicalId,
    productName: args.productName,
    rate: prefillBasis ? prefillRate : null,
    unit: args.unit,
    rateBasis: prefillBasis,
    labelMinRate: null,
    labelMaxRate: null,
    labelRateUnit: null,
    activityGroups,
    verificationStatus: (intel?.verification.status ?? "unverified") as WriteVerificationStatus,
    intelligence: intel,
    legacyChemicalGroup: intel?.legacy.chemicalGroup ?? null,
    costPerUnit: args.costPerUnit ?? null,
    notes: null,
  };
}

/* ------------------------------------------------------- label rate guidance */

export interface DraftLabelRate {
  min: number | null;
  max: number | null;
  unit: string | null;
  basis: string | null;
  rawText?: string | null;
  referenceOnly?: boolean;
}

/**
 * A label rate is usable as guidance only when it carries a real number and is
 * not reference-only (`basis: "other"`). Reference text is never promoted into
 * an application rate, and an unresolved rate never invents one.
 */
export function isApplicableLabelRate(rate: DraftLabelRate | null | undefined): boolean {
  if (!rate) return false;
  if (rate.referenceOnly || (rate.basis ?? "").toLowerCase() === "other") return false;
  return rate.min != null || rate.max != null;
}

/**
 * Product rate basis suggested by a label rate basis.
 *
 * Banded applications are deliberately NOT guessed: a per-hectare label rate
 * may be intended per gross block hectare or per treated hectare, and only the
 * operator can say which. Guessing there silently doses the wrong area.
 */
export function suggestRateBasisFromLabel(
  labelBasis: string | null | undefined,
  mode: SprayApplication["mode"],
): SprayProductLine["rateBasis"] {
  const b = (labelBasis ?? "").toLowerCase();
  if (!b || b === "other") return null;
  if (b.includes("100_l") || b.includes("100 l") || b.includes("litre") || b.includes("100l")) {
    return "per_100_litres";
  }
  if (b.includes("100_m") || b.includes("100 m") || b.includes("metre")) return "per_100_metres";
  if (b.includes("hect") || b.includes("_ha") || b === "ha") {
    return mode === "banded" ? null : "whole_block_area";
  }
  return null;
}

/**
 * Apply one structured label rate as guidance. The rate the operator will
 * actually use is never set here — only the label range, its unit and, when it
 * is unambiguous, the rate basis.
 */
export function applyLabelRate(
  line: SprayProductLine,
  rate: DraftLabelRate | null,
  mode: SprayApplication["mode"] = null,
): SprayProductLine {
  if (!isApplicableLabelRate(rate)) {
    // Reference-only or unresolved: clear stale guidance, change nothing else.
    return { ...line, labelMinRate: null, labelMaxRate: null, labelRateUnit: null };
  }
  const suggested = suggestRateBasisFromLabel(rate!.basis, mode);
  return {
    ...line,
    labelMinRate: rate!.min ?? null,
    labelMaxRate: rate!.max ?? null,
    labelRateUnit: rate!.unit ?? null,
    rateBasis: line.rateBasis ?? suggested,
  };
}

/** Apply a structured registered use as guidance — rate stays operator-chosen. */
export function applyRegisteredUse(
  line: SprayProductLine,
  use: { rate: DraftLabelRate | null },
  suggestedBasis: SprayProductLine["rateBasis"],
): SprayProductLine {
  if (!isApplicableLabelRate(use.rate)) {
    return { ...line, labelMinRate: null, labelMaxRate: null, labelRateUnit: null };
  }
  return {
    ...line,
    labelMinRate: use.rate?.min ?? null,
    labelMaxRate: use.rate?.max ?? null,
    labelRateUnit: use.rate?.unit ?? null,
    rateBasis: line.rateBasis ?? suggestedBasis,
  };
}

/* --------------------------------------------------------------- templates */

/**
 * Load reusable settings from a template into the current draft. Blocks,
 * geometry and dates are deliberately NOT copied: geometry is always
 * recalculated from the blocks chosen for this job.
 */
export function applyTemplate(
  app: SprayApplication,
  template: SprayApplication,
): SprayApplication {
  return {
    ...app,
    name: app.name || template.name,
    operationType: template.operationType,
    mode: template.mode,
    targets: template.targets ? [...template.targets] : null,
    otherTargetNote: template.otherTargetNote,
    legacyTargetText: template.legacyTargetText,
    headTarget: template.headTarget,
    growthStageCode: template.growthStageCode,
    tractorId: template.tractorId,
    equipmentId: template.equipmentId,
    notes: template.notes,
    totalTreatedBandWidthMetres: template.totalTreatedBandWidthMetres,
    carrier: { ...template.carrier, concentrationFactor: null },
    products: template.products.map((p) => ({ ...p })),
    // Blocks + geometry stay with the job being created.
    blockIds: [...app.blockIds],
    geometryOverride: { ...app.geometryOverride },
  };
}

/* ------------------------------------------------------------ save gating */

/**
 * Codes that stop a planned job being meaningful. Everything else is guidance:
 * a planned job may legitimately still be missing detail that only a completed
 * record requires.
 */
const FATAL_CODES = new Set(["missing_application_mode", "no_blocks_selected"]);

export interface SaveGate {
  fatal: SprayDiagnostic[];
  warnings: SprayDiagnostic[];
  info: SprayDiagnostic[];
  canSave: boolean;
  blockingReasons: string[];
}

export function evaluateSaveGate(args: {
  application: SprayApplication;
  calculation: SprayCalculationResult;
}): SaveGate {
  const { application: app, calculation } = args;
  const fatal: SprayDiagnostic[] = [];
  const warnings: SprayDiagnostic[] = [];
  const info: SprayDiagnostic[] = [];

  for (const d of calculation.diagnostics) {
    if (app.isTemplate && (d.code === "no_blocks_selected" || d.code.startsWith("missing_gross"))) {
      continue; // templates are block-free by contract
    }
    if (FATAL_CODES.has(d.code)) fatal.push(d);
    else if (d.severity === "info") info.push(d);
    else warnings.push(d);
  }

  const blockingReasons: string[] = [];
  if (!(app.name ?? "").trim()) blockingReasons.push("Give this application a name.");
  if (!app.operationType) blockingReasons.push("Choose an application type.");
  if (!app.isTemplate && app.blockIds.length === 0) blockingReasons.push("Select at least one block.");
  for (const d of fatal) blockingReasons.push(d.message);

  return {
    fatal,
    warnings,
    info,
    canSave: blockingReasons.length === 0,
    blockingReasons: Array.from(new Set(blockingReasons)),
  };
}
