// Stage 3 / 3.1 — live Core Setup health facts for How VineTrack Works.
//
// Read-only. Every fetch is best-effort: a failing source degrades that one
// check to "not checked" rather than breaking the page or reporting a false
// failure. All data comes from the shared VineTrack (iOS) Supabase project
// through existing contracts. No new SQL, schema or RPCs.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { fetchWeatherStatusForVineyard } from "@/lib/weatherStatusQuery";
import {
  MONTHS,
  fetchVineyardSeasonSettings,
} from "@/lib/vineyardSeasonSettingsQuery";
import {
  deriveSetupHealth,
  EMPTY_SETUP_FACTS,
  type SetupBlockFact,
  type SetupHealthFacts,
  type SetupHealthSummary,
} from "@/lib/guide/setupHealth";

const ok = <T,>(r: PromiseSettledResult<T>): T | null =>
  r.status === "fulfilled" ? r.value : null;

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function countRows(table: string, vineyardId: string, soft = true): Promise<number> {
  let q = (supabase as any)
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("vineyard_id", vineyardId);
  if (soft) q = q.is("deleted_at", null);
  const { count, error } = await q;
  if (error) {
    if (soft) return countRows(table, vineyardId, false);
    throw error;
  }
  return count ?? 0;
}

/** Enrichment: does every planting allocation name a clone or a rootstock? */
function allocationsHaveDetail(raw: unknown): boolean {
  const list = arr(raw) as any[];
  if (list.length === 0) return false;
  return list.every((a) => {
    const clone = a?.clone ?? a?.clone_name ?? a?.cloneId ?? a?.clone_id;
    const rootstock = a?.rootstock ?? a?.rootstock_name ?? a?.rootstockId ?? a?.rootstock_id;
    return !!String(clone ?? "").trim() || !!String(rootstock ?? "").trim();
  });
}

/**
 * Canonical block set: paddocks for THIS vineyard with `deleted_at is null`
 * — the same filter used across the portal and by
 * `get_irrigation_setup_status`. Archived/deleted blocks never enter coverage.
 */
async function fetchBlocks(vineyardId: string): Promise<SetupBlockFact[]> {
  const base = "id, name, polygon_points, rows, variety_allocations, deleted_at";
  const irrigationCols = "is_irrigated, flow_per_emitter, emitter_spacing";
  let res = await (supabase as any)
    .from("paddocks")
    .select(`${base}, ${irrigationCols}`)
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (res.error) {
    res = await (supabase as any)
      .from("paddocks")
      .select(base)
      .eq("vineyard_id", vineyardId)
      .is("deleted_at", null);
  }
  if (res.error) throw res.error;
  return ((res.data ?? []) as any[]).map((p) => ({
    id: String(p.id),
    name: p.name ?? null,
    hasBoundary: arr(p.polygon_points).length >= 3,
    // Row setup = at least one persisted row entry. Row direction, spacing and
    // geometry are NOT separate requirements (see Stage 3.1 §6).
    hasRows: arr(p.rows).length > 0,
    hasPlanting: arr(p.variety_allocations).length > 0,
    hasPlantingDetail: allocationsHaveDetail(p.variety_allocations),
    // Same derivation as src/lib/blockDiagnostics.ts.
    isIrrigated:
      p.is_irrigated === true ||
      (num(p.flow_per_emitter) ?? 0) > 0 ||
      (num(p.emitter_spacing) ?? 0) > 0,
  }));
}

async function fetchTeam(vineyardId: string) {
  const { data, error } = await (supabase as any)
    .from("vineyard_members")
    .select("id, role")
    .eq("vineyard_id", vineyardId);
  if (error) throw error;
  const rows = (data ?? []) as { role?: string | null }[];
  return {
    members: rows.length,
    owners: rows.filter((r) => (r.role ?? "").toLowerCase() === "owner").length,
  };
}

async function fetchEquipment(vineyardId: string) {
  const [tractors, machines, sprayEquipment, other] = await Promise.allSettled([
    countRows("tractors", vineyardId),
    countRows("vineyard_machines", vineyardId),
    countRows("spray_equipment", vineyardId),
    countRows("equipment_items", vineyardId),
  ]);
  return {
    tractors: ok(tractors) ?? 0,
    machines: ok(machines) ?? 0,
    sprayEquipment: ok(sprayEquipment) ?? 0,
    other: ok(other) ?? 0,
  };
}

/**
 * Spray facts. Applicability comes ONLY from vineyard-scoped operational
 * evidence (spray jobs + spray records); catalogue chemicals and stored
 * sprayers are configuration, not proof of use.
 */
async function fetchSpray(vineyardId: string) {
  const [chemicals, equipment, records, jobs] = await Promise.allSettled([
    countRows("saved_chemicals", vineyardId),
    countRows("spray_equipment", vineyardId),
    countRows("spray_records", vineyardId),
    countRows("spray_jobs", vineyardId),
  ]);
  const chem = ok(chemicals);
  const eq = ok(equipment);
  const rec = ok(records);
  const job = ok(jobs);
  if (rec === null && job === null) throw new Error("spray usage evidence unavailable");
  return {
    chemicals: chem ?? 0,
    sprayEquipment: eq ?? 0,
    operationalEvidence: (rec ?? 0) + (job ?? 0),
    evidenceDetail: `spray_jobs ${job ?? 0} + spray_records ${rec ?? 0}`,
  };
}

/**
 * Irrigation facts.
 *
 * `get_irrigation_setup_status` (SQL 125) is the established CONFIGURATION
 * aggregate: it is vineyard-scoped, calls `_irrigation_require_access` first
 * (so a permission problem raises an error → unknown, never a failure) and
 * reports systems/valves/allocations. It does NOT decide whether irrigation
 * applies — it never reads `is_irrigated`.
 *
 * Applicability therefore stays on the Stage 1 contract: any active block
 * flagged/derived as irrigated, or any active system/valve already configured.
 */
async function fetchIrrigation(vineyardId: string, blocks: SetupBlockFact[] | null) {
  const { data, error } = await (supabase as any).rpc("get_irrigation_setup_status", {
    p_vineyard_id: vineyardId,
  });
  if (error) throw error;
  const req = (data as any)?.required ?? {};
  const systems = Number(req.active_system_count ?? 0);
  const valves = Number(req.active_valve_count ?? 0);
  const irrigatedBlocks = (blocks ?? []).filter((b) => b.isIrrigated).length;
  const applicable = irrigatedBlocks > 0 || systems > 0 || valves > 0;
  return {
    applicable,
    applicabilityReason: applicable
      ? `irrigated blocks ${irrigatedBlocks}, systems ${systems}, valves ${valves}`
      : "no irrigated blocks, systems or valves",
    systemsOk: req.systems_ok === true,
    valvesOk: req.valves_ok === true,
    allocationsOk: req.allocations_ok === true,
  };
}

/**
 * Weather: configuration only. `get_vineyard_weather_integration` returns the
 * stored (non-secret) integration row. Provider outages, failed test calls and
 * missing observations never change this — they are not read here at all.
 * If BOTH provider reads error we return null (unknown), never "unconfigured".
 */
async function fetchWeather(vineyardId: string) {
  const s = await fetchWeatherStatusForVineyard(vineyardId);
  if (s.davis.error && s.wunderground.error) {
    throw new Error("weather configuration unavailable");
  }
  return { anyConfigured: s.anyConfigured };
}

/**
 * Operational preferences (optional). The shared RPC
 * `get_vineyard_season_settings` is the authority: a persisted season start
 * reports "Configured", an absent one reports "Using defaults". A failed read
 * stays unknown — it is never rendered as a failure and never affects
 * readiness, which excludes optional checks entirely.
 */
async function fetchPreferences(vineyardId: string) {
  const s = await fetchVineyardSeasonSettings(vineyardId);
  const monthLabel =
    MONTHS.find((m) => m.value === s.season_start_month)?.label ??
    String(s.season_start_month);
  return {
    seasonConfigured: s.configured,
    seasonDetail:
      s.configured === null
        ? undefined
        : s.configured
          ? `Season starts ${s.season_start_day} ${monthLabel}`
          : `No saved preference — showing default ${s.season_start_day} ${monthLabel}`,
  };
}

export async function fetchSetupHealthFacts(vineyardId: string): Promise<SetupHealthFacts> {
  const blocksResult = await Promise.allSettled([fetchBlocks(vineyardId)]);
  const blocks = ok(blocksResult[0]);

  const [vineyard, weather, equipment, team, spray, irrigation, preferences] =
    await Promise.allSettled([
    (async () => {
      const { data, error } = await (supabase as any)
        .from("vineyards")
        .select("id, name, latitude, longitude")
        .eq("id", vineyardId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("vineyard not found");
      return {
        name: (data.name ?? null) as string | null,
        hasLocation:
          typeof data.latitude === "number" && typeof data.longitude === "number",
      };
    })(),
    fetchWeather(vineyardId),
    fetchEquipment(vineyardId),
    fetchTeam(vineyardId),
    fetchSpray(vineyardId),
    fetchIrrigation(vineyardId, blocks),
    fetchPreferences(vineyardId),
  ]);

  return {
    resolved: true,
    vineyard: ok(vineyard),
    blocks,
    weather: ok(weather),
    equipment: ok(equipment),
    team: ok(team),
    spray: ok(spray),
    irrigation: ok(irrigation),
    preferences: ok(preferences),
  };
}

/**
 * Live Core Setup health for the currently selected vineyard.
 * Returns a resolved summary; while loading (or with no vineyard) every check
 * stays "not checked" and the caption reflects that.
 */
export function useSetupHealth(vineyardId: string | null | undefined): {
  summary: SetupHealthSummary;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const q = useQuery({
    queryKey: ["guide", "setup-health", vineyardId],
    enabled: !!vineyardId,
    staleTime: 60_000,
    queryFn: () => fetchSetupHealthFacts(vineyardId as string),
  });

  const facts = q.data ?? EMPTY_SETUP_FACTS;
  return {
    summary: deriveSetupHealth(facts),
    loading: !!vineyardId && q.isLoading,
    error: (q.error as Error) ?? null,
    refetch: () => void q.refetch(),
  };
}
