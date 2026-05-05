// READ-ONLY pin queries. No writes.
import { supabase } from "@/integrations/ios-supabase/client";
import type { PinRecord } from "@/components/PinDetailPanel";

export interface PinsQueryResult {
  pins: PinRecord[];
  source: "vineyard_id" | "paddock_id" | "merged" | "empty";
  vineyardCount: number;
  paddockFallbackCount: number;
}

/**
 * Fetch active pins for a vineyard.
 * Primary: pins.vineyard_id = vineyardId AND deleted_at IS NULL.
 * Fallback: also fetch pins where paddock_id IN (paddockIds) and merge in
 * any IDs missing from the primary set (handles legacy rows lacking vineyard_id).
 */
export async function fetchPinsForVineyard(
  vineyardId: string,
  paddockIds: string[],
): Promise<PinsQueryResult> {
  const byVineyard = await supabase
    .from("pins")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (byVineyard.error) throw byVineyard.error;

  const primary = (byVineyard.data ?? []) as PinRecord[];
  const ids = new Set(primary.map((p) => p.id));

  let merged: PinRecord[] = primary;
  let paddockFallbackCount = 0;
  let source: PinsQueryResult["source"] = primary.length ? "vineyard_id" : "empty";

  if (paddockIds.length) {
    const byPaddock = await supabase
      .from("pins")
      .select("*")
      .in("paddock_id", paddockIds)
      .is("deleted_at", null);
    if (!byPaddock.error) {
      const extras = ((byPaddock.data ?? []) as PinRecord[]).filter((p) => !ids.has(p.id));
      paddockFallbackCount = extras.length;
      if (extras.length) {
        merged = primary.concat(extras);
        source = primary.length ? "merged" : "paddock_id";
      }
    } else if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[pins] paddock_id fallback query failed:", byPaddock.error.message);
    }
  }

  return {
    pins: merged,
    source,
    vineyardCount: primary.length,
    paddockFallbackCount,
  };
}
