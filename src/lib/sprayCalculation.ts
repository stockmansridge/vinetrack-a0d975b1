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
  /** Dilute ÷ applied, when both are known. */
  concentrationFactor: number | null;
  /** The hectares the carrier rate was applied to. */
  carrierAreaHa: number | null;
  diagnostics: SprayDiagnostic[];
}

/**
 * For banded applications an L/ha carrier rate is applied to the treated
 * (band) hectares. Callers may override while the mobile semantics are being
 * confirmed with Rork.
 */
export type BandedCarrierArea = "treated" | "gross";

export function calculateCarrier(args: {
  geometry: ApplicationGeometry;
  mode: ApplicationMode | null;
  carrier: SprayApplication["carrier"];
  bandedCarrierArea?: BandedCarrierArea;
}): CarrierResult {
  const { geometry, mode, carrier } = args;
  const diagnostics: SprayDiagnostic[] = [];
  const basis = carrier.basis;

  const grossAreaHa = geometry.grossAreaHa;
  const treatedAreaHa = geometry.treatedAreaHa;
  const carrierAreaHa =
    mode === "banded"
      ? (args.bandedCarrierArea ?? "treated") === "gross"
        ? grossAreaHa
        : treatedAreaHa
      : treatedAreaHa ?? grossAreaHa;

  const applied100m = pos(carrier.appliedLitresPer100m);
  const dilute100m = pos(carrier.diluteLitresPer100m);
  const lPerHa = pos(carrier.litresPerHectare);

  let totalCarrierLitres: number | null = null;
  let litresPerHectare: number | null = null;
  let litresPer100m: number | null = null;

  if (!basis) {
    if (mode === "spreader") {
      diagnostics.push({
        code: "spreader_no_carrier",
        severity: "info",
        message: "Spreader application — no carrier volume required.",
      });
    } else {
      diagnostics.push({
        code: "missing_carrier_basis",
        severity: "error",
        message: "Carrier volume basis is not set.",
      });
    }
  } else if (basis === "litres_per_hectare") {
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
      totalCarrierLitres = lPerHa * carrierAreaHa;
      if (geometry.rowSpacingMetres != null && geometry.rowSpacingMetres > 0) {
        litresPer100m = (lPerHa * geometry.rowSpacingMetres) / 100;
      }
    }
  } else {
    // litres_per_100m
    const rate100m = applied100m ?? dilute100m;
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
      if (geometry.rowSpacingMetres != null && geometry.rowSpacingMetres > 0) {
        litresPerHectare = (rate100m * 100) / geometry.rowSpacingMetres;
      } else if (carrierAreaHa != null && carrierAreaHa > 0) {
        litresPerHectare = totalCarrierLitres / carrierAreaHa;
      } else {
        diagnostics.push({
          code: "cannot_derive_litres_per_hectare",
          severity: "warning",
          message: "Row spacing unknown — the equivalent L/ha cannot be derived.",
        });
      }
    }
  }

  let concentrationFactor = pos(carrier.concentrationFactor);
  if (dilute100m != null && applied100m != null && applied100m > 0) {
    concentrationFactor = dilute100m / applied100m;
    if (concentrationFactor < 1) {
      diagnostics.push({
        code: "concentration_factor_below_one",
        severity: "warning",
        message: "Applied volume exceeds the dilute volume — check the entered rates.",
      });
    }
  }

  return {
    basis,
    totalCarrierLitres,
    litresPerHectare,
    litresPer100m,
    concentrationFactor,
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
  /** The multiplier the rate was applied to (ha or 100 L units). */
  multiplier: number | null;
  multiplierKind: "gross_hectares" | "treated_hectares" | "hundred_litres" | null;
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
    const rate = Number.isFinite(Number(line.rate)) ? Number(line.rate) : null;
    let multiplier: number | null = null;
    let multiplierKind: ProductResult["multiplierKind"] = null;

    if (!line.rateBasis) {
      diagnostics.push({
        code: "missing_rate_basis",
        severity: "error",
        message: `Rate basis is not set for ${line.productName ?? "this product"}.`,
        productIndex: index,
      });
    } else if (line.rateBasis === "per_hectare") {
      multiplierKind = "gross_hectares";
      multiplier = geometry.grossAreaHa;
    } else if (line.rateBasis === "per_treated_hectare") {
      multiplierKind = "treated_hectares";
      multiplier = geometry.treatedAreaHa;
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
    if (multiplier == null && line.rateBasis && line.rateBasis !== "per_100_litres") {
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
  bandedCarrierArea?: BandedCarrierArea;
}): SprayCalculationResult {
  const { application, geometry } = args;
  const carrier = calculateCarrier({
    geometry,
    mode: application.mode,
    carrier: application.carrier,
    bandedCarrierArea: args.bandedCarrierArea,
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
  mixed_row_spacing: "Selected blocks have different row spacings — an area-weighted spacing was used.",
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
