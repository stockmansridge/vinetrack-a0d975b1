import { supabase } from "@/integrations/ios-supabase/client";
import { asList, fetchV3Revision, isV3RevisionEditable, pick } from "@/lib/chemicalV3";

export const V3_INGREDIENT_RPC = "chemical_v3_admin_set_active_ingredients";
// Release only after shared-backend deployment + signed-in save/reload/approval acceptance.
export const V3_INGREDIENT_SAVING_ENABLED = false;
export interface IngredientDraft {
  name: string;
  concentration: string;
  unit: string;
  original: Record<string, unknown>;
}
export function ingredientDrafts(value: unknown): IngredientDraft[] {
  return asList(value).map((entry) => {
    const original = typeof entry === "object" && entry !== null ? entry : {};
    return {
      name: typeof entry === "string" ? entry : String(pick(original, "name", "active_ingredient", "ingredient", "active_name", "label") ?? ""),
      concentration: String(pick(original, "concentration", "amount", "value") ?? ""),
      unit: String(pick(original, "concentration_unit", "unit") ?? ""),
      original,
    };
  });
}
export function buildIngredients(drafts: IngredientDraft[]): Record<string, unknown>[] {
  return drafts.map((d, index) => {
    const concentration = Number(d.concentration.trim());
    if (!d.name.trim()) throw new Error(`Ingredient ${index + 1}: enter a name.`);
    if (!d.concentration.trim() || !Number.isFinite(concentration) || concentration <= 0) {
      throw new Error(`Ingredient ${index + 1}: enter a concentration greater than zero.`);
    }
    if (!d.unit.trim()) throw new Error(`Ingredient ${index + 1}: enter the label concentration unit.`);
    // Preserve extra label/provenance keys; update existing aliases rather than discard them.
    const row = { ...d.original, name: d.name.trim(), concentration, concentration_unit: d.unit.trim() };
    for (const key of ["active_ingredient", "ingredient", "active_name", "label"]) {
      if (key in d.original) row[key] = d.name.trim();
    }
    for (const key of ["amount", "value"]) {
      if (key in d.original) row[key] = concentration;
    }
    if ("unit" in d.original) row.unit = d.unit.trim();
    return row;
  });
}
function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equalJson(v, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
    return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((k) => k in y && equalJson(x[k], y[k]));
  }
  return false;
}
/** RPC only; a successful HTTP response is not proof of a saved revision. */
export async function saveAndConfirmV3Ingredients(revisionId: string, drafts: IngredientDraft[]) {
  const ingredients = buildIngredients(drafts);
  const { error } = await supabase.rpc(V3_INGREDIENT_RPC, {
    p_revision_id: revisionId, p_active_ingredients: ingredients,
  });
  if (error) throw error;
  const revision = await fetchV3Revision(revisionId);
  if (!revision || revision.id !== revisionId || !isV3RevisionEditable(revision.review_status) || !equalJson(revision.active_ingredients, ingredients)) {
    throw new Error("Saved ingredients could not be confirmed. Reload and verify this revision before approving.");
  }
  return revision;
}