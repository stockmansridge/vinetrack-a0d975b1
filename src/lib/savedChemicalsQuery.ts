// READ-ONLY query helper for saved_chemicals. No writes.
//
// Schema (docs/supabase-schema.md §3.12):
//   saved_chemicals: name, rate_per_ha, unit, chemical_group, use,
//     manufacturer, restrictions, notes, crop, problem, active_ingredient,
//     rates jsonb, purchase jsonb, label_url, mode_of_action,
//     plus standard sync columns (id, vineyard_id, created_at, updated_at,
//     deleted_at, created_by, updated_by, client_updated_at, sync_version).
//
//   No global/shared chemical library table — every row is scoped to a
//   single vineyard_id. No withholding_period / re_entry_interval column
//   (these typically live inside `restrictions` free text).
import { supabase } from "@/integrations/ios-supabase/client";
import { iosUnitFromAny } from "@/lib/rateBasis";

export interface SavedChemical {
  id: string;
  vineyard_id: string;
  name?: string | null;
  rate_per_ha?: number | null;
  unit?: string | null;
  chemical_group?: string | null;
  use?: string | null;
  manufacturer?: string | null;
  restrictions?: string | null;
  notes?: string | null;
  crop?: string | null;
  problem?: string | null;
  active_ingredient?: string | null;
  rates?: any;
  purchase?: any;
  label_url?: string | null;
  product_url?: string | null;
  mode_of_action?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  client_updated_at?: string | null;
  sync_version?: number | null;
}

export interface SavedChemicalsQueryResult {
  chemicals: SavedChemical[];
  source: "vineyard_id" | "empty";
  vineyardCount: number;
  deletedExcluded: number;
  missingName: number;
  missingRate: number;
}

export async function fetchSavedChemicalsForVineyard(
  vineyardId: string,
  opts: { archived?: boolean } = {},
): Promise<SavedChemicalsQueryResult> {
  let q = supabase.from("saved_chemicals").select("*").eq("vineyard_id", vineyardId);
  q = opts.archived ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
  const res = await q;
  if (res.error) throw res.error;

  const chemicals = (res.data ?? []) as SavedChemical[];
  return {
    chemicals,
    source: chemicals.length ? "vineyard_id" : "empty",
    vineyardCount: chemicals.length,
    deletedExcluded: 0,
    missingName: chemicals.filter((c) => !c.name).length,
    missingRate: chemicals.filter((c) => c.rate_per_ha == null).length,
  };
}

export interface SavedChemicalInput {
  name: string;
  active_ingredient?: string | null;
  chemical_group?: string | null;
  use?: string | null;
  manufacturer?: string | null;
  crop?: string | null;
  problem?: string | null;
  rate_per_ha?: number | null;
  unit?: string | null;
  restrictions?: string | null;
  notes?: string | null;
  label_url?: string | null;
  product_url?: string | null;
  purchase?: {
    costPerUnit?: number | null;
    cost_per_unit?: number | null;
    costPerBaseUnit?: number | null;
    cost_per_base_unit?: number | null;
    currency?: string | null;
    unit?: string | null;
  } | null;
}

const ALLOWED_FIELDS: (keyof SavedChemicalInput)[] = [
  "name", "active_ingredient", "chemical_group", "use", "manufacturer",
  "crop", "problem", "rate_per_ha", "unit", "restrictions", "notes",
  "label_url", "product_url", "purchase",
];

function sanitize(input: SavedChemicalInput) {
  const out: Record<string, any> = {};
  for (const k of ALLOWED_FIELDS) {
    const v = input[k];
    if (v === undefined) continue;
    if (typeof v === "string") {
      const t = v.trim();
      out[k] = t === "" ? null : t;
    } else {
      out[k] = v;
    }
  }
  // iOS stores saved_chemicals.unit as the raw base unit enum
  // ("Litres" | "mL" | "Kg" | "g"), while spray job chemical lines store the
  // combined application unit (e.g. "Litres/ha", "mL/100L").
  if (typeof out.unit === "string" && out.unit) {
    out.unit = iosUnitFromAny(out.unit);
  }
  // saved_chemicals.unit is NOT NULL. Fall back to the iOS liquid base unit
  // if the caller didn't supply one (e.g. AI lookup result missing unit).
  if (out.unit == null || out.unit === "") {
    out.unit = "Litres";
  }
  // Sanitise URL fields — only http(s) URLs are saved; anything else becomes
  // empty string so iOS sees a consistent value. `label_url` is reserved for
  // the official product label / SDS PDF / regulator page. `product_url` is
  // for manufacturer / distributor product pages and must NEVER be displayed
  // as an official label.
  for (const key of ["label_url", "product_url"] as const) {
    if (typeof out[key] === "string" && out[key]) {
      const trimmed = (out[key] as string).trim();
      out[key] = /^https?:\/\//i.test(trimmed) ? trimmed : "";
    }
  }
  // Shared schema columns that are optional in the UI but NOT NULL in the DB
  // must be sent as empty strings instead of null.
  for (const key of [
    "active_ingredient",
    "chemical_group",
    "use",
    "manufacturer",
    "crop",
    "problem",
    "restrictions",
    "notes",
    "label_url",
    "product_url",
  ]) {
    if (out[key] == null) out[key] = "";
  }
  if (out.purchase != null && typeof out.purchase === "object") {
    const purchase = { ...out.purchase } as Record<string, any>;
    const raw = purchase.costPerBaseUnit ?? purchase.cost_per_base_unit
      ?? purchase.costPerUnit ?? purchase.cost_per_unit;
    const cost = raw == null || raw === "" ? null : Number(raw);
    if (Number.isFinite(cost) && cost >= 0) {
      purchase.costPerBaseUnit = cost;
      purchase.cost_per_base_unit = cost;
      if (purchase.costPerUnit == null) purchase.costPerUnit = cost;
      if (purchase.cost_per_unit == null) purchase.cost_per_unit = cost;
    } else {
      delete purchase.costPerBaseUnit;
      delete purchase.cost_per_base_unit;
      delete purchase.costPerUnit;
      delete purchase.cost_per_unit;
    }
    purchase.currency = String(purchase.currency ?? "AUD").trim() || "AUD";
    purchase.unit = iosUnitFromAny(purchase.unit ?? out.unit ?? "Litres");
    out.purchase = Object.keys(purchase).length ? purchase : null;
  }

  return out;
}

export async function createSavedChemical(vineyardId: string, input: SavedChemicalInput) {
  const now = new Date().toISOString();
  const payload = {
    ...sanitize(input),
    vineyard_id: vineyardId,
    client_updated_at: now,
    sync_version: 1,
    deleted_at: null,
  };
  if (import.meta.env.DEV) {
    console.debug("Sanitised saved chemical payload", payload);
  }
  const { data, error } = await supabase
    .from("saved_chemicals")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as SavedChemical;
}

export async function updateSavedChemical(id: string, input: SavedChemicalInput) {
  const payload = {
    ...sanitize(input),
    client_updated_at: new Date().toISOString(),
  };
  if (import.meta.env.DEV) {
    console.debug("Sanitised saved chemical payload", payload);
  }
  const { data, error } = await supabase
    .from("saved_chemicals")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as SavedChemical;
}

export async function archiveSavedChemical(id: string) {
  // Try the canonical RPC first (soft_delete_saved_chemicals(p_id)). If it
  // isn't present in this Supabase project (PGRST202 = function not found in
  // schema cache), fall back to a direct soft-delete UPDATE so archiving
  // still works. RLS on saved_chemicals already restricts writes to
  // owner/manager vineyard members.
  const rpc = await supabase.rpc("soft_delete_saved_chemicals", { p_id: id } as any);
  if (!rpc.error) return;

  const code = (rpc.error as any)?.code;
  const msg = String((rpc.error as any)?.message ?? "");
  const missing = code === "PGRST202" || /Could not find the function/i.test(msg);
  if (!missing) throw rpc.error;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("saved_chemicals")
    .update({ deleted_at: now, client_updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

export async function restoreSavedChemical(id: string) {
  const { error } = await supabase.rpc("restore_saved_chemicals", { p_id: id } as any);
  if (error) throw error;
}
