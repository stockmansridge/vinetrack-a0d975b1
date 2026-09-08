// Shared Soil Profile helpers.
//
// Source of truth: iOS-shared Supabase (paddock_soil_profiles table +
// soil_class_defaults via the get_soil_class_defaults RPC).
//
// The shared backend exposes the TABLE (protected by RLS) but not the
// get/upsert/delete paddock RPCs the portal originally called, so the
// portal reads and writes the table directly. The deployed column names
// differ from the old RPC contract; both directions are mapped here.
// There is no per-row allowed-depletion column on the deployed table —
// depletion is derived from the soil-class defaults on read.

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

/** Map a deployed paddock_soil_profiles row to the portal shape. */
function fromRow(row: Record<string, any>): PaddockSoilProfile {
  return {
    ...row,
    awc_mm_per_m: row.available_water_capacity_mm_per_m ?? null,
    salis_code: row.soil_landscape_code ?? null,
    land_and_soil_capability: row.land_soil_capability ?? null,
    manual_override: row.is_manual_override ?? null,
    provider: row.source_provider ?? null,
    raw: null,
  } as PaddockSoilProfile;
}

async function fetchClassDefaults(): Promise<SoilClassDefault[]> {
  const { data, error } = await (supabase as any).rpc("get_soil_class_defaults");
  if (error) return [];
  return (data ?? []) as SoilClassDefault[];
}

/**
 * The deployed table has no allowed-depletion column; derive it from the
 * soil-class defaults so the irrigation buffer maths still works.
 */
function withDerivedDepletion(
  profile: PaddockSoilProfile | null,
  defaults: SoilClassDefault[],
): PaddockSoilProfile | null {
  if (!profile) return null;
  const def = defaults.find(
    (d) => d.irrigation_soil_class === profile.irrigation_soil_class,
  );
  return {
    ...profile,
    allowed_depletion_percent:
      profile.allowed_depletion_percent ??
      def?.default_allowed_depletion_percent ??
      null,
  };
}

export function usePaddockSoilProfile(paddockId?: string | null) {
  return useQuery({
    queryKey: PADDOCK_QK(paddockId),
    enabled: !!paddockId,
    staleTime: 30_000,
    queryFn: async (): Promise<PaddockSoilProfile | null> => {
      const { data, error } = await (supabase as any)
        .from("paddock_soil_profiles")
        .select("*")
        .eq("paddock_id", paddockId)
        .maybeSingle();
      if (error) {
        console.debug("[soil] paddock_soil_profiles read error", error.message);
        return null;
      }
      if (!data) return null;
      const defaults = await fetchClassDefaults();
      return withDerivedDepletion(fromRow(data), defaults);
    },
  });
}

export function useVineyardSoilProfiles(vineyardId?: string | null) {
  return useQuery({
    queryKey: VINEYARD_LIST_QK(vineyardId),
    enabled: !!vineyardId,
    staleTime: 30_000,
    queryFn: async (): Promise<PaddockSoilProfile[]> => {
      const { data, error } = await (supabase as any)
        .from("paddock_soil_profiles")
        .select("*")
        .eq("vineyard_id", vineyardId);
      if (error) {
        console.debug("[soil] paddock_soil_profiles list error", error.message);
        return [];
      }
      const rows = ((data ?? []) as Record<string, any>[]).map(fromRow);
      if (!rows.length) return [];
      const defaults = await fetchClassDefaults();
      return rows.map(
        (p) => withDerivedDepletion(p, defaults) as PaddockSoilProfile,
      );
    },
  });
}

export function useVineyardDefaultSoilProfile(vineyardId?: string | null) {
  return useQuery({
    queryKey: VINEYARD_DEFAULT_QK(vineyardId),
    enabled: !!vineyardId,
    staleTime: 30_000,
    queryFn: async (): Promise<PaddockSoilProfile | null> => {
      // The shared backend has no vineyard-default soil storage (the RPC
      // is not deployed); there is no portal-accessible source, so this
      // intentionally resolves to null.
      return null;
    },
  });
}

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

function buildRow(input: UpsertPaddockSoilProfileInput) {
  // Only columns that exist on the deployed paddock_soil_profiles table.
  // allowed_depletion_percent and raw have no column and are not sent.
  const row: Record<string, unknown> = {
    paddock_id: input.paddockId,
    irrigation_soil_class: input.irrigationSoilClass ?? null,
    soil_landscape: input.soilLandscape ?? null,
    soil_landscape_code: input.salisCode ?? null,
    australian_soil_classification: input.australianSoilClassification ?? null,
    land_soil_capability: input.landAndSoilCapability ?? null,
    available_water_capacity_mm_per_m: input.awcMmPerM ?? null,
    effective_root_depth_m: input.effectiveRootDepthM ?? null,
    confidence: input.confidence ?? null,
    source: input.source ?? "manual",
    source_provider: input.provider ?? null,
    is_manual_override: input.manualOverride ?? null,
    manual_notes: input.manualNotes ?? null,
  };
  if (input.vineyardId) row.vineyard_id = input.vineyardId;
  return row;
}

/**
 * The shared table's RLS check is scoped by vineyard (and, on the deployed
 * schema, by the writing user). Resolve the vineyard from the paddock when
 * the caller did not supply it, and stamp ownership columns when they exist.
 */
async function resolveVineyardId(
  paddockId: string,
  supplied?: string | null,
): Promise<string | null> {
  if (supplied) return supplied;
  const { data } = await (supabase as any)
    .from("paddocks")
    .select("vineyard_id")
    .eq("id", paddockId)
    .maybeSingle();
  return (data?.vineyard_id as string | undefined) ?? null;
}

const MISSING_COLUMN = "42703";

export function useUpsertPaddockSoilProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertPaddockSoilProfileInput) => {
      const vineyardId = await resolveVineyardId(input.paddockId, input.vineyardId);
      const base = buildRow({ ...input, vineyardId });
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? null;

      const attempt = async (row: Record<string, unknown>) =>
        (supabase as any)
          .from("paddock_soil_profiles")
          .upsert(row, { onConflict: "paddock_id" });

      let { error } = await attempt(
        userId ? { ...base, created_by: userId, updated_by: userId } : base,
      );
      // Older deployments have no ownership columns — retry without them.
      if (error && (error.code === MISSING_COLUMN || /created_by|updated_by/.test(error.message ?? ""))) {
        ({ error } = await attempt(base));
      }
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
      const { error } = await (supabase as any)
        .from("paddock_soil_profiles")
        .delete()
        .eq("paddock_id", paddockId);
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
      vineyardId?: string | null;
      paddockId?: string | null;
    }): Promise<NswSeedLookupResult> => {
      const payload: Record<string, unknown> = {
        latitude: args.latitude,
        longitude: args.longitude,
      };
      if (args.vineyardId) payload.vineyardId = args.vineyardId;
      if (args.paddockId) payload.paddockId = args.paddockId;
      console.log("NSW SEED request payload", payload);
      console.log("supabase.functions.invoke call", {
        functionName: "nsw-seed-soil-lookup",
        options: { body: payload },
      });
      const { data, error } = await (supabase as any).functions.invoke(
        "nsw-seed-soil-lookup",
        { body: payload },
      );
      if (error) {
        console.warn("NSW SEED invoke error", {
          message: (error as any)?.message,
          name: (error as any)?.name,
          context: (error as any)?.context,
        });
        // Surface structured error from the edge function body when available.
        const ctx: any = (error as any)?.context;
        try {
          const text =
            typeof ctx?.text === "function" ? await ctx.text() : null;
          if (text) {
            try {
              const parsed = JSON.parse(text);
              throw new Error(parsed?.error || parsed?.message || text);
            } catch {
              throw new Error(text);
            }
          }
        } catch (inner: any) {
          if (inner instanceof Error) throw inner;
        }
        throw error;
      }
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
