// READ-ONLY placement queries against the SQL 171 contract.
//   display/table  → public.pin_placements
//   exports        → public.pins_export
//   single pin     → public.resolve_pin_placement(pin_id)
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import type { PinPlacementRow } from "@/lib/pinPlacement";

const CHUNK = 300;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Fetch canonical placements for the given pin ids. */
export async function fetchPinPlacements(pinIds: string[]): Promise<PinPlacementRow[]> {
  if (!pinIds.length) return [];
  const out: PinPlacementRow[] = [];
  for (const ids of chunk(pinIds, CHUNK)) {
    const { data, error } = await (supabase as any)
      .from("pin_placements")
      .select("*")
      .in("pin_id", ids);
    if (error) throw error;
    out.push(...((data ?? []) as PinPlacementRow[]));
  }
  return out;
}

export function placementMap(rows: PinPlacementRow[]): Map<string, PinPlacementRow> {
  const m = new Map<string, PinPlacementRow>();
  rows.forEach((r) => {
    const id = (r as any).pin_id ?? (r as any).id;
    if (id) m.set(String(id), r);
  });
  return m;
}

/** Placements keyed by pin id for a set of pins. */
export function usePinPlacements(pinIds: string[]) {
  const ids = [...pinIds].sort();
  const key = ids.join(",");
  const q = useQuery({
    queryKey: ["pin_placements", key],
    enabled: ids.length > 0,
    queryFn: () => fetchPinPlacements(ids),
    staleTime: 60_000,
  });
  const map = placementMap(q.data ?? []);
  return { ...q, placements: map };
}

/** Single-pin RPC — only where one pin is resolved in isolation. */
export async function resolvePinPlacement(pinId: string): Promise<PinPlacementRow | null> {
  const { data, error } = await (supabase as any).rpc("resolve_pin_placement", { pin_id: pinId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as PinPlacementRow) ?? null;
}

/** Single-pin placement hook — used by surfaces that show one pin at a time. */
export function useResolvedPinPlacement(pinId: string | null | undefined) {
  const q = useQuery({
    queryKey: ["pin_placement", pinId],
    enabled: !!pinId,
    queryFn: () => resolvePinPlacement(pinId!),
    staleTime: 60_000,
  });
  return q.data ?? null;
}

/** Export rows — canonical export surface. */
export async function fetchPinsExport(vineyardId: string): Promise<Record<string, any>[]> {
  const { data, error } = await (supabase as any)
    .from("pins_export")
    .select("*")
    .eq("vineyard_id", vineyardId);
  if (error) throw error;
  return (data ?? []) as Record<string, any>[];
}
