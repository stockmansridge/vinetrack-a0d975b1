// Read-only query helpers. NO writes anywhere in this iteration.
import { supabase } from "@/integrations/supabase/client";

export const fetchCount = async (table: string, vineyardId: string) => {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("vineyard_id", vineyardId);
  if (error) throw error;
  return count ?? 0;
};

export const fetchList = async <T = any>(table: string, vineyardId: string): Promise<T[]> => {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("vineyard_id", vineyardId)
    .order("name", { ascending: true, nullsFirst: false });
  if (error) {
    // fallback if no name column
    const { data: d2, error: e2 } = await supabase.from(table).select("*").eq("vineyard_id", vineyardId);
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
