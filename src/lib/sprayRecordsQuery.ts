// READ-ONLY query helper for spray_records. No writes.
//
// Schema (docs/supabase-schema.md §3.10):
//   spray_records has direct `vineyard_id` (standard sync column) + soft delete
//   via `deleted_at`. No `paddock_id`, no `operator`, no explicit `status`.
//   `trip_id` is the only indirect link (to `trips`, which carries paddock_ids).
//   We do NOT fall back through trips — that would require a join the client
//   can't perform safely, and the canonical link is vineyard_id.
import { supabase } from "@/integrations/ios-supabase/client";

export interface SprayRecord {
  id: string;
  vineyard_id: string;
  trip_id?: string | null;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  temperature?: number | null;
  wind_speed?: number | null;
  wind_direction?: string | null;
  humidity?: number | null;
  spray_reference?: string | null;
  notes?: string | null;
  number_of_fans_jets?: number | null;
  average_speed?: number | null;
  equipment_type?: string | null;
  tractor?: string | null;
  tractor_gear?: string | null;
  is_template?: boolean | null;
  operation_type?: string | null;
  tanks?: any;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
}

export interface SprayRecordsQueryResult {
  records: SprayRecord[];
  source: "vineyard_id" | "empty";
  rawCount: number;
  templatesExcluded: number;
  missingDate: number;
  missingTractor: number;
}

export async function fetchSprayRecordsForVineyard(
  vineyardId: string,
): Promise<SprayRecordsQueryResult> {
  const { data, error } = await supabase
    .from("spray_records")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (error) throw error;

  const all = (data ?? []) as SprayRecord[];
  const records = all.filter((r) => !r.is_template);
  return {
    records,
    source: records.length ? "vineyard_id" : "empty",
    rawCount: all.length,
    templatesExcluded: all.length - records.length,
    missingDate: records.filter((r) => !r.date).length,
    missingTractor: records.filter((r) => !r.tractor).length,
  };
}
