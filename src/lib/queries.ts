// READ-ONLY query helpers. NO writes anywhere in this iteration.
import { supabase } from "@/integrations/ios-supabase/client";

// Tables with a soft-delete column (deleted_at) — filter them out.
const SOFT_DELETE_TABLES = new Set([
  "paddocks",
  "tractors",
  "spray_equipment",
  "vineyards",
  "pins",
]);

const applySoftDelete = (q: any, table: string) =>
  SOFT_DELETE_TABLES.has(table) ? q.is("deleted_at", null) : q;

export const fetchCount = async (table: string, vineyardId: string) => {
  let q = supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("vineyard_id", vineyardId);
  q = applySoftDelete(q, table);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
};

export const fetchList = async <T = any>(table: string, vineyardId: string): Promise<T[]> => {
  let q = supabase.from(table).select("*").eq("vineyard_id", vineyardId);
  q = applySoftDelete(q, table);
  const { data, error } = await q.order("name", { ascending: true, nullsFirst: false });
  if (error) {
    // table has no `name` column — retry without ordering
    let q2 = supabase.from(table).select("*").eq("vineyard_id", vineyardId);
    q2 = applySoftDelete(q2, table);
    const { data: d2, error: e2 } = await q2.order("created_at", { ascending: false });
    if (e2) throw e2;
    return (d2 ?? []) as T[];
  }
  return (data ?? []) as T[];
};

export const fetchOne = async <T = any>(table: string, id: string): Promise<T | null> => {
  const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as T | null;
};
