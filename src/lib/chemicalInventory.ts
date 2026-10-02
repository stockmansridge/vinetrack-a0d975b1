// Chemical V3 vineyard add + inventory pilot (System Admin only for now).
//
// All writes go through the live database RPCs below — the Portal never
// writes the inventory tables directly, never derives unit cost, never
// deducts spray use and never invents stock from pack size. Remove the
// pilot gate later by changing `canUseInventoryPilot` only.
import { supabase } from "@/integrations/ios-supabase/client";
import { productCategoryLabel } from "@/lib/chemicalProductCategory";

type Row = Record<string, any>;
const sb = supabase as any;

export const PILOT_RPC = {
  setCategory: "chemical_v3_set_product_category",
  addToVineyard: "chemical_v3_add_to_vineyard",
  purchase: "chemical_inventory_record_purchase",
  stocktake: "chemical_inventory_record_stocktake",
  finished: "chemical_inventory_mark_finished",
  settings: "chemical_inventory_set_settings",
  summary: "chemical_inventory_summary",
  history: "chemical_inventory_purchase_history",
} as const;
export const CATEGORY_TABLE = "chemical_product_categories";

/** Single switch for the pilot gate — today: System Admin only. */
export function canUseInventoryPilot(isSystemAdmin: boolean): boolean {
  return isSystemAdmin;
}

export const STOCK_UNITS = ["L", "mL", "kg", "g"] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];
export const STOCK_REASONS = ["opening_stock", "stocktake", "correction"] as const;
export type StockReason = (typeof STOCK_REASONS)[number];
export const DEFAULT_LOW_STOCK_PERCENT = 20;

export const MARK_FINISHED_CONFIRM =
  "Mark this chemical stock as finished?\n\nThe inventory balance will be reset to zero from now. Purchase and usage history will be retained.";
export const ALREADY_IN_VINEYARD = "Already in this vineyard chemical list";
export const OPENING_STOCK_NOT_SET = "Opening stock not set";
export const PENDING_CATALOGUE_REVIEW = "Pending VineTrack catalogue review";

function first(row: Row | null | undefined, ...keys: string[]): any {
  if (!row) return undefined;
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

async function rpc(name: string, args: Row): Promise<any> {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message || `${name} failed`);
  return data;
}
const one = (d: any) => (Array.isArray(d) ? d[0] ?? null : d ?? null);
const num = (s: string) => (s.trim() === "" ? null : Number(s));
const txt = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

// ---------- Category (authority = product_category_key) ----------
export interface CategoryOption { key: string; label: string }

export function parseCategoryRows(rows: Row[] | null | undefined): CategoryOption[] {
  return (rows ?? [])
    .filter((r) => r && r.is_active !== false)
    .map((r) => {
      const key = String(first(r, "category_key", "key", "code", "id") ?? "");
      return { key, label: String(first(r, "display_name", "label", "name") ?? productCategoryLabel(key) ?? key), sort: Number(first(r, "sort_order", "display_order") ?? 0) };
    })
    .filter((c) => c.key)
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map(({ key, label }) => ({ key, label }));
}

export async function fetchProductCategories(): Promise<CategoryOption[]> {
  const { data, error } = await sb.from(CATEGORY_TABLE).select("*");
  if (error) throw new Error(error.message);
  return parseCategoryRows(data);
}

/** Display label from product_category_key only — never the free-text category. */
export function v3CategoryLabel(row: Row | null | undefined, options: CategoryOption[] = []): string | null {
  const key = first(row, "product_category_key");
  if (!key) return null;
  return options.find((o) => o.key === key)?.label ?? productCategoryLabel(String(key)) ?? String(key);
}

export const setV3ProductCategory = (revisionId: string, categoryKey: string) =>
  rpc(PILOT_RPC.setCategory, { p_revision_id: revisionId, p_category_key: categoryKey });

// ---------- Add to vineyard ----------
export const V3_ADDABLE_STATUSES = ["pending_review", "needs_attention", "approved"];
export function isV3Addable(status: string | null | undefined): boolean {
  return V3_ADDABLE_STATUSES.includes(String(status ?? "").toLowerCase());
}
export function isPendingCatalogueReview(status: string | null | undefined): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "pending_review" || s === "needs_attention";
}

export interface AddToVineyardArgs { revisionId: string; vineyardId: string; quantity: string; unit: StockUnit }
export function buildAddToVineyardArgs(a: AddToVineyardArgs): { args: Row } | { error: string } {
  const q = num(a.quantity);
  if (q !== null && (!Number.isFinite(q) || q < 0)) return { error: "Opening stock must be a number of 0 or more." };
  return { args: { p_revision_id: a.revisionId, p_vineyard_id: a.vineyardId, p_opening_quantity: q, p_opening_unit: q === null ? null : a.unit } };
}
export async function addV3ToVineyard(a: AddToVineyardArgs): Promise<{ reused: boolean; savedChemicalId: string | null }> {
  const b = buildAddToVineyardArgs(a);
  if ("error" in b) throw new Error(b.error);
  const r = one(await rpc(PILOT_RPC.addToVineyard, b.args));
  return { reused: r?.reused === true, savedChemicalId: first(r, "saved_chemical_id", "id") ?? null };
}

/** Badge for a vineyard chemical that came from V3. */
export function v3EntryBadge(row: Row | null | undefined): { label: string; tone: "pending" | "approved" } | null {
  const src = first(row, "entry_source");
  if (src === "chemical_v3_candidate") return { label: "Pending review", tone: "pending" };
  if (src === "chemical_v3_catalogue") return { label: "VineTrack catalogue", tone: "approved" };
  return null;
}

// ---------- Inventory ----------
export type StockState = "ok" | "low_stock" | "out_of_stock" | "finished" | "needs_opening_stock";
export const STOCK_STATE_LABEL: Record<StockState, string> = {
  ok: "In stock", low_stock: "Low stock", out_of_stock: "Out of stock", finished: "Finished", needs_opening_stock: OPENING_STOCK_NOT_SET,
};
export const STOCK_STATE_TONE: Record<StockState, "green" | "amber" | "red" | "grey"> = {
  ok: "green", low_stock: "amber", out_of_stock: "red", finished: "grey", needs_opening_stock: "grey",
};

export interface InventorySummary {
  state: StockState | null;
  quantity: number | null;
  unit: string | null;
  percent: number | null;
  latestUnitCost: number | null;
  latestCostUnit: string | null;
  currency: string | null;
  latestPurchaseDate: string | null;
  latestBatch: string | null;
  warningsEnabled: boolean | null;
  lowStockPercent: number | null;
  lowStockQuantity: number | null;
  raw: Row | null;
}

const n = (v: any) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function parseInventorySummary(data: any): InventorySummary {
  const r = one(data);
  const s = String(first(r, "stock_status", "status", "state") ?? "").toLowerCase();
  const state = (Object.keys(STOCK_STATE_LABEL) as StockState[]).includes(s as StockState) ? (s as StockState) : null;
  const unknown = state === "needs_opening_stock";
  return {
    state,
    // Unknown stock is never shown as zero.
    quantity: unknown ? null : n(first(r, "current_quantity")),
    unit: first(r, "display_unit") ?? null,
    percent: unknown ? null : n(first(r, "percent_remaining")),
    latestUnitCost: n(first(r, "latest_unit_cost", "latest_cost_per_unit", "latest_cost_per_base_unit")),
    latestCostUnit: first(r, "latest_cost_unit", "latest_unit", "display_unit") ?? null,
    currency: first(r, "latest_currency", "currency") ?? null,
    latestPurchaseDate: first(r, "latest_purchase_date") ?? null,
    latestBatch: first(r, "latest_batch_number", "batch_number") ?? null,
    warningsEnabled: r && typeof r.warnings_enabled === "boolean" ? r.warnings_enabled : null,
    lowStockPercent: n(first(r, "low_stock_percent")),
    lowStockQuantity: n(first(r, "low_stock_threshold_quantity", "low_stock_quantity")),
    raw: r,
  };
}

export const fetchInventorySummary = async (savedChemicalId: string) =>
  parseInventorySummary(await rpc(PILOT_RPC.summary, { p_saved_chemical_id: savedChemicalId }));

export interface PurchaseRow {
  id: string; date: string | null; quantity: number | null; unit: string | null; total: number | null;
  unitCost: number | null; currency: string | null; batch: string | null; supplier: string | null;
  expiry: string | null; reference: string | null;
}
export function parsePurchaseHistory(data: any): PurchaseRow[] {
  const rows: Row[] = Array.isArray(data) ? data : data ? [data] : [];
  return rows.map((r, i) => ({
    id: String(first(r, "id", "purchase_id") ?? i),
    date: first(r, "purchase_date") ?? null,
    quantity: n(first(r, "quantity")),
    unit: first(r, "unit") ?? null,
    total: n(first(r, "total_cost", "total_amount")),
    unitCost: n(first(r, "unit_cost", "cost_per_unit", "cost_per_base_unit")),
    currency: first(r, "currency") ?? null,
    batch: first(r, "batch_number") ?? null,
    supplier: first(r, "supplier") ?? null,
    expiry: first(r, "expiry_date") ?? null,
    reference: first(r, "invoice_reference") ?? null,
  })).sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))); // newest first, never merged
}
export const fetchPurchaseHistory = async (savedChemicalId: string) =>
  parsePurchaseHistory(await rpc(PILOT_RPC.history, { p_saved_chemical_id: savedChemicalId }));

export interface PurchaseDraft {
  date: string; quantity: string; unit: StockUnit; total: string; currency: string;
  batch: string; supplier: string; reference: string; expiry: string; notes: string;
}
/** Quantity + total amount only — the database derives unit cost. */
export function buildPurchaseArgs(savedChemicalId: string, d: PurchaseDraft): { args: Row } | { error: string } {
  const q = num(d.quantity), t = num(d.total);
  if (!d.date) return { error: "Purchase date is required." };
  if (q === null || !Number.isFinite(q) || q <= 0) return { error: "Quantity must be more than 0." };
  if (t === null || !Number.isFinite(t) || t < 0) return { error: "Total purchase amount is required." };
  return { args: {
    p_saved_chemical_id: savedChemicalId, p_purchase_date: d.date, p_quantity: q, p_unit: d.unit,
    p_total_cost: t, p_currency: txt(d.currency), p_batch_number: txt(d.batch), p_supplier: txt(d.supplier),
    p_invoice_reference: txt(d.reference), p_expiry_date: txt(d.expiry), p_notes: txt(d.notes),
  } };
}
export async function recordPurchase(savedChemicalId: string, d: PurchaseDraft) {
  const b = buildPurchaseArgs(savedChemicalId, d);
  if ("error" in b) throw new Error(b.error);
  return rpc(PILOT_RPC.purchase, b.args);
}

export interface StocktakeDraft { quantity: string; unit: StockUnit; reason: StockReason; notes: string }
export function buildStocktakeArgs(savedChemicalId: string, d: StocktakeDraft): { args: Row } | { error: string } {
  const q = num(d.quantity);
  if (q === null || !Number.isFinite(q) || q < 0) return { error: "Current physical quantity must be 0 or more." };
  return { args: { p_saved_chemical_id: savedChemicalId, p_quantity: q, p_unit: d.unit, p_reason: d.reason, p_notes: txt(d.notes), p_effective_at: new Date().toISOString() } };
}
export async function recordStocktake(savedChemicalId: string, d: StocktakeDraft) {
  const b = buildStocktakeArgs(savedChemicalId, d);
  if ("error" in b) throw new Error(b.error);
  return rpc(PILOT_RPC.stocktake, b.args);
}

export const markFinished = (savedChemicalId: string, notes: string | null) =>
  rpc(PILOT_RPC.finished, { p_saved_chemical_id: savedChemicalId, p_notes: txt(notes) });

export interface SettingsDraft { warningsEnabled: boolean; lowQuantity: string; lowUnit: StockUnit; lowPercent: string }
export function buildSettingsArgs(savedChemicalId: string, d: SettingsDraft): { args: Row } | { error: string } {
  const q = num(d.lowQuantity), p = num(d.lowPercent);
  if (q !== null && (!Number.isFinite(q) || q < 0)) return { error: "Low stock quantity must be 0 or more." };
  if (p !== null && (!Number.isFinite(p) || p < 0 || p > 100)) return { error: "Low stock percentage must be between 0 and 100." };
  return { args: {
    p_saved_chemical_id: savedChemicalId, p_warnings_enabled: d.warningsEnabled,
    p_low_stock_threshold_quantity: q, p_low_stock_threshold_unit: q === null ? null : d.lowUnit,
    p_low_stock_percent: p ?? DEFAULT_LOW_STOCK_PERCENT,
  } };
}
export async function saveInventorySettings(savedChemicalId: string, d: SettingsDraft) {
  const b = buildSettingsArgs(savedChemicalId, d);
  if ("error" in b) throw new Error(b.error);
  return rpc(PILOT_RPC.settings, b.args);
}

export function formatMoney(v: number | null, currency: string | null): string {
  if (v === null) return "—";
  const c = currency || "AUD";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(v); }
  catch { return `${v.toFixed(2)} ${c}`; }
}
