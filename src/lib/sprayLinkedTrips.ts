// Which trips have a linked, non-template, non-deleted spray record.
// Used only for classification: such trips are spraying trips and must be
// exported as a Spray Report, never through the generic Trip Report.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

export async function fetchSprayLinkedTripIds(vineyardId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("spray_records")
    .select("trip_id,is_template,deleted_at")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (error) throw error;
  const ids = new Set<string>();
  for (const r of (data ?? []) as any[]) {
    if (!r?.trip_id || r.is_template) continue;
    ids.add(String(r.trip_id));
  }
  return ids;
}

export function useSprayLinkedTripIds(vineyardId?: string | null) {
  return useQuery({
    queryKey: ["spray_linked_trip_ids", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchSprayLinkedTripIds(vineyardId as string),
    staleTime: 60_000,
  });
}
