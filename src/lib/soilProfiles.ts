// Shared Soil Profile helpers.
//
// Source of truth: iOS-shared Supabase. RLS is enabled on
// paddock_soil_profiles with no direct-access policies — every read and
// write goes through the deployed RPCs, which enforce vineyard membership
// (reads) and Owner/Manager permission (writes):
//   get_paddock_soil_profile(p_paddock_id)
//   list_vineyard_soil_profiles(p_vineyard_id)
//   get_vineyard_default_soil_profile(p_vineyard_id)
//   upsert_paddock_soil_profile(...)            -- all arguments required
//   upsert_vineyard_default_soil_profile(...)
//   delete_paddock_soil_profile(p_paddock_id)
//   delete_vineyard_default_soil_profile(p_vineyard_id)
//   get_soil_class_defaults()
//
// Vineyard-wide profiles live in the same table with paddock_id = null.
// Because the upsert arguments have no meaningful defaults, every write
// re-sends the stored values for fields the portal does not edit.

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
  /** Null for the vineyard-wide (whole vineyard) profile. */
  paddock_id: string | null;
  vineyard_id?: string | null;
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
      if (error) throw error;
      const rows = (data ?? []) as SoilClassDefault[];
      return [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    },
  });
}

/** Map a stored paddock_soil_profiles row to the portal model. */
export function fromRow(row: Record<string, any>): PaddockSoilProfile {
  return {
    ...row,
    paddock_id: row.paddock_id ?? null,
    awc_mm_per_m: row.available_water_capacity_mm_per_m ?? null,
    allowed_depletion_percent: row.management_allowed_depletion_percent ?? null,
    salis_code: row.soil_landscape_code ?? null,
    land_and_soil_capability: row.land_soil_capability ?? null,
    manual_override: row.is_manual_override ?? null,
    provider: row.source_provider ?? null,
    raw: row.raw_source_json ?? null,
  } as PaddockSoilProfile;
}

function firstRow(data: any): Record<string, any> | null {
  if (!data) return null;
  if (Array.isArray(data)) return (data[0] as Record<string, any>) ?? null;
  return data as Record<string, any>;
}

async function rpcGetPaddockProfile(paddockId: string): Promise<PaddockSoilProfile | null> {
  const { data, error } = await (supabase as any).rpc("get_paddock_soil_profile", {
    p_paddock_id: paddockId,
  });
  if (error) throw error;
  const row = firstRow(data);
  return row ? fromRow(row) : null;
}

async function rpcGetVineyardDefaultProfile(
  vineyardId: string,
): Promise<PaddockSoilProfile | null> {
  const { data, error } = await (supabase as any).rpc(
    "get_vineyard_default_soil_profile",
    { p_vineyard_id: vineyardId },
  );
  if (error) throw error;
  const row = firstRow(data);
  return row ? fromRow(row) : null;
}

export interface SoilQueryOptions {
  /** Force a network read on every mount (used when the editor opens). */
  freshOnMount?: boolean;
}

function freshness(opts?: SoilQueryOptions) {
  return opts?.freshOnMount
    ? { staleTime: 0, refetchOnMount: "always" as const }
    : { staleTime: 30_000 };
}

export function usePaddockSoilProfile(
  paddockId?: string | null,
  opts?: SoilQueryOptions,
) {
  return useQuery({
    queryKey: PADDOCK_QK(paddockId),
    enabled: !!paddockId,
    ...freshness(opts),
    queryFn: () => rpcGetPaddockProfile(paddockId as string),
  });
}

/** Block profiles for a vineyard. Vineyard-wide rows are excluded. */
export function useVineyardSoilProfiles(
  vineyardId?: string | null,
  opts?: SoilQueryOptions,
) {
  return useQuery({
    queryKey: VINEYARD_LIST_QK(vineyardId),
    enabled: !!vineyardId,
    ...freshness(opts),
    queryFn: async (): Promise<PaddockSoilProfile[]> => {
      const { data, error } = await (supabase as any).rpc(
        "list_vineyard_soil_profiles",
        { p_vineyard_id: vineyardId },
      );
      if (error) throw error;
      return ((data ?? []) as Record<string, any>[])
        .map(fromRow)
        .filter((p) => !!p.paddock_id);
    },
  });
}

export function useVineyardDefaultSoilProfile(
  vineyardId?: string | null,
  opts?: SoilQueryOptions,
) {
  return useQuery({
    queryKey: VINEYARD_DEFAULT_QK(vineyardId),
    enabled: !!vineyardId,
    ...freshness(opts),
    queryFn: () => rpcGetVineyardDefaultProfile(vineyardId as string),
  });
}


// ---------- Validation ----------

export const SOIL_LIMITS = {
  awcMmPerM: { min: 0, max: 400 },
  rootDepthM: { min: 0, max: 5 },
  depletionPercent: { min: 0, max: 100 },
} as const;

/** null/blank => null; finite numbers (including 0) pass through. */
export function parseSoilNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Returns an error message, or null when the values are acceptable. */
export function validateSoilNumbers(input: {
  awcMmPerM?: number | null;
  effectiveRootDepthM?: number | null;
  allowedDepletionPercent?: number | null;
}): string | null {
  const checks: Array<[number | null | undefined, { min: number; max: number }, string]> = [
    [input.awcMmPerM, SOIL_LIMITS.awcMmPerM, "Available water capacity must be between 0 and 400 mm/m."],
    [input.effectiveRootDepthM, SOIL_LIMITS.rootDepthM, "Effective root depth must be between 0 and 5 m."],
    [
      input.allowedDepletionPercent,
      SOIL_LIMITS.depletionPercent,
      "Allowed depletion must be between 0 and 100%.",
    ],
  ];
  for (const [value, range, message] of checks) {
    if (value === null || value === undefined) continue;
    if (!Number.isFinite(value) || value < range.min || value > range.max) return message;
  }
  return null;
}

// ---------- Writes ----------

export interface UpsertPaddockSoilProfileInput {
  paddockId: string;
  vineyardId?: string | null;
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

export interface UpsertVineyardDefaultSoilProfileInput
  extends Omit<UpsertPaddockSoilProfileInput, "paddockId" | "vineyardId"> {
  vineyardId: string;
}

/**
 * Fields the portal does not edit. They are re-sent from the stored row so
 * an edit never blanks metadata written by a lookup or by mobile.
 */
const PRESERVED_FIELDS = [
  "australian_soil_classification_code",
  "country_code",
  "drainage_risk",
  "infiltration_risk",
  "land_soil_capability_class",
  "lookup_latitude",
  "lookup_longitude",
  "model_version",
  "region_code",
  "soil_description",
  "soil_texture_class",
  "source_dataset",
  "source_feature_id",
  "source_name",
  "waterlogging_risk",
] as const;

function preservedArgs(existing: PaddockSoilProfile | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of PRESERVED_FIELDS) {
    out[`p_${field}`] = (existing as any)?.[field] ?? null;
  }
  return out;
}

function editedArgs(
  input: Omit<UpsertPaddockSoilProfileInput, "paddockId" | "vineyardId">,
  existing: PaddockSoilProfile | null,
): Record<string, unknown> {
  return {
    p_irrigation_soil_class: input.irrigationSoilClass ?? null,
    p_soil_landscape: input.soilLandscape ?? null,
    p_soil_landscape_code: input.salisCode ?? null,
    p_australian_soil_classification: input.australianSoilClassification ?? null,
    p_land_soil_capability: input.landAndSoilCapability ?? null,
    p_available_water_capacity_mm_per_m: parseSoilNumber(input.awcMmPerM),
    p_effective_root_depth_m: parseSoilNumber(input.effectiveRootDepthM),
    p_management_allowed_depletion_percent: parseSoilNumber(input.allowedDepletionPercent),
    p_confidence: input.confidence ?? null,
    p_source: input.source ?? existing?.source ?? "manual",
    p_source_provider: input.provider ?? null,
    p_is_manual_override: input.manualOverride ?? false,
    p_manual_notes: input.manualNotes ?? null,
    p_raw_source_json: (input.raw ?? existing?.raw ?? null) as unknown,
  };
}

export function buildPaddockUpsertArgs(
  input: UpsertPaddockSoilProfileInput,
  existing: PaddockSoilProfile | null,
): Record<string, unknown> {
  return {
    p_paddock_id: input.paddockId,
    ...editedArgs(input, existing),
    ...preservedArgs(existing),
  };
}

export function buildVineyardDefaultUpsertArgs(
  input: UpsertVineyardDefaultSoilProfileInput,
  existing: PaddockSoilProfile | null,
): Record<string, unknown> {
  return {
    p_vineyard_id: input.vineyardId,
    ...editedArgs(input, existing),
    ...preservedArgs(existing),
  };
}

function invalidateSoil(qc: ReturnType<typeof useQueryClient>, args: {
  paddockId?: string | null;
  vineyardId?: string | null;
}) {
  if (args.paddockId) qc.invalidateQueries({ queryKey: PADDOCK_QK(args.paddockId) });
  qc.invalidateQueries({ queryKey: ["soil", "vineyard-list"] });
  qc.invalidateQueries({ queryKey: ["soil", "vineyard-default"] });
  qc.invalidateQueries({ queryKey: ["irrigation"] });
}

export function useUpsertPaddockSoilProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertPaddockSoilProfileInput) => {
      const invalid = validateSoilNumbers(input);
      if (invalid) throw new Error(invalid);
      const existing = await rpcGetPaddockProfile(input.paddockId);
      const { error } = await (supabase as any).rpc(
        "upsert_paddock_soil_profile",
        buildPaddockUpsertArgs(input, existing),
      );
      if (error) throw error;
    },
    onSuccess: (_d, input) => invalidateSoil(qc, input),
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
    onSuccess: (_d, paddockId) => invalidateSoil(qc, { paddockId }),
  });
}

export function useUpsertVineyardDefaultSoilProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertVineyardDefaultSoilProfileInput) => {
      const invalid = validateSoilNumbers(input);
      if (invalid) throw new Error(invalid);
      const existing = await rpcGetVineyardDefaultProfile(input.vineyardId);
      const { error } = await (supabase as any).rpc(
        "upsert_vineyard_default_soil_profile",
        buildVineyardDefaultUpsertArgs(input, existing),
      );
      if (error) throw error;
    },
    onSuccess: (_d, input) => invalidateSoil(qc, { vineyardId: input.vineyardId }),
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
    onSuccess: (_d, vineyardId) => invalidateSoil(qc, { vineyardId }),
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
  return computeReadilyAvailableWaterMm(
    cap,
    profile.allowed_depletion_percent as number | null,
  );
}

/** Conservative aggregate across block profiles for whole-vineyard mode.
 *  Picks the MIN AWC × MIN root depth × MIN allowed depletion across blocks.
 *  Vineyard-wide rows (paddock_id null) are never included. */
export function aggregateConservativeBuffer(
  profiles: PaddockSoilProfile[],
): number | null {
  const valid = profiles
    .filter((p) => !!p.paddock_id)
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
