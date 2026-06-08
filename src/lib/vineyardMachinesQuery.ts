// Query + write helpers for `public.vineyard_machines` on the iOS Supabase
// project. iOS/Rork is the source of truth for the data contract.
//
// Vineyard Machines are powered machines used directly for vineyard work
// (tractor, ATV, side-by-side, harvester, utility vehicle, other). They are
// the new home for Fuel Logs (`tractor_fuel_logs.machine_id`) and trip
// machine assignment (`trips.machine_id`). Existing tractor_id columns
// remain as legacy fallback.

import { supabase } from "@/integrations/ios-supabase/client";

export type MachineType =
  | "tractor"
  | "atv"
  | "side_by_side"
  | "harvester"
  | "utility_vehicle"
  | "other_vineyard_machine";

export const MACHINE_TYPES: MachineType[] = [
  "tractor",
  "atv",
  "side_by_side",
  "harvester",
  "utility_vehicle",
  "other_vineyard_machine",
];

export const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
  tractor: "Tractor",
  atv: "ATV",
  side_by_side: "Side-by-side",
  harvester: "Harvester",
  utility_vehicle: "Utility vehicle",
  other_vineyard_machine: "Other vineyard machine",
};

export function machineTypeLabel(t?: string | null): string {
  if (!t) return "—";
  return MACHINE_TYPE_LABELS[t as MachineType] ?? t;
}

export interface VineyardMachine {
  id: string;
  vineyard_id: string;
  name: string;
  machine_type: MachineType | string;
  fuel_tracking_enabled: boolean | null;
  available_for_job_costing: boolean | null;
  fuel_usage_l_per_hour: number | null;
  notes: string | null;
  legacy_tractor_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  client_updated_at: string | null;
  sync_version: number | null;
}

const nowIso = () => new Date().toISOString();

export async function fetchActiveVineyardMachines(
  vineyardId: string,
): Promise<VineyardMachine[]> {
  const { data, error } = await supabase
    .from("vineyard_machines")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .is("legacy_tractor_id", null);
  if (error) {
    // Table may not exist yet in some envs — degrade gracefully.
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("does not exist") || msg.includes("not found")) return [];
    throw error;
  }
  return ((data ?? []) as VineyardMachine[]).sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

// Fetch ALL (including deleted) so historical fuel logs / trips that
// reference an archived machine can still render the machine name.
export async function fetchAllVineyardMachines(
  vineyardId: string,
): Promise<VineyardMachine[]> {
  const { data, error } = await supabase
    .from("vineyard_machines")
    .select("*")
    .eq("vineyard_id", vineyardId);
  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("does not exist") || msg.includes("not found")) return [];
    throw error;
  }
  return (data ?? []) as VineyardMachine[];
}

export interface CreateVineyardMachineInput {
  vineyard_id: string;
  name: string;
  machine_type: MachineType;
  fuel_tracking_enabled: boolean;
  available_for_job_costing: boolean;
  fuel_usage_l_per_hour: number | null;
  notes?: string | null;
  user_id: string | null;
}

export async function createVineyardMachine(
  input: CreateVineyardMachineInput,
): Promise<VineyardMachine> {
  const payload = {
    id: crypto.randomUUID(),
    vineyard_id: input.vineyard_id,
    name: input.name,
    machine_type: input.machine_type,
    fuel_tracking_enabled: input.fuel_tracking_enabled,
    available_for_job_costing: input.available_for_job_costing,
    fuel_usage_l_per_hour: input.fuel_usage_l_per_hour,
    notes: input.notes ?? null,
    legacy_tractor_id: null,
    created_by: input.user_id,
    updated_by: input.user_id,
    client_updated_at: nowIso(),
    sync_version: 1,
    deleted_at: null,
  };
  const { data, error } = await supabase
    .from("vineyard_machines")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as VineyardMachine;
}

export interface UpdateVineyardMachineInput {
  id: string;
  name?: string;
  machine_type?: MachineType;
  fuel_tracking_enabled?: boolean;
  available_for_job_costing?: boolean;
  fuel_usage_l_per_hour?: number | null;
  notes?: string | null;
  user_id: string | null;
  current_sync_version?: number | null;
}

export async function updateVineyardMachine(
  input: UpdateVineyardMachineInput,
): Promise<VineyardMachine> {
  const nextVersion = (input.current_sync_version ?? 0) + 1;
  const patch: Record<string, unknown> = {
    updated_by: input.user_id,
    client_updated_at: nowIso(),
    sync_version: nextVersion,
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.machine_type !== undefined) patch.machine_type = input.machine_type;
  if (input.fuel_tracking_enabled !== undefined)
    patch.fuel_tracking_enabled = input.fuel_tracking_enabled;
  if (input.available_for_job_costing !== undefined)
    patch.available_for_job_costing = input.available_for_job_costing;
  if (input.fuel_usage_l_per_hour !== undefined)
    patch.fuel_usage_l_per_hour = input.fuel_usage_l_per_hour;
  if (input.notes !== undefined) patch.notes = input.notes;

  const { data, error } = await supabase
    .from("vineyard_machines")
    .update(patch)
    .eq("id", input.id)
    .select()
    .single();
  if (error) throw error;
  return data as VineyardMachine;
}

export async function softDeleteVineyardMachine(
  id: string,
  userId: string | null,
  currentSyncVersion?: number | null,
): Promise<void> {
  const rpc = await supabase.rpc("soft_delete_vineyard_machine", { p_id: id });
  if (!rpc.error) return;
  const nextVersion = (currentSyncVersion ?? 0) + 1;
  const { error } = await supabase
    .from("vineyard_machines")
    .update({
      deleted_at: nowIso(),
      updated_by: userId,
      client_updated_at: nowIso(),
      sync_version: nextVersion,
    })
    .eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Display resolvers (machine_id preferred, tractor_id legacy fallback).
// ---------------------------------------------------------------------------

export interface MachineRefLike {
  machine_id?: string | null;
  tractor_id?: string | null;
}

export interface ResolvedMachine {
  id: string | null;
  name: string;
  type: MachineType | string | null;
  typeLabel: string;
  fuel_l_per_hour: number | null;
  source: "machine" | "tractor" | "none";
}

export function resolveMachineForRecord(
  rec: MachineRefLike,
  machinesById: Map<string, Pick<VineyardMachine, "id" | "name" | "machine_type" | "fuel_usage_l_per_hour">>,
  tractorsById: Map<string, { id: string; name?: string | null; fuel_usage_l_per_hour?: number | null }>,
): ResolvedMachine {
  if (rec.machine_id) {
    const m = machinesById.get(rec.machine_id);
    if (m) {
      return {
        id: m.id,
        name: m.name ?? "Unnamed machine",
        type: m.machine_type ?? null,
        typeLabel: machineTypeLabel(m.machine_type),
        fuel_l_per_hour: m.fuel_usage_l_per_hour ?? null,
        source: "machine",
      };
    }
  }
  if (rec.tractor_id) {
    const t = tractorsById.get(rec.tractor_id);
    if (t) {
      return {
        id: t.id,
        name: t.name ?? "Unnamed tractor",
        type: "tractor",
        typeLabel: MACHINE_TYPE_LABELS.tractor,
        fuel_l_per_hour: t.fuel_usage_l_per_hour ?? null,
        source: "tractor",
      };
    }
    return {
      id: rec.tractor_id,
      name: "Unknown tractor",
      type: "tractor",
      typeLabel: MACHINE_TYPE_LABELS.tractor,
      fuel_l_per_hour: null,
      source: "tractor",
    };
  }
  return {
    id: null,
    name: "—",
    type: null,
    typeLabel: "—",
    fuel_l_per_hour: null,
    source: "none",
  };
}
