// Physical form of a registered product — generic, contract-driven.
//
// The shared `chemical-info-lookup` backend states the product's physical form
// as `form_type` ("solid" | "liquid") or does not state it at all. This module
// is the ONLY place the portal decides a physical form, and it decides it from
// that field alone.
//
// NON-NEGOTIABLE RULES
//  * unknown NEVER becomes "liquid" (or "solid").
//  * physical form is NEVER inferred from a concentration unit (g/kg, g/L),
//    an application rate unit (g/100 L, mL/100 L, kg/ha, L/ha), a rate basis
//    or a spray-water volume. Those are separate concepts.
//  * the inventory (product) unit derived from a KNOWN form is only a sensible
//    editable default; it is not evidence.
//  * there is no product-specific behaviour of any kind here.

export type PhysicalForm = "solid" | "liquid" | "unknown";

/** Inventory / product unit, distinct from pack, concentration and rate units. */
export type InventoryUnit = "kg" | "L";

/** Pack / container unit vocabulary used by the purchase editor. */
export type PackUnit = "Litres" | "mL" | "Kg" | "g";

const SOLID_TOKENS = new Set(["solid", "solids"]);
const LIQUID_TOKENS = new Set(["liquid", "liquids"]);

/**
 * Parse an authoritative `form_type`. Anything that is not an explicit
 * solid/liquid statement — including formulation codes such as WG, SC or EC,
 * empty strings and nulls — is "unknown".
 */
export function parsePhysicalForm(value: unknown): PhysicalForm {
  const raw =
    value && typeof value === "object"
      ? ((value as Record<string, unknown>).form_type ??
        (value as Record<string, unknown>).value ??
        (value as Record<string, unknown>).physical_form)
      : value;
  const token = String(raw ?? "").trim().toLowerCase();
  if (SOLID_TOKENS.has(token)) return "solid";
  if (LIQUID_TOKENS.has(token)) return "liquid";
  return "unknown";
}

/** Inventory unit default for a known physical form; unset when unknown. */
export function inventoryUnitForForm(form: PhysicalForm): InventoryUnit | undefined {
  if (form === "solid") return "kg";
  if (form === "liquid") return "L";
  return undefined;
}

/** Initial (editable) pack unit suggestion; unset when the form is unknown. */
export function packUnitForForm(form: PhysicalForm): PackUnit | undefined {
  if (form === "solid") return "Kg";
  if (form === "liquid") return "Litres";
  return undefined;
}

/**
 * Physical form implied by an INVENTORY unit the operator already chose.
 * Unlike `inferProductType()` in rateBasis.ts this never defaults to liquid.
 */
export function formFromInventoryUnit(unit?: string | null): PhysicalForm {
  const u = String(unit ?? "")
    .replace(/\s*\/\s*(ha|100\s*l|100l|100litres?)\b/i, "")
    .trim()
    .toLowerCase();
  if (!u) return "unknown";
  if (["kg", "kilogram", "kilograms", "g", "gram", "grams"].includes(u)) return "solid";
  if (["l", "litre", "litres", "ml", "millilitre", "millilitres"].includes(u)) return "liquid";
  return "unknown";
}

export const PHYSICAL_FORM_LABEL: Record<PhysicalForm, string> = {
  solid: "Solid",
  liquid: "Liquid",
  unknown: "Not resolved",
};
