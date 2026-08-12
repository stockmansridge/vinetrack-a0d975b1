// Shared Bunch Count sampling density (sql/187).
//
// `vineyards.yield_samples_per_hectare` (int, default 20, range 1–100) is a
// VINEYARD setting shared by iOS, Android and the portal. There is deliberately
// no portal-only preference: both directions go through the shared RPCs.
//
//   get_vineyard_yield_sampling_settings(p_vineyard_id)   — any member
//   set_vineyard_yield_sampling_settings(p_vineyard_id,
//                                        p_samples_per_hectare)
//                                        — every trip-capable role
//                                          (owner/manager/supervisor/operator)
import { supabase } from "@/integrations/ios-supabase/client";

export const DEFAULT_SAMPLES_PER_HECTARE = 20;
export const MIN_SAMPLES_PER_HECTARE = 1;
export const MAX_SAMPLES_PER_HECTARE = 100;

/** Roles that may run a Bunch Count Trip, and therefore set the density. */
const TRIP_ROLES = new Set(["owner", "manager", "supervisor", "operator"]);

export function canEditYieldSampling(role: string | null | undefined): boolean {
  return !!role && TRIP_ROLES.has(role);
}

function readSamples(data: any): number | null {
  const row = Array.isArray(data) ? data[0] : data;
  const raw =
    row?.yield_samples_per_hectare ?? row?.samples_per_hectare ?? (typeof row === "number" ? row : null);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export async function fetchYieldSamplingSettings(vineyardId: string): Promise<number | null> {
  const { data, error } = await (supabase as any).rpc("get_vineyard_yield_sampling_settings", {
    p_vineyard_id: vineyardId,
  });
  if (error) throw error;
  return readSamples(data);
}

export async function setYieldSamplingSettings(
  vineyardId: string,
  samplesPerHectare: number,
): Promise<number | null> {
  const value = Math.round(Number(samplesPerHectare));
  if (!Number.isFinite(value) || value < MIN_SAMPLES_PER_HECTARE || value > MAX_SAMPLES_PER_HECTARE) {
    throw new Error(
      `Sampling density must be between ${MIN_SAMPLES_PER_HECTARE} and ${MAX_SAMPLES_PER_HECTARE} samples per hectare`,
    );
  }
  const { data, error } = await (supabase as any).rpc("set_vineyard_yield_sampling_settings", {
    p_vineyard_id: vineyardId,
    p_samples_per_hectare: value,
  });
  if (error) throw error;
  return readSamples(data) ?? value;
}
