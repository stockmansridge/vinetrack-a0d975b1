// Shared Soil Profile helpers.
//
// Source of truth: iOS-shared Supabase (paddock_soil_profiles,
// soil_class_defaults + RPCs + nsw-seed-soil-lookup edge function).
// Lovable portal calls the same RPCs so iOS and the portal stay in sync.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

export type IrrigationSoilClass =
  | "sand_loamy_sand"
  | "sandy_loam"
  | "loam"
  | "silt_loam"
  | "clay_loam"
  | "light_clay"
  | "medium_clay"
  | "heavy_clay"
  | "shallow_skeletal"
  | string; // tolerate future classes

export interface SoilClassDefault {
  irrigation_soil_class: IrrigationSoilClass;
  label: string;
  description?: string | null;
  default_awc_min_mm_per_m?: number | null;
  default_awc_max_mm_per_m?: number | null;
  default_awc_mm_per_m?: number | null;
  default_allowed_depletion_percent?: number | null;
  default_root_depth_m?: number | null;
  infiltration_risk?: string | null;
  drainage_risk?: string | null;
  waterlogging_risk?: string | null;
  sort_order?: number | null;
}

export interface PaddockSoilProfile {
  paddock_id: string;
  irrigation_soil_class?: IrrigationSoilClass | null;
  soil_landscape?: string | null;
  salis_code?: string | null;
  australian_soil_classification?: string | null;
  land_and_soil_capability?: string | null;
  awc_mm_per_m?: number | null;
  effective_root_depth_m?: number | null;
  allowed_depletion_percent?: number | null;
  confidence?: string | null;
  source?: string | null;
  provider?: string | null;
  manual_override?: boolean | null;
  manual_notes?: string | null;
  raw?: unknown;
  updated_at?: string | null;
  created_at?: string | null;
  [k: string]: unknown;
}

const SOIL_DEFAULTS_QK = ["soil", "class-defaults"] as const;
const PADDOCK_QK = (id?: string | null) => ["soil", "paddock", id] as const;
const VINEYARD_LIST_QK = (id?: string | null) => ["soil", "vineyard-list", id] as const;
const VINEYARD_DEFAULT_QK = (id?: string | null) => ["soil", "vineyard-default", id] as const;

export function useSoilClassDefaults() {
  return useQuery({
    queryKey: SOIL_DEFAULTS_QK,
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<SoilClassDefault[]> => {
      const { data, error } = await (supabase as any).rpc("get_soil_class_defaults");
      if (error) {
        console.debug("[soil] get_soil_class_defaults error", error.message);
        return [];
      }
      const rows = (data ?? []) as SoilClassDefault[];
      return [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    },
  });
}

export function usePaddockSoilProfile(paddockId?: string | null) {
  return useQuery({
    queryKey: PADDOCK_QK(paddockId),
    enabled: !!paddockId,
    staleTime: 30_000,
    queryFn: async (): Promise<PaddockSoilProfile | null> => {
      const { data, error } = await (supabase as any).rpc("get_paddock_soil_profile", {
        p_paddock_id: paddockId,
      });
      if (error) {
        // P0002 = paddock_not_found; soft-fail to null
        if ((error as any).code === "P0002") return null;
        console.debug("[soil] get_paddock_soil_profile error", error.message);
        return null;
      }
      // RPC may return an object or a single-row array
      if (Array.isArray(data)) return (data[0] as PaddockSoilProfile) ?? null;
      return (data as PaddockSoilProfile) ?? null;
    },
  });
}

export function useVineyardSoilProfiles(vineyardId?: string | null) {
  return useQuery({
    queryKey: VINEYARD_LIST_QK(vineyardId),
    enabled: !!vineyardId,
    staleTime: 30_000,
    queryFn: async (): Promise<PaddockSoilProfile[]> => {
      const { data, error } = await (supabase as any).rpc("list_vineyard_soil_profiles", {
        p_vineyard_id: vineyardId,
      });
      if (error) {
        console.debug("[soil] list_vineyard_soil_profiles error", error.message);
        return [];
      }
      return (data ?? []) as PaddockSoilProfile[];
    },
  });
}

export function useVineyardDefaultSoilProfile(vineyardId?: string | null) {
  return useQuery({
    queryKey: VINEYARD_DEFAULT_QK(vineyardId),
    enabled: !!vineyardId,
    staleTime: 30_000,
    queryFn: async (): Promise<PaddockSoilProfile | null> => {
      const { data, error } = await (supabase as any).rpc(
        "get_vineyard_default_soil_profile",
        { p_vineyard_id: vineyardId },
      );
      if (error) {
        console.debug("[soil] get_vineyard_default_soil_profile error", error.message);
        return null;
      }
      if (Array.isArray(data)) return (data[0] as PaddockSoilProfile) ?? null;
      return (data as PaddockSoilProfile) ?? null;
    },
  });
}

export interface UpsertPaddockSoilProfileInput {
  paddockId: string;
  irrigationSoilClass?: string | null;
  soilLandscape?: string | null;
  salisCode?: string | null;
  australianSoilClassification?: string | null;
  landAndSoilCapability?: string | null;
  awcMmPerM?: number | null;
  effectiveRootDepthM?: number | null;
  allowedDepletionPercent?: number | null;
  confidence?: string | null;
  source?: string | null;
  provider?: string | null;
  manualOverride?: boolean | null;
  manualNotes?: string | null;
  raw?: unknown;
}

function buildUpsertArgs(input: UpsertPaddockSoilProfileInput) {
  return {
    p_paddock_id: input.paddockId,
    p_irrigation_soil_class: input.irrigationSoilClass ?? null,
    p_soil_landscape: input.soilLandscape ?? null,
    p_salis_code: input.salisCode ?? null,
    p_australian_soil_classification: input.australianSoilClassification ?? null,
    p_land_and_soil_capability: input.landAndSoilCapability ?? null,
    p_awc_mm_per_m: input.awcMmPerM ?? null,
    p_effective_root_depth_m: input.effectiveRootDepthM ?? null,
    p_allowed_depletion_percent: input.allowedDepletionPercent ?? null,
    p_confidence: input.confidence ?? null,
    p_source: input.source ?? null,
    p_provider: input.provider ?? null,
    p_manual_override: input.manualOverride ?? null,
    p_manual_notes: input.manualNotes ?? null,
    p_raw: input.raw ?? null,
  };
}

export function useUpsertPaddockSoilProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertPaddockSoilProfileInput) => {
      const { error } = await (supabase as any).rpc(
        "upsert_paddock_soil_profile",
        buildUpsertArgs(input),
      );
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: PADDOCK_QK(input.paddockId) });
      qc.invalidateQueries({ queryKey: ["soil", "vineyard-list"] });
    },
  });
}

export function useDeletePaddockSoilProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (paddockId: string) => {
      const { error } = await (supabase as any).rpc("delete_paddock_soil_profile", {
        p_paddock_id: paddockId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, paddockId) => {
      qc.invalidateQueries({ queryKey: PADDOCK_QK(paddockId) });
      qc.invalidateQueries({ queryKey: ["soil", "vineyard-list"] });
    },
  });
}

export function useUpsertVineyardDefaultSoilProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      vineyardId: string;
      irrigationSoilClass?: string | null;
      awcMmPerM?: number | null;
      effectiveRootDepthM?: number | null;
      allowedDepletionPercent?: number | null;
      manualNotes?: string | null;
    }) => {
      const { error } = await (supabase as any).rpc(
        "upsert_vineyard_default_soil_profile",
        {
          p_vineyard_id: args.vineyardId,
          p_irrigation_soil_class: args.irrigationSoilClass ?? null,
          p_awc_mm_per_m: args.awcMmPerM ?? null,
          p_effective_root_depth_m: args.effectiveRootDepthM ?? null,
          p_allowed_depletion_percent: args.allowedDepletionPercent ?? null,
          p_manual_notes: args.manualNotes ?? null,
        },
      );
      if (error) throw error;
    },
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: VINEYARD_DEFAULT_QK(args.vineyardId) });
    },
  });
}

export function useDeleteVineyardDefaultSoilProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vineyardId: string) => {
      const { error } = await (supabase as any).rpc(
        "delete_vineyard_default_soil_profile",
        { p_vineyard_id: vineyardId },
      );
      if (error) throw error;
    },
    onSuccess: (_d, vineyardId) => {
      qc.invalidateQueries({ queryKey: VINEYARD_DEFAULT_QK(vineyardId) });
    },
  });
}

/** NSW SEED lookup via the shared Edge Function. API key stays server-side. */
export interface NswSeedLookupResult {
  irrigation_soil_class?: string | null;
  soil_landscape?: string | null;
  salis_code?: string | null;
  australian_soil_classification?: string | null;
  land_and_soil_capability?: string | null;
  awc_mm_per_m?: number | null;
  effective_root_depth_m?: number | null;
  allowed_depletion_percent?: number | null;
  confidence?: string | null;
  provider?: string | null;
  source?: string | null;
  raw?: unknown;
  [k: string]: unknown;
}

export function useNswSeedLookup() {
  return useMutation({
    mutationFn: async (args: {
      latitude: number;
      longitude: number;
    }): Promise<NswSeedLookupResult> => {
      const { data, error } = await (supabase as any).functions.invoke(
        "nsw-seed-soil-lookup",
        { body: { latitude: args.latitude, longitude: args.longitude } },
      );
      if (error) throw error;
      return (data ?? {}) as NswSeedLookupResult;
    },
  });
}

// ---------- Derived metrics ----------

/** Root zone water capacity (mm) = AWC (mm/m) × effective root depth (m). */
export function computeRootZoneCapacityMm(
  awcMmPerM: number | null | undefined,
  rootDepthM: number | null | undefined,
): number | null {
  const a = Number(awcMmPerM);
  const r = Number(rootDepthM);
  if (!(a > 0) || !(r > 0)) return null;
  return a * r;
}

/** Readily available water (mm) = root zone capacity × allowed depletion %. */
export function computeReadilyAvailableWaterMm(
  rootZoneCapacityMm: number | null | undefined,
  allowedDepletionPercent: number | null | undefined,
): number | null {
  const c = Number(rootZoneCapacityMm);
  const p = Number(allowedDepletionPercent);
  if (!(c > 0) || !(p > 0)) return null;
  return c * (p / 100);
}

/** Soil moisture buffer (mm) for the irrigation advisor — RAW by default. */
export function deriveSoilBufferMm(profile: PaddockSoilProfile | null | undefined): number | null {
  if (!profile) return null;
  const cap = computeRootZoneCapacityMm(
    profile.awc_mm_per_m as number | null,
    profile.effective_root_depth_m as number | null,
  );
  const raw = computeReadilyAvailableWaterMm(
    cap,
    profile.allowed_depletion_percent as number | null,
  );
  return raw;
}

/** Conservative aggregate across paddock profiles for whole-vineyard mode.
 *  Picks the MIN AWC × MIN root depth × MIN allowed depletion across blocks. */
export function aggregateConservativeBuffer(
  profiles: PaddockSoilProfile[],
): number | null {
  const valid = profiles
    .map((p) => ({
      awc: Number(p.awc_mm_per_m),
      root: Number(p.effective_root_depth_m),
      dep: Number(p.allowed_depletion_percent),
    }))
    .filter((x) => x.awc > 0 && x.root > 0 && x.dep > 0);
  if (!valid.length) return null;
  const awc = Math.min(...valid.map((v) => v.awc));
  const root = Math.min(...valid.map((v) => v.root));
  const dep = Math.min(...valid.map((v) => v.dep));
  return awc * root * (dep / 100);
}

export const NSW_SEED_DISCLAIMER =
  "Soil information is estimated from NSW SEED mapping and may not reflect site-specific vineyard soil conditions. Adjust soil class and water-holding values using your own soil knowledge where needed.";
