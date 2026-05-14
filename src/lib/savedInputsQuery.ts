// Query + write helpers for saved_inputs on the iOS Supabase project.
//
// Shared library for seed / fertiliser / general input items, used by Trip
// Cost Summary to resolve cost-per-unit for seeding and input lines.
//
// Schema (Rork Phase 4C):
//   saved_inputs: name, input_type, unit, cost_per_unit, supplier, notes,
//   plus standard sync columns (id, vineyard_id, created_at, updated_at,
//   deleted_at, created_by, updated_by, client_updated_at, sync_version).
import { supabase } from "@/integrations/ios-supabase/client";

export interface SavedInput {
  id: string;
  vineyard_id: string;
  name?: string | null;
  input_type?: string | null;
  unit?: string | null;
  cost_per_unit?: number | null;
  supplier?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  client_updated_at?: string | null;
  sync_version?: number | null;
}

export interface SavedInputsQueryResult {
  inputs: SavedInput[];
  source: "vineyard_id" | "empty";
  vineyardCount: number;
  missingName: number;
  missingCost: number;
}

export async function fetchSavedInputsForVineyard(
  vineyardId: string,
  opts: { archived?: boolean } = {},
): Promise<SavedInputsQueryResult> {
  let q = supabase.from("saved_inputs").select("*").eq("vineyard_id", vineyardId);
  q = opts.archived ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
  const res = await q;
  if (res.error) throw res.error;
  const inputs = (res.data ?? []) as SavedInput[];
  return {
    inputs,
    source: inputs.length ? "vineyard_id" : "empty",
    vineyardCount: inputs.length,
    missingName: inputs.filter((c) => !c.name).length,
    missingCost: inputs.filter((c) => c.cost_per_unit == null).length,
  };
}

export interface SavedInputInput {
  name: string;
  input_type?: string | null;
  unit?: string | null;
  cost_per_unit?: number | null;
  supplier?: string | null;
  notes?: string | null;
}

const ALLOWED: (keyof SavedInputInput)[] = [
  "name", "input_type", "unit", "cost_per_unit", "supplier", "notes",
];

function sanitize(input: Partial<SavedInputInput>, opts: { includeCost: boolean }) {
  const out: Record<string, any> = {};
  for (const k of ALLOWED) {
    if (k === "cost_per_unit" && !opts.includeCost) continue;
    const v = (input as any)[k];
    if (v === undefined) continue;
    if (typeof v === "string") {
      const t = v.trim();
      out[k] = t === "" ? null : t;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface CreateSavedInputArgs {
  vineyard_id: string;
  user_id: string | null;
  input: SavedInputInput;
  includeCost: boolean;
}

export async function createSavedInput(args: CreateSavedInputArgs): Promise<SavedInput> {
  const now = new Date().toISOString();
  const payload = {
    ...sanitize(args.input, { includeCost: args.includeCost }),
    vineyard_id: args.vineyard_id,
    created_by: args.user_id,
    updated_by: args.user_id,
    client_updated_at: now,
    sync_version: 1,
    deleted_at: null,
  };
  const { data, error } = await supabase
    .from("saved_inputs")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as SavedInput;
}

export interface UpdateSavedInputArgs {
  id: string;
  user_id: string | null;
  input: Partial<SavedInputInput>;
  includeCost: boolean;
  current_sync_version?: number | null;
}

export async function updateSavedInput(args: UpdateSavedInputArgs): Promise<SavedInput> {
  const now = new Date().toISOString();
  const patch: Record<string, any> = {
    ...sanitize(args.input, { includeCost: args.includeCost }),
    updated_by: args.user_id,
    client_updated_at: now,
    sync_version: (args.current_sync_version ?? 0) + 1,
  };
  const { data, error } = await supabase
    .from("saved_inputs")
    .update(patch)
    .eq("id", args.id)
    .select()
    .single();
  if (error) throw error;
  return data as SavedInput;
}

export async function archiveSavedInput(
  id: string,
  userId: string | null,
  currentSyncVersion?: number | null,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("saved_inputs")
    .update({
      deleted_at: now,
      updated_by: userId,
      client_updated_at: now,
      sync_version: (currentSyncVersion ?? 0) + 1,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function restoreSavedInput(
  id: string,
  userId: string | null,
  currentSyncVersion?: number | null,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("saved_inputs")
    .update({
      deleted_at: null,
      updated_by: userId,
      client_updated_at: now,
      sync_version: (currentSyncVersion ?? 0) + 1,
    })
    .eq("id", id);
  if (error) throw error;
}
