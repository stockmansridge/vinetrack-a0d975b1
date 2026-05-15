// READ-ONLY diagnostics: raw counts for the pins table for a vineyard.
// Used to diagnose discrepancies between Supabase and the portal.
import { supabase } from "@/integrations/ios-supabase/client";

export interface PinsRawCounts {
  totalRows: number;          // every row for this vineyard, including deleted
  notDeleted: number;         // deleted_at IS NULL
  deleted: number;            // deleted_at IS NOT NULL
  completed: number;          // is_completed = true (and not deleted)
  active: number;             // is_completed != true (and not deleted)
  missingPaddock: number;     // paddock_id IS NULL (and not deleted)
  missingRow: number;         // pin_row_number IS NULL AND driving_row_number IS NULL AND row_number IS NULL (not deleted)
  byVineyardIdNull: number;   // legacy: rows where vineyard_id IS NULL but paddock_id matches one of paddockIds
}

export async function fetchPinsRawCounts(
  vineyardId: string,
  paddockIds: string[],
): Promise<PinsRawCounts> {
  const head = (q: any) => q.select("id", { count: "exact", head: true });

  const total = await head(supabase.from("pins").eq("vineyard_id", vineyardId));
  const deleted = await head(
    supabase.from("pins").eq("vineyard_id", vineyardId).not("deleted_at", "is", null),
  );
  const notDeleted = await head(
    supabase.from("pins").eq("vineyard_id", vineyardId).is("deleted_at", null),
  );
  const completed = await head(
    supabase
      .from("pins")
      .eq("vineyard_id", vineyardId)
      .is("deleted_at", null)
      .eq("is_completed", true),
  );
  const missingPaddock = await head(
    supabase
      .from("pins")
      .eq("vineyard_id", vineyardId)
      .is("deleted_at", null)
      .is("paddock_id", null),
  );
  const missingRow = await head(
    supabase
      .from("pins")
      .eq("vineyard_id", vineyardId)
      .is("deleted_at", null)
      .is("pin_row_number", null)
      .is("driving_row_number", null)
      .is("row_number", null),
  );

  let legacy = 0;
  if (paddockIds.length) {
    const r = await head(
      supabase
        .from("pins")
        .is("vineyard_id", null)
        .is("deleted_at", null)
        .in("paddock_id", paddockIds),
    );
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
