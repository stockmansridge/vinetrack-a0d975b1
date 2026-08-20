// Stage 3 — live Core Setup health facts for How VineTrack Works.
//
// Read-only. Every fetch is best-effort: a failing source degrades that one
// check to "not checked" rather than breaking the page. All data comes from
// the shared VineTrack (iOS) Supabase project through existing contracts.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { fetchWeatherStatusForVineyard } from "@/lib/weatherStatusQuery";
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

async function fetchBlocks(vineyardId: string): Promise<SetupBlockFact[]> {
  const base = "id, name, polygon_points, rows, variety_allocations, deleted_at";
  let res = await (supabase as any)
    .from("paddocks")
    .select(`${base}, is_irrigated`)
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
    hasRows: arr(p.rows).length > 0,
    hasPlanting: arr(p.variety_allocations).length > 0,
    isIrrigated: p.is_irrigated === true,
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

async function fetchSpray(vineyardId: string) {
  const [chemicals, equipment, records, jobs] = await Promise.allSettled([
    countRows("saved_chemicals", vineyardId),
    countRows("spray_equipment", vineyardId),
    countRows("spray_records", vineyardId),
    countRows("spray_jobs", vineyardId),
  ]);
  const chem = ok(chemicals);
  const eq = ok(equipment);
  if (chem === null && eq === null) throw new Error("spray facts unavailable");
  return {
    chemicals: chem ?? 0,
    sprayEquipment: eq ?? 0,
    usageEvidence: (ok(records) ?? 0) + (ok(jobs) ?? 0),
  };
}

async function fetchIrrigation(vineyardId: string, blocks: SetupBlockFact[] | null) {
  const { data, error } = await (supabase as any).rpc("get_irrigation_setup_status", {
    p_vineyard_id: vineyardId,
  });
  if (error) throw error;
  const req = (data as any)?.required ?? {};
  const systems = Number(req.active_system_count ?? 0);
  const valves = Number(req.active_valve_count ?? 0);
  const irrigatedBlocks = (blocks ?? []).some((b) => b.isIrrigated);
  return {
    applicable: irrigatedBlocks || systems > 0 || valves > 0,
    systemsOk: req.systems_ok === true,
    valvesOk: req.valves_ok === true,
    allocationsOk: req.allocations_ok === true,
  };
}

export async function fetchSetupHealthFacts(vineyardId: string): Promise<SetupHealthFacts> {
  const blocksResult = await Promise.allSettled([fetchBlocks(vineyardId)]);
  const blocks = ok(blocksResult[0]);

  const [vineyard, weather, equipment, team, spray, irrigation] = await Promise.allSettled([
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
    (async () => {
      const s = await fetchWeatherStatusForVineyard(vineyardId);
      return { anyConfigured: s.anyConfigured };
    })(),
    fetchEquipment(vineyardId),
    fetchTeam(vineyardId),
    fetchSpray(vineyardId),
    fetchIrrigation(vineyardId, blocks),
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
    // Operational preferences have no authoritative read contract in the
    // portal yet — reported as "not checked" rather than guessed.
    preferences: null,
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
