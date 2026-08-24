// Stage 3A — the single authoritative spray calculation pipeline.
//
//   row geometry → application geometry → carrier volume → product quantities → tanks
//
// Every stage is pure and deterministic. Nothing is guessed: when an input is
// missing the result is `null` plus a diagnostic code, so the UI can say
// "geometry incomplete" instead of quietly printing a wrong number.
import type {
  ApplicationMode,
  CarrierBasis,
  OperationType,
  SprayApplication,
  SprayProductLine,
} from "@/lib/sprayApplicationDomain";
import type { ApplicationGeometry } from "@/lib/sprayApplicationGeometry";

export type SprayDiagnosticSeverity = "error" | "warning" | "info";

export interface SprayDiagnostic {
  code: string;
  severity: SprayDiagnosticSeverity;
  message: string;
  /** Index into `products` when the diagnostic belongs to one line. */
  productIndex?: number;
}

const pos = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* ------------------------------------------------------------- carrier */

export interface CarrierResult {
  basis: CarrierBasis | null;
  /** Total carrier volume for the whole application, in litres. */
  totalCarrierLitres: number | null;
  /** Effective L/ha, derived when the basis is L/100 m. */
  litresPerHectare: number | null;
  /** Effective L/100 m, derived when the basis is L/ha. */
  litresPer100m: number | null;
  /**
   * Manual basis only: the derived L/ha and L/100 m above are REFERENCE ONLY.
   * They are never inputs and never block the application.
   */
  derivedRatesAreReferenceOnly: boolean;
  /** The AWRI dilute/runoff recommendation this application was judged against. */
  recommendedDiluteLitresPer100m: number | null;
  recommendedDiluteLitresPerHectare: number | null;
  /** max(1, dilute ÷ applied), or the persisted value when one exists. */
  concentrationFactor: number | null;
  concentrationFactorSource: "persisted" | "derived" | "manual" | null;
  /**
   * The hectares the carrier rate was applied to. For an L/ha carrier this is
   * ALWAYS the gross application hectares — including banded applications.
   */
  carrierAreaHa: number | null;
  diagnostics: SprayDiagnostic[];
}

/** CF is floored at 1: applied volume above the dilute reference never dilutes. */
export function concentrationFactorFrom(
  dilute: number | null | undefined,
  applied: number | null | undefined,
): number | null {
  const d = pos(dilute);
  const a = pos(applied);
  if (d == null || a == null) return null;
  return Math.max(1, d / a);
}

export function calculateCarrier(args: {
  geometry: ApplicationGeometry;
  mode: ApplicationMode | null;
  operationType?: OperationType | null;
  carrier: SprayApplication["carrier"];
}): CarrierResult {
  const { geometry, mode, carrier } = args;
  const diagnostics: SprayDiagnostic[] = [];
  const basis = carrier.basis;

  // Carrier hectares are gross hectares. Treated hectares belong to products.
  const carrierAreaHa = geometry.grossAreaHa;

  const applied100m = pos(carrier.appliedLitresPer100m);
  const dilute100m = pos(carrier.diluteLitresPer100m);
  const lPerHa = pos(carrier.litresPerHectare);
  const diluteLPerHa = pos(carrier.diluteLitresPerHectare);
  const manualTotal = pos(carrier.manualTotalLitres);

  // The canopy answer only ever produces a RECOMMENDATION. What the sprayer
  // actually applies is always the operator's recorded value.
  const recommendedPer100m = recommendedDiluteLitresPer100m(
    carrier.canopyType ?? null,
    carrier.canopySize ?? null,
    carrier.canopyDensity ?? null,
  );
  const recommendedPerHa = litresPerHectareFromPer100m(
    recommendedPer100m,
    geometry.rowSpacingMetres,
  );

  let totalCarrierLitres: number | null = null;
  let litresPerHectare: number | null = null;
  let litresPer100m: number | null = null;
  let derivedRatesAreReferenceOnly = false;

  if (!basis) {
    if (args.operationType === "spreader") {
      diagnostics.push({
        code: "spreader_no_carrier",
        severity: "info",
        message: "Spreader application — no carrier volume required.",
      });
    } else {
      diagnostics.push({
        code: "missing_carrier_basis",
        severity: "error",
        message: "Spray volume basis is not set.",
      });
    }
  } else if (basis === "manual") {
    // A deliberate bypass: no canopy, no row spacing, no row length, no
    // calibrated rate. The operator states the total water being mixed.
    derivedRatesAreReferenceOnly = true;
    if (manualTotal == null) {
      diagnostics.push({
        code: "missing_manual_total_water",
        severity: "error",
        message: "Enter the total spray water for this application.",
      });
    } else {
      totalCarrierLitres = manualTotal;
      // Reference figures only — shown when geometry happens to exist, never
      // required and never a blocker.
      if (geometry.grossAreaHa != null && geometry.grossAreaHa > 0) {
        litresPerHectare = manualTotal / geometry.grossAreaHa;
      }
      if (geometry.canonicalRowLengthMetres != null && geometry.canonicalRowLengthMetres > 0) {
        litresPer100m = manualTotal / (geometry.canonicalRowLengthMetres / 100);
      }
    }
  } else if (basis === "l_per_ha") {
    if (lPerHa == null) {
      diagnostics.push({

        code: "missing_carrier_rate",
        severity: "error",
        message: "Carrier rate (L/ha) is not set.",
      });
    } else if (carrierAreaHa == null) {
      diagnostics.push({
        code: "incomplete_geometry_for_carrier",
        severity: "error",
        message: "Cannot compute carrier volume — block geometry is incomplete.",
      });
    } else {
      litresPerHectare = lPerHa;
      // Gross hectares — banded included, per the confirmed Rork contract.
      totalCarrierLitres = lPerHa * carrierAreaHa;
      if (geometry.uniformRowSpacing && geometry.rowSpacingMetres != null && geometry.rowSpacingMetres > 0) {
        litresPer100m = (lPerHa * geometry.rowSpacingMetres) / 100;
      }
    }
  } else {
    // l_per_100m — never falls back to an L/ha calculation.
    //
    // Dilute/runoff L/100 m and actual applied L/100 m are DIFFERENT numbers
    // and must never be conflated. The applied volume is authoritative; the
    // only permitted derivation is dilute ÷ a persisted concentration factor,
    // and that is reported as derived.
    const persistedCf = pos(carrier.concentrationFactor);
    let rate100m = applied100m;
    if (rate100m == null && dilute100m != null && persistedCf != null) {
      rate100m = dilute100m / persistedCf;
      diagnostics.push({
        code: "applied_rate_derived_from_dilute",
        severity: "info",
        message: `Applied water derived from the dilute reference ÷ concentration factor (${persistedCf}×).`,
      });
    } else if (rate100m == null && dilute100m != null) {
      diagnostics.push({
        code: "dilute_only_carrier_rate",
        severity: "error",
        message:
          "Only the dilute/runoff L/100 m is set. Enter the actual applied L/100 m — the dilute reference is not the applied volume.",
      });
    }
    if (rate100m == null) {
      diagnostics.push({
        code: "missing_carrier_rate",
        severity: "error",
        message: "Carrier rate (L/100 m) is not set.",
      });
    } else if (geometry.canonicalRowLengthMetres == null) {
      diagnostics.push({
        code: "incomplete_geometry_for_carrier",
        severity: "error",
        message: "Cannot compute carrier volume — canonical row length is unknown.",
      });
    } else {
      litresPer100m = rate100m;
      totalCarrierLitres = (geometry.canonicalRowLengthMetres / 100) * rate100m;
      if (geometry.uniformRowSpacing && geometry.rowSpacingMetres != null && geometry.rowSpacingMetres > 0) {
        // L/ha = L/100 m × 100 ÷ row spacing.
        litresPerHectare = (rate100m * 100) / geometry.rowSpacingMetres;
      } else {
        diagnostics.push({
          code: "cannot_derive_litres_per_hectare",
          severity: "warning",
          message: geometry.uniformRowSpacing
            ? "Row spacing unknown — the equivalent L/ha cannot be derived."
            : "Blocks have different row spacings — the equivalent L/ha cannot be derived.",
        });
      }
    }
  }

  // Concentration factor: a persisted value is authoritative history.
  let concentrationFactor = pos(carrier.concentrationFactor);
  let concentrationFactorSource: CarrierResult["concentrationFactorSource"] =
    concentrationFactor != null ? "persisted" : null;
  if (concentrationFactor == null) {
    const derived =
      basis === "l_per_ha"
        ? concentrationFactorFrom(diluteLPerHa, lPerHa)
        : concentrationFactorFrom(dilute100m, applied100m);
    if (derived != null) {
      concentrationFactor = derived;
      concentrationFactorSource = "derived";
    }
  }

  return {
    basis,
    totalCarrierLitres,
    litresPerHectare,
    litresPer100m,
    concentrationFactor,
    concentrationFactorSource,
    carrierAreaHa,
    diagnostics,
  };
}

/* ------------------------------------------------------------ products */

export type RateValidation = "in_range" | "below_range" | "above_range" | "unable_to_validate";

export interface ProductResult {
  index: number;
  savedChemicalId: string | null;
  productName: string | null;
  rate: number | null;
  unit: string | null;
  rateBasis: SprayProductLine["rateBasis"];
  /** Total product for the whole application, in the line's unit. */
  totalQuantity: number | null;
  /** The multiplier the rate was applied to (ha, 100 L or 100 m units). */
  multiplier: number | null;
  multiplierKind:
    | "whole_block_hectares"
    | "treated_hectares"
    | "hundred_litres"
    | "hundred_metres"
    | null;
  rateValidation: RateValidation;
  diagnostics: SprayDiagnostic[];
}

export function validateRate(line: SprayProductLine): RateValidation {
  const rate = Number(line.rate);
  if (!Number.isFinite(rate)) return "unable_to_validate";
  const min = line.labelMinRate ?? null;
  const max = line.labelMaxRate ?? null;
  if (min == null && max == null) return "unable_to_validate";
  if (min != null && rate < min) return "below_range";
  if (max != null && rate > max) return "above_range";
  return "in_range";
}

export function calculateProducts(args: {
  products: SprayProductLine[];
  geometry: ApplicationGeometry;
  carrier: CarrierResult;
}): ProductResult[] {
  const { products, geometry, carrier } = args;
  return products.map((line, index) => {
    const diagnostics: SprayDiagnostic[] = [];
    // `Number(null)` is 0 — an empty rate must never become a zero rate.
    const rawRate = line.rate;
    const rate =
      rawRate == null || rawRate === ("" as unknown) || !Number.isFinite(Number(rawRate))
        ? null
        : Number(rawRate);
    let multiplier: number | null = null;
    let multiplierKind: ProductResult["multiplierKind"] = null;

    if (!line.rateBasis) {
      diagnostics.push({
        code: "missing_rate_basis",
        severity: "error",
        message: `Rate basis is not set for ${line.productName ?? "this product"}.`,
        productIndex: index,
      });
    } else if (line.rateBasis === "whole_block_area") {
      multiplierKind = "whole_block_hectares";
      multiplier = geometry.grossAreaHa;
    } else if (line.rateBasis === "treated_area") {
      multiplierKind = "treated_hectares";
      multiplier = geometry.treatedAreaHa;
    } else if (line.rateBasis === "per_100_metres") {
      multiplierKind = "hundred_metres";
      multiplier =
        geometry.canonicalRowLengthMetres != null
          ? geometry.canonicalRowLengthMetres / 100
          : null;
      if (multiplier == null) {
        diagnostics.push({
          code: "per_100m_needs_row_length",
          severity: "error",
          message: `${line.productName ?? "Product"} is rated per 100 m but the canonical row length is unknown.`,
          productIndex: index,
        });
      }
    } else {
      multiplierKind = "hundred_litres";
      multiplier =
        carrier.totalCarrierLitres != null ? carrier.totalCarrierLitres / 100 : null;
      if (multiplier == null) {
        diagnostics.push({
          code: "per_100l_needs_carrier",
          severity: "error",
          message: `${line.productName ?? "Product"} is rated per 100 L but the carrier volume is unknown.`,
          productIndex: index,
        });
      }
    }

    if (rate == null) {
      diagnostics.push({
        code: "missing_rate",
        severity: "error",
        message: `No rate entered for ${line.productName ?? "this product"}.`,
        productIndex: index,
      });
    }
    if (
      multiplier == null &&
      line.rateBasis &&
      line.rateBasis !== "per_100_litres" &&
      line.rateBasis !== "per_100_metres"
    ) {
      diagnostics.push({
        code: "incomplete_geometry_for_product",
        severity: "error",
        message: `Cannot compute ${line.productName ?? "product"} quantity — block geometry is incomplete.`,
        productIndex: index,
      });
    }
    if (!line.savedChemicalId) {
      diagnostics.push({
        code: "unlinked_product",
        severity: "warning",
        message: `${line.productName ?? "Product"} is not linked to a saved chemical.`,
        productIndex: index,
      });
    }

    const rateValidation = validateRate(line);
    if (rateValidation === "above_range") {
      diagnostics.push({
        code: "rate_above_label",
        severity: "warning",
        message: `${line.productName ?? "Product"} rate is above the label range.`,
        productIndex: index,
      });
    } else if (rateValidation === "below_range") {
      diagnostics.push({
        code: "rate_below_label",
        severity: "warning",
        message: `${line.productName ?? "Product"} rate is below the label range.`,
        productIndex: index,
      });
    }

    return {
      index,
      savedChemicalId: line.savedChemicalId,
      productName: line.productName,
      rate,
      unit: line.unit,
      rateBasis: line.rateBasis,
      totalQuantity: rate != null && multiplier != null ? rate * multiplier : null,
      multiplier,
      multiplierKind,
      rateValidation,
      diagnostics,
    };
  });
}

/* --------------------------------------------------------------- tanks */

export interface TankProduct {
  index: number;
  productName: string | null;
  unit: string | null;
  quantity: number | null;
}

export interface TankLoad {
  tankNumber: number;
  carrierLitres: number;
  isPartial: boolean;
  products: TankProduct[];
}

export interface TankResult {
  tanks: TankLoad[];
  fullTanks: number;
  partialTankLitres: number | null;
  tankCapacityLitres: number | null;
  diagnostics: SprayDiagnostic[];
}

/**
 * Split the total carrier volume into tank loads and apportion each product
 * pro-rata. Product totals are conserved exactly: the final tank absorbs any
 * floating-point remainder.
 */
export function calculateTanks(args: {
  totalCarrierLitres: number | null;
  tankCapacityLitres: number | null;
  products: ProductResult[];
}): TankResult {
  const diagnostics: SprayDiagnostic[] = [];
  const total = pos(args.totalCarrierLitres);
  const capacity = pos(args.tankCapacityLitres);

  if (total == null) {
    diagnostics.push({
      code: "no_carrier_for_tanks",
      severity: "info",
      message: "No carrier volume — tank loads are not applicable.",
    });
    return { tanks: [], fullTanks: 0, partialTankLitres: null, tankCapacityLitres: capacity, diagnostics };
  }
  if (capacity == null) {
    diagnostics.push({
      code: "missing_tank_capacity",
      severity: "warning",
      message: "Tank capacity is not set — the mix cannot be split into loads.",
    });
    return { tanks: [], fullTanks: 0, partialTankLitres: null, tankCapacityLitres: null, diagnostics };
  }

  const fullTanks = Math.floor(total / capacity);
  const remainder = total - fullTanks * capacity;
  const loads: number[] = Array.from({ length: fullTanks }, () => capacity);
  if (remainder > 1e-6) loads.push(remainder);
  if (!loads.length) loads.push(total);

  const tanks: TankLoad[] = loads.map((litres, i) => {
    const isLast = i === loads.length - 1;
    return {
      tankNumber: i + 1,
      carrierLitres: litres,
      isPartial: isLast && remainder > 1e-6 && loads.length > fullTanks,
      products: args.products.map((p) => {
        if (p.totalQuantity == null) return { index: p.index, productName: p.productName, unit: p.unit, quantity: null };
        const share = (litres / total) * p.totalQuantity;
        if (!isLast) return { index: p.index, productName: p.productName, unit: p.unit, quantity: share };
        // Conserve the total exactly on the final tank.
        const allocated = loads
          .slice(0, -1)
          .reduce((acc, l) => acc + (l / total) * (p.totalQuantity as number), 0);
        return {
          index: p.index,
          productName: p.productName,
          unit: p.unit,
          quantity: (p.totalQuantity as number) - allocated,
        };
      }),
    };
  });

  return {
    tanks,
    fullTanks,
    partialTankLitres: remainder > 1e-6 ? remainder : null,
    tankCapacityLitres: capacity,
    diagnostics,
  };
}

/* ---------------------------------------------------------- orchestrator */

export interface SprayCalculationResult {
  geometry: ApplicationGeometry;
  carrier: CarrierResult;
  products: ProductResult[];
  tanks: TankResult;
  diagnostics: SprayDiagnostic[];
  /** True when nothing blocks the application from being recorded. */
  canRecord: boolean;
}

export function calculateSprayApplication(args: {
  application: SprayApplication;
  geometry: ApplicationGeometry;
}): SprayCalculationResult {
  const { application, geometry } = args;
  const carrier = calculateCarrier({
    geometry,
    mode: application.mode,
    operationType: application.operationType,
    carrier: application.carrier,
  });
  const products = calculateProducts({ products: application.products, geometry, carrier });
  const tanks = calculateTanks({
    totalCarrierLitres: carrier.totalCarrierLitres,
    tankCapacityLitres: application.tankCapacityLitres,
    products,
  });

  const diagnostics: SprayDiagnostic[] = [
    ...geometry.issues.map<SprayDiagnostic>((code) => ({
      code,
      severity: code === "mixed_row_spacing" ? "warning" : "error",
      message: GEOMETRY_ISSUE_MESSAGE[code] ?? `Geometry issue: ${code}`,
    })),
    ...carrier.diagnostics,
    ...products.flatMap((p) => p.diagnostics),
    ...tanks.diagnostics,
  ];
  if (!application.mode) {
    diagnostics.unshift({
      code: "missing_application_mode",
      severity: "error",
      message: "Application method is not set.",
    });
  }
  if (!application.products.length) {
    diagnostics.push({
      code: "no_products",
      severity: "error",
      message: "No products have been added.",
    });
  }

  return {
    geometry,
    carrier,
    products,
    tanks,
    diagnostics,
    canRecord: !diagnostics.some((d) => d.severity === "error"),
  };
}

const GEOMETRY_ISSUE_MESSAGE: Record<string, string> = {
  no_blocks_selected: "No blocks selected.",
  missing_gross_area: "One or more blocks have no gross area.",
  missing_row_spacing: "One or more blocks have no row spacing.",
  missing_row_length: "One or more blocks have no row length.",
  missing_treated_area: "Treated area could not be established.",
  missing_band_width: "Banded application requires a total treated band width.",
  incomplete_block_geometry: "One or more selected blocks have incomplete geometry.",
  mixed_row_spacing: "Selected blocks have different row spacings — no equivalent L/ha is derived.",
};

/* ------------------------------------------------------------ rounding */

/**
 * Rounding is a presentation concern only — every calculation above keeps full
 * precision and rounds once, at the edge.
 */
export const roundLitres = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;

export const roundProduct = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;

export const roundArea = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
