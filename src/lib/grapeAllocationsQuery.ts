// Grape Allocation Tracker — Portal data access (SQL 217 / 218 contract).
//
// Contract notes (authoritative, do not change without a backend change):
//   * `grape_allocations.allocation_type` stores exactly "own_use" or
//     "external". UI labels may read "Own Use" / "Sale / Commitment".
//   * Price per tonne is NEVER written to `grape_allocation_financials`
//     directly — that table has no client write policy. The Portal includes
//     `price_per_tonne` on the `grape_allocations` insert/update and the
//     existing `grape_allocations_route_financials` BEFORE trigger routes it
//     into the financial table and nulls it on the base row.
//   * Financial reads for Owner / Manager use
//     `get_grape_allocation_financials(p_vineyard_id)` which returns
//     allocation_id, price_per_tonne and a derived contract_value.
//   * `integration_api_*` RPCs and the `costs:write` scope belong to the
//     external API integration path, not to the logged-in Portal UI.
import { supabase } from "@/integrations/ios-supabase/client";

export type AllocationType = "own_use" | "external";

export const ALLOCATION_TYPE_LABEL: Record<AllocationType, string> = {
  own_use: "Own Use",
  external: "Sale / Commitment",
};

export interface GrapeAllocationBlock {
  id?: string;
  allocation_id?: string;
  paddock_id: string;
  quantity_tonnes: number | null;
}

export interface GrapeAllocation {
  id: string;
  vineyard_id: string;
  vintage: number;
  variety_id: string | null;
  variety_key: string | null;
  variety_name: string | null;
  allocation_type: AllocationType;
  /** SQL 219 — optional link to the reusable purchaser record. */
  purchaser_id: string | null;
  purchaser_name: string | null;
  destination_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_address: string | null;
  quantity_tonnes: number | null;
  notes: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  blocks: GrapeAllocationBlock[];
}

export interface AllocationFinancial {
  allocationId: string;
  pricePerTonne: number | null;
  contractValue: number | null;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function fetchGrapeAllocations(
  vineyardId: string,
  vintage?: number | null,
): Promise<GrapeAllocation[]> {
  let q = (supabase as any)
    .from("grape_allocations")
    .select("*, grape_allocation_blocks(id, allocation_id, paddock_id, quantity_tonnes)")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (vintage != null) q = q.eq("vintage", vintage);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    vineyard_id: r.vineyard_id,
    vintage: Number(r.vintage),
    variety_id: r.variety_id ?? null,
    variety_key: r.variety_key ?? null,
    variety_name: r.variety_name ?? null,
    allocation_type: (r.allocation_type === "own_use" ? "own_use" : "external") as AllocationType,
    purchaser_id: r.purchaser_id ?? null,
    purchaser_name: r.purchaser_name ?? null,
    destination_name: r.destination_name ?? null,
    contact_name: r.contact_name ?? null,
    contact_email: r.contact_email ?? null,
    contact_phone: r.contact_phone ?? null,
    contact_address: r.contact_address ?? null,
    quantity_tonnes: num(r.quantity_tonnes),
    notes: r.notes ?? null,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
    blocks: (r.grape_allocation_blocks ?? []).map((b: any) => ({
      id: b.id,
      allocation_id: b.allocation_id,
      paddock_id: b.paddock_id,
      quantity_tonnes: num(b.quantity_tonnes),
    })),
  }));
}

/**
 * Owner / Manager only. Never called for other roles — the RPC is the single
 * source of price and contract value.
 */
export async function fetchAllocationFinancials(
  vineyardId: string,
): Promise<Map<string, AllocationFinancial>> {
  const { data, error } = await (supabase as any).rpc("get_grape_allocation_financials", {
    p_vineyard_id: vineyardId,
  });
  if (error) throw error;
  const map = new Map<string, AllocationFinancial>();
  for (const r of (data ?? []) as any[]) {
    const id = String(r.allocation_id);
    map.set(id, {
      allocationId: id,
      pricePerTonne: num(r.price_per_tonne),
      contractValue: num(r.contract_value),
    });
  }
  return map;
}

export interface SaveAllocationInput {
  id?: string | null;
  vineyardId: string;
  vintage: number;
  allocationType: AllocationType;
  varietyId?: string | null;
  varietyKey?: string | null;
  varietyName?: string | null;
  quantityTonnes: number;
  /** Own Use only — the internal destination (e.g. "Estate wine"). */
  destinationName?: string | null;
  /** External only — reusable purchaser link (SQL 219). */
  purchaserId?: string | null;
  /** External only — historical snapshot of the purchaser name. */
  purchaserName?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactAddress?: string | null;
  /** External only, Owner / Manager only. Routed by the backend trigger. */
  pricePerTonne?: number | null;
  notes?: string | null;
  blocks?: { paddockId: string; tonnes: number | null }[];
}

const clean = (v?: string | null) => {
  const s = (v ?? "").trim();
  return s.length ? s : null;
};

/**
 * Build the exact `grape_allocations` row body for the contract. Exported for
 * tests: own_use must never carry purchaser / contact / price fields.
 */
export function buildAllocationRow(input: SaveAllocationInput, userId: string | null) {
  const own = input.allocationType === "own_use";
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    vineyard_id: input.vineyardId,
    vintage: input.vintage,
    allocation_type: input.allocationType,
    variety_id: input.varietyId ?? null,
    variety_key: clean(input.varietyKey),
    variety_name: clean(input.varietyName),
    quantity_tonnes: input.quantityTonnes,
    notes: clean(input.notes),
    destination_name: own ? clean(input.destinationName) : null,
    updated_by: userId,
    client_updated_at: now,
  };
  if (!own) {
    row.purchaser_id = input.purchaserId ?? null;
    row.purchaser_name = clean(input.purchaserName);
    row.contact_name = clean(input.contactName);
    row.contact_email = clean(input.contactEmail);
    row.contact_phone = clean(input.contactPhone);
    row.contact_address = clean(input.contactAddress);
    // Only sent when the caller may set pricing; the BEFORE trigger moves it
    // into grape_allocation_financials and nulls it on this row.
    if (input.pricePerTonne != null) row.price_per_tonne = input.pricePerTonne;
  } else {
    row.purchaser_id = null;
    row.purchaser_name = null;
    row.contact_name = null;
    row.contact_email = null;
    row.contact_phone = null;
    row.contact_address = null;
  }
  return row;
}

export async function saveGrapeAllocation(input: SaveAllocationInput): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? null;
  const row = buildAllocationRow(input, userId);

  let allocationId = input.id ?? null;
  if (allocationId) {
    const { error } = await (supabase as any)
      .from("grape_allocations")
      .update(row)
      .eq("id", allocationId);
    if (error) throw error;
  } else {
    const { data, error } = await (supabase as any)
      .from("grape_allocations")
      .insert({ ...row, created_by: userId })
      .select("id")
      .single();
    if (error) throw error;
    allocationId = data.id as string;
  }

  const blocks = (input.blocks ?? []).filter((b) => b.paddockId);
  if (input.id) {
    const { error } = await (supabase as any)
      .from("grape_allocation_blocks")
      .delete()
      .eq("allocation_id", allocationId);
    if (error) throw error;
  }
  if (blocks.length) {
    const { error } = await (supabase as any).from("grape_allocation_blocks").insert(
      blocks.map((b) => ({
        allocation_id: allocationId,
        paddock_id: b.paddockId,
        quantity_tonnes: b.tonnes,
      })),
    );
    if (error) throw error;
  }
  return allocationId!;
}

export async function softDeleteGrapeAllocation(id: string): Promise<void> {
  const { error } = await (supabase as any).rpc("soft_delete_grape_allocation", { p_id: id });
  if (error) throw error;
}
