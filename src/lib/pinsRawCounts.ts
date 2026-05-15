// READ-ONLY diagnostics: raw counts for the pins table for a vineyard.
import { supabase } from "@/integrations/ios-supabase/client";

export interface PinsRawCounts {
  totalRows: number;
  notDeleted: number;
  deleted: number;
  completed: number;
  active: number;
  missingPaddock: number;
  missingRow: number;
  byVineyardIdNull: number;
}

const base = () => supabase.from("pins").select("id", { count: "exact", head: true });

export async function fetchPinsRawCounts(
  vineyardId: string,
  paddockIds: string[],
): Promise<PinsRawCounts> {
  const total = await base().eq("vineyard_id", vineyardId);
  const deleted = await base().eq("vineyard_id", vineyardId).not("deleted_at", "is", null);
  const notDeleted = await base().eq("vineyard_id", vineyardId).is("deleted_at", null);
  const completed = await base()
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .eq("is_completed", true);
  const missingPaddock = await base()
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .is("paddock_id", null);
  const missingRow = await base()
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .is("pin_row_number", null)
    .is("driving_row_number", null)
    .is("row_number", null);

  let legacy = 0;
  if (paddockIds.length) {
    const r = await base()
      .is("vineyard_id", null)
      .is("deleted_at", null)
      .in("paddock_id", paddockIds);
    legacy = r.count ?? 0;
  }

  const totalCount = total.count ?? 0;
  const notDeletedCount = notDeleted.count ?? 0;
  const completedCount = completed.count ?? 0;

  return {
    totalRows: totalCount,
    notDeleted: notDeletedCount,
    deleted: deleted.count ?? 0,
    completed: completedCount,
    active: Math.max(0, notDeletedCount - completedCount),
    missingPaddock: missingPaddock.count ?? 0,
    missingRow: missingRow.count ?? 0,
    byVineyardIdNull: legacy,
  };
}
