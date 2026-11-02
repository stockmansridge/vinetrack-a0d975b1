// Saved-chemical physical unit vs the APPROVED catalogue revision.
//
// Read-only assessment plus the exact, minimal correction preview. Never
// converts quantities, rates, density, pack sizes, inventory or spray history:
// a correction only relabels the saved product's physical unit/form, and only
// when the linked approved revision is an explicitly recognised DRY formulation
// whose catalogue rates are all weight-based.
//
// The correction write is a shared-backend RPC. It is NOT deployed yet, so the
// confirm action is gated off by SAVED_CHEMICAL_UNIT_CORRECTION_RPC_DEPLOYED.
// The required contract is in docs/saved-chemical-physical-unit-correction.md.
import { formFromInventoryUnit, parsePhysicalForm, type PhysicalForm } from "@/lib/chemicalPhysicalForm";
import { asList, pick, textOf } from "@/lib/chemicalV3";

type Row = Record<string, any>;

export const SAVED_CHEMICAL_UNIT_CORRECTION_RPC = "correct_saved_chemical_physical_unit";
/** Flip only after the shared backend function in the docs is deployed and verified. */
export const SAVED_CHEMICAL_UNIT_CORRECTION_RPC_DEPLOYED = false;

// Explicit allow-lists. Anything not listed is "unknown" — never liquid by default.
const DRY_FORMULATIONS = new Set([
  "dry flowable", "df", "wg", "wdg", "water dispersible granule", "water dispersible granules",
  "wettable granule", "wettable granules", "wp", "wettable powder", "sp", "soluble powder",
  "sg", "soluble granule", "soluble granules", "granule", "granules", "gr", "dust", "dp",
  "powder", "solid", "solids",
]);
const LIQUID_FORMULATIONS = new Set([
  "liquid", "liquids", "ec", "emulsifiable concentrate", "sc", "suspension concentrate",
  "sl", "soluble concentrate", "soluble liquid", "ew", "emulsion, oil in water", "me", "microemulsion",
  "se", "suspo-emulsion", "od", "oil dispersion", "cs", "capsule suspension", "fs",
]);

const norm = (v: unknown) => String(textOf(v) ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/®|™/g, "");

/** Catalogue product_form → physical form. Unrecognised formulations stay "unknown". */
export function catalogueFormulationForm(productForm: unknown): PhysicalForm {
  const t = norm(productForm);
  if (!t) return "unknown";
  if (DRY_FORMULATIONS.has(t)) return "solid";
  if (LIQUID_FORMULATIONS.has(t)) return "liquid";
  return "unknown";
}

export type RateUnitFamily = "weight" | "volume" | "unknown";

/** Numerator family of a rate unit such as "g/100 L", "kg/ha", "mL/100L". */
export function rateUnitFamily(unit: unknown): RateUnitFamily {
  const numer = norm(unit).split("/")[0].trim();
  if (["g", "kg", "gram", "grams", "kilogram", "kilograms", "mg"].includes(numer)) return "weight";
  if (["l", "ml", "litre", "litres", "liter", "liters", "millilitre", "millilitres"].includes(numer)) return "volume";
  return "unknown";
}

export interface CatalogueRateUnit { unit: string; family: RateUnitFamily }

export function catalogueRateUnits(revision: Row | null | undefined): CatalogueRateUnit[] {
  const seen = new Map<string, CatalogueRateUnit>();
  for (const o of asList(pick(revision ?? {}, "default_rate_options"))) {
    const unit = textOf(pick(o as Row, "unit", "rate_unit"));
    if (unit && !seen.has(unit)) seen.set(unit, { unit, family: rateUnitFamily(unit) });
  }
  return [...seen.values()];
}

export interface CorrectionField { field: "unit" | "product_form"; from: string | null; to: string }

export interface PhysicalUnitAssessment {
  catalogueProductForm: string | null;
  catalogueForm: PhysicalForm;
  rateUnits: CatalogueRateUnit[];
  savedUnit: string | null;
  savedProductForm: string | null;
  savedPackUnit: string | null;
  savedForm: PhysicalForm;
  mismatch: boolean;
  reasons: string[];
  /** Exact correction is allowed (subject to role + deployed server function). */
  correctionEligible: boolean;
  ineligibleReason: string | null;
  preview: CorrectionField[];
  revisionId: string | null;
}

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Saved form: inventory unit wins, then explicit product_form. Never defaults. */
function savedFormOf(row: Row): PhysicalForm {
  const byUnit = formFromInventoryUnit(row.unit);
  if (byUnit !== "unknown") return byUnit;
  return parsePhysicalForm(row.product_form);
}

/**
 * Compare a saved chemical with its APPROVED catalogue revision. Pass the
 * revision only when chemicalCatalogueReference resolved state "approved".
 */
export function assessPhysicalUnit(saved: Row | null | undefined, approvedRevision: Row | null | undefined): PhysicalUnitAssessment | null {
  if (!saved || !approvedRevision) return null;
  const catalogueProductForm = s(textOf(pick(approvedRevision, "product_form")));
  const catalogueForm = catalogueFormulationForm(catalogueProductForm);
  const rateUnits = catalogueRateUnits(approvedRevision);
  const savedForm = savedFormOf(saved);
  const reasons: string[] = [];
  const families = new Set(rateUnits.map((r) => r.family));

  if (catalogueForm !== "unknown" && savedForm !== "unknown" && catalogueForm !== savedForm)
    reasons.push(`Catalogue formulation "${catalogueProductForm}" is ${catalogueForm}, but this vineyard product is saved as ${savedForm}.`);
  if (savedForm === "liquid" && families.has("weight"))
    reasons.push("Catalogue application rates are by weight (g/kg), but this product is saved in a volume unit.");
  if (savedForm === "solid" && families.has("volume"))
    reasons.push("Catalogue application rates are by volume (mL/L), but this product is saved in a weight unit.");
  if (catalogueForm === "unknown" && catalogueProductForm)
    reasons.push(`Catalogue formulation "${catalogueProductForm}" is not a recognised physical form; it is not assumed to be liquid or solid.`);

  const mismatch = reasons.some((r) => !r.includes("not a recognised"));

  let ineligibleReason: string | null = null;
  if (!mismatch) ineligibleReason = "No physical-unit mismatch.";
  else if (catalogueForm !== "solid") ineligibleReason = "Only products whose approved catalogue formulation is a recognised dry formulation can be corrected here.";
  else if (savedForm !== "liquid") ineligibleReason = "This product is not saved as a liquid.";
  else if (!families.has("weight") || families.has("volume") || families.has("unknown"))
    ineligibleReason = "Catalogue rates are not all weight-based, so the correct unit cannot be confirmed.";

  const correctionEligible = mismatch && ineligibleReason === null;
  const preview: CorrectionField[] = correctionEligible
    ? [
        { field: "unit", from: s(saved.unit), to: "Kg" },
        { field: "product_form", from: s(saved.product_form), to: "solid" },
      ]
    : [];

  return {
    catalogueProductForm,
    catalogueForm,
    rateUnits,
    savedUnit: s(saved.unit),
    savedProductForm: s(saved.product_form),
    savedPackUnit: s(saved.pack_unit),
    savedForm,
    mismatch,
    reasons,
    correctionEligible,
    ineligibleReason: correctionEligible ? null : ineligibleReason,
    preview,
    revisionId: s(approvedRevision.id),
  };
}

/** Arguments for the (pending) shared backend correction RPC: optimistic guards included. */
export function buildUnitCorrectionArgs(savedChemicalId: string, a: PhysicalUnitAssessment): Row | null {
  if (!a.correctionEligible || !a.revisionId) return null;
  return {
    p_saved_chemical_id: savedChemicalId,
    p_expected_approved_revision_id: a.revisionId,
    p_expected_unit: a.savedUnit,
    p_expected_product_form: a.savedProductForm,
    p_target_form: "solid",
  };
}
