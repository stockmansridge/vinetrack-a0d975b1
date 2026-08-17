// Stage 3B — the single canonical mapper from the Spray Application draft to
// the existing `spray_jobs` contract. No step, panel or component writes to the
// database directly: everything funnels through `toSprayJobInput`.
//
// Nothing here recalculates. Numbers come from the Stage 3A calculation result;
// this module only decides which canonical raw value lands in which column.
import {
  OPERATION_TYPE_LABEL,
  OPERATION_TYPE_TO_MODE,
  SPRAY_TARGET_LABEL,
  persistedHeadTarget,
  type SprayApplication,
  type SprayProductLine,
} from "@/lib/sprayApplicationDomain";
import type { ApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import type { CarrierResult, SprayCalculationResult } from "@/lib/sprayCalculation";
import type { SprayJobChemicalLine, SprayJobInput } from "@/lib/sprayJobsQuery";
import { chemUnitOnly } from "@/lib/rateBasis";

const pos = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const round = (v: number | null | undefined, dp = 4): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp;

/** Free-text `target` kept in sync for legacy readers/exports — display only. */
export function legacyTargetText(app: SprayApplication): string | null {
  const note = (app.otherTargetNote ?? "").trim();
  const structured = (app.targets ?? []).map((t) => SPRAY_TARGET_LABEL[t]);
  if (structured.length) {
    const text = structured.join(", ");
    return note ? `${text} — ${note}` : text;
  }
  if (note) return note;
  return app.legacyTargetText ?? null;
}

export function toChemicalLine(line: SprayProductLine): SprayJobChemicalLine {
  const basis = line.rateBasis ?? "whole_block_area";
  return {
    chemical_id: line.savedChemicalId ?? null,
    savedChemicalId: line.savedChemicalId ?? null,
    name: line.productName ?? null,
    active_ingredient:
      line.intelligence?.actives?.map((a) => a.name).filter(Boolean).join(" + ") ||
      line.intelligence?.legacy.activeIngredient ||
      null,
    rate: line.rate ?? null,
    unit: chemUnitOnly(line.unit ?? "") || line.unit || null,
    product_rate_basis: basis,
    // iOS compatibility only knows two bases; treated_area / per_100_metres are
    // area-style rates from its point of view.
    rate_basis: basis === "per_100_litres" ? "per_100_litres" : "per_hectare",
    costPerUnit: line.costPerUnit ?? null,
    notes: line.notes ?? null,
  };
}

export interface SaveMapping {
  input: SprayJobInput;
  paddockIds: string[];
}

/**
 * Map a draft + its Stage 3A calculation into the persisted job payload.
 *
 * Templates are block-free: no blocks and no geometry outcomes are persisted,
 * so a template can never replay stale geometry.
 */
export function toSprayJobInput(args: {
  application: SprayApplication;
  geometry: ApplicationGeometry;
  calculation: SprayCalculationResult;
}): SaveMapping {
  const app = args.application;
  const geometry: ApplicationGeometry = args.geometry;
  const carrier: CarrierResult = args.calculation.carrier;
  const isTemplate = app.isTemplate;

  const mode = app.mode ?? (app.operationType ? OPERATION_TYPE_TO_MODE[app.operationType] : null);
  const headTarget = persistedHeadTarget(app.operationType, app.headTarget);

  const litresPerHectare =
    app.carrier.basis === "l_per_ha"
      ? pos(app.carrier.litresPerHectare)
      : pos(carrier.litresPerHectare);

  const input: SprayJobInput = {
    vineyard_id: app.vineyardId ?? "",
    name: app.name ?? null,
    is_template: isTemplate,
    planned_date: isTemplate ? null : app.plannedDate ?? null,
    status: isTemplate ? null : app.status ?? "draft",
    operation_type: app.operationType ? OPERATION_TYPE_LABEL[app.operationType] : null,
    application_mode: mode,
    target: legacyTargetText(app),
    targets: app.targets ? [...app.targets] : null,
    spray_head_target: headTarget,
    growth_stage_code: app.growthStageCode ?? null,
    tractor_id: app.tractorId ?? null,
    equipment_id: app.equipmentId ?? null,
    operator_user_id: isTemplate ? null : app.operatorUserId ?? null,
    notes: app.notes ?? null,
    chemical_lines: app.products.map(toChemicalLine),

    carrier_volume_basis: app.carrier.basis,
    spray_rate_per_ha: round(litresPerHectare, 2),
    applied_litres_per_100m: round(pos(app.carrier.appliedLitresPer100m), 3),
    dilute_litres_per_100m: round(pos(app.carrier.diluteLitresPer100m), 3),
    concentration_factor: round(carrier.concentrationFactor, 3),
    water_volume: isTemplate ? null : round(carrier.totalCarrierLitres, 1),

    band_width_total_metres: mode === "banded" ? pos(app.totalTreatedBandWidthMetres) : null,
    row_spacing_metres: isTemplate
      ? pos(app.geometryOverride.rowSpacingMetres)
      : pos(app.geometryOverride.rowSpacingMetres) ?? pos(geometry.rowSpacingMetres),

    gross_area_ha: isTemplate ? null : round(geometry.grossAreaHa, 4),
    treated_area_ha: isTemplate ? null : round(geometry.treatedAreaHa, 4),
    canonical_row_length_metres: isTemplate ? null : round(geometry.canonicalRowLengthMetres, 2),
    geometry_source: isTemplate ? null : geometry.geometrySource,
    geometry_quality: isTemplate ? null : geometry.geometryQuality,
  };

  return { input, paddockIds: isTemplate ? [] : [...app.blockIds] };
}
