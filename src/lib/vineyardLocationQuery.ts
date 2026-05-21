// Shared vineyard location fields (SQL 80). Backed by RPCs on the iOS
// Supabase project so iOS and Lovable read/write the same data.
import { supabase } from "@/integrations/ios-supabase/client";

export interface VineyardLocation {
  latitude: number | null;
  longitude: number | null;
  elevation_metres: number | null;
  timezone: string | null;
}

const EMPTY: VineyardLocation = {
  latitude: null,
  longitude: null,
  elevation_metres: null,
  timezone: null,
};

function normalise(row: any): VineyardLocation {
  if (!row) return { ...EMPTY };
  return {
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    elevation_metres: row.elevation_metres ?? null,
    timezone: row.timezone ?? null,
  };
}

export async function fetchVineyardLocation(
  vineyardId: string,
): Promise<VineyardLocation> {
  const { data, error } = await supabase.rpc("get_vineyard_location", {
    p_vineyard_id: vineyardId,
  });
  if (error) {
    if ((error as { code?: string }).code === "42501") return { ...EMPTY };
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return normalise(row);
}

export interface SetVineyardLocationInput {
  vineyard_id: string;
  // Pass `undefined` to leave a field unchanged. Pass `null` only if you
  // explicitly want to clear it on the server.
  latitude?: number | null;
  longitude?: number | null;
  elevation_metres?: number | null;
  timezone?: string | null;
}

export async function setVineyardLocation(
  input: SetVineyardLocationInput,
): Promise<VineyardLocation> {
  // Fetch current values first so we never blank out a populated field by
  // accident — the spec is explicit that null/blank must not overwrite
  // valid values unintentionally.
  const current = await fetchVineyardLocation(input.vineyard_id);

  const resolve = <T,>(next: T | null | undefined, prev: T | null): T | null => {
    if (next === undefined) return prev;
    return next;
  };

  const payload = {
    p_vineyard_id: input.vineyard_id,
    p_latitude: resolve(input.latitude, current.latitude),
    p_longitude: resolve(input.longitude, current.longitude),
    p_elevation_metres: resolve(input.elevation_metres, current.elevation_metres),
    p_timezone: resolve(input.timezone, current.timezone),
  };

  const { data, error } = await supabase.rpc("set_vineyard_location", payload);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return normalise(row ?? payload);
}

export function describeLocationError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? String(err ?? "");
  if (/42501|permission|RLS/i.test(msg))
    return "You don't have permission to edit vineyard location. Only owners and managers can save changes.";
  return msg || "Something went wrong. Please try again.";
}
