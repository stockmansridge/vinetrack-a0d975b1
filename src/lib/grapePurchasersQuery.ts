// Reusable grape purchasers (SQL 219 — public.grape_purchasers).
//
// Deliberately small: a per-vineyard address book used by Grape Allocation.
// The allocation keeps a historical snapshot of the purchaser details at the
// time it was recorded, so editing a purchaser NEVER rewrites past allocations.
import { supabase } from "@/integrations/ios-supabase/client";

export interface GrapePurchaser {
  id: string;
  vineyard_id: string;
  winery_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_address: string | null;
}

export interface SavePurchaserInput {
  id?: string | null;
  vineyardId: string;
  wineryName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactAddress?: string | null;
}

const clean = (v?: string | null) => {
  const s = (v ?? "").trim();
  return s.length ? s : null;
};

export async function fetchGrapePurchasers(vineyardId: string): Promise<GrapePurchaser[]> {
  const { data, error } = await (supabase as any)
    .from("grape_purchasers")
    .select("id, vineyard_id, winery_name, contact_name, contact_email, contact_phone, contact_address")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .order("winery_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    vineyard_id: r.vineyard_id,
    winery_name: r.winery_name ?? "",
    contact_name: r.contact_name ?? null,
    contact_email: r.contact_email ?? null,
    contact_phone: r.contact_phone ?? null,
    contact_address: r.contact_address ?? null,
  }));
}

/** Row body for grape_purchasers. Exported for tests. */
export function buildPurchaserRow(input: SavePurchaserInput, userId: string | null) {
  return {
    vineyard_id: input.vineyardId,
    winery_name: input.wineryName.trim(),
    contact_name: clean(input.contactName),
    contact_email: clean(input.contactEmail),
    contact_phone: clean(input.contactPhone),
    contact_address: clean(input.contactAddress),
    updated_by: userId,
    client_updated_at: new Date().toISOString(),
  } as Record<string, unknown>;
}

export async function saveGrapePurchaser(input: SavePurchaserInput): Promise<GrapePurchaser> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? null;
  const row = buildPurchaserRow(input, userId);
  const cols = "id, vineyard_id, winery_name, contact_name, contact_email, contact_phone, contact_address";

  if (input.id) {
    const { data, error } = await (supabase as any)
      .from("grape_purchasers")
      .update(row)
      .eq("id", input.id)
      .select(cols)
      .single();
    if (error) throw error;
    return data as GrapePurchaser;
  }
  const { data, error } = await (supabase as any)
    .from("grape_purchasers")
    .insert({ ...row, created_by: userId })
    .select(cols)
    .single();
  if (error) throw error;
  return data as GrapePurchaser;
}
