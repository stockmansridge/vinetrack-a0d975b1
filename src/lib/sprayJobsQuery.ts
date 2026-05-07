// Query + mutation helpers for spray_jobs / spray_job_paddocks.
// Backed by the iOS Supabase project. RLS + DB triggers are the authority;
// the client filters by vineyard_id for safety.
import { supabase } from "@/integrations/ios-supabase/client";

export interface SprayJobChemicalLine {
  chemical_id?: string | null;
  name?: string | null;
  active_ingredient?: string | null;
  rate?: number | null;
  unit?: string | null;
  water_rate?: number | null;
  notes?: string | null;
}

export interface SprayJob {
  id: string;
  vineyard_id: string;
  name?: string | null;
  is_template?: boolean | null;
  planned_date?: string | null;
  status?: string | null;
  operation_type?: string | null;
  target?: string | null;
  chemical_lines?: SprayJobChemicalLine[] | null;
  water_volume?: number | null;
  spray_rate_per_ha?: number | null;
  equipment_id?: string | null;
  tractor_id?: string | null;
  operator_user_id?: string | null;
  notes?: string | null;
  growth_stage_code?: string | null;
  vsp_canopy_size?: string | null;
  vsp_canopy_density?: string | null;
  row_spacing_metres?: number | null;
  concentration_factor?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
}

export interface SprayJobPaddock {
  spray_job_id: string;
  paddock_id: string;
}

export async function fetchSprayJobs(vineyardId: string, opts: {
  template?: boolean;
  archived?: boolean;
}): Promise<SprayJob[]> {
  let q = supabase.from("spray_jobs").select("*").eq("vineyard_id", vineyardId);
  if (opts.archived) {
    q = q.not("deleted_at", "is", null);
  } else {
    q = q.is("deleted_at", null);
  }
  if (opts.template !== undefined && !opts.archived) {
    q = q.eq("is_template", opts.template);
  }
  const { data, error } = await q.order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SprayJob[];
}

export async function fetchSprayJob(id: string): Promise<SprayJob | null> {
  const { data, error } = await supabase.from("spray_jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as SprayJob | null;
}

export async function fetchSprayJobPaddockIds(jobId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("spray_job_paddocks")
    .select("paddock_id")
    .eq("spray_job_id", jobId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.paddock_id as string);
}

export interface SprayJobInput {
  vineyard_id: string;
  name?: string | null;
  is_template: boolean;
  planned_date?: string | null;
  status?: string | null;
  operation_type?: string | null;
  target?: string | null;
  chemical_lines?: SprayJobChemicalLine[] | null;
  water_volume?: number | null;
  spray_rate_per_ha?: number | null;
  equipment_id?: string | null;
  tractor_id?: string | null;
  operator_user_id?: string | null;
  notes?: string | null;
  growth_stage_code?: string | null;
  vsp_canopy_size?: string | null;
  vsp_canopy_density?: string | null;
  row_spacing_metres?: number | null;
  concentration_factor?: number | null;
}

export async function createSprayJob(input: SprayJobInput, paddockIds: string[]): Promise<SprayJob> {
  const { data, error } = await supabase.from("spray_jobs").insert(input).select("*").single();
  if (error) throw error;
  const job = data as SprayJob;
  if (paddockIds.length) {
    await replaceSprayJobPaddocks(job.id, paddockIds);
  }
  return job;
}

export async function updateSprayJob(id: string, patch: Partial<SprayJobInput>, paddockIds?: string[]): Promise<SprayJob> {
  const { data, error } = await supabase.from("spray_jobs").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  if (paddockIds) {
    await replaceSprayJobPaddocks(id, paddockIds);
  }
  return data as SprayJob;
}

export async function replaceSprayJobPaddocks(jobId: string, paddockIds: string[]) {
  const { error: delErr } = await supabase.from("spray_job_paddocks").delete().eq("spray_job_id", jobId);
  if (delErr) throw delErr;
  if (!paddockIds.length) return;
  const rows = paddockIds.map((pid) => ({ spray_job_id: jobId, paddock_id: pid }));
  const { error } = await supabase.from("spray_job_paddocks").insert(rows);
  if (error) throw error;
}

export async function archiveSprayJob(id: string): Promise<void> {
  const { error } = await supabase.rpc("archive_spray_job", { p_id: id });
  if (error) throw error;
}

export async function restoreSprayJob(id: string): Promise<void> {
  const { error } = await supabase.rpc("restore_spray_job", { p_id: id });
  if (error) throw error;
}

export async function duplicateSprayJob(id: string, asTemplate: boolean): Promise<string> {
  const { data, error } = await supabase.rpc("duplicate_spray_job", { p_id: id, p_as_template: asTemplate });
  if (error) throw error;
  // RPC may return either the new id or a row; try to extract.
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const r: any = Array.isArray(data) ? data[0] : data;
    return r?.id ?? r?.new_id ?? "";
  }
  return "";
}

export interface VineyardTeamMember {
  membership_id: string;
  vineyard_id: string;
  user_id: string;
  role: string;
  joined_at: string | null;
  display_name: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export async function fetchVineyardTeamMembers(vineyardId: string): Promise<VineyardTeamMember[]> {
  const { data, error } = await supabase.rpc("get_vineyard_team_members", {
    p_vineyard_id: vineyardId,
  });
  if (error) {
    if ((error as any).code === "42501" || (error as any).code === "PGRST202") return [];
    throw error;
  }
  return (data ?? []) as VineyardTeamMember[];
}

export function memberLabel(m: VineyardTeamMember): string {
  return (
    (m.display_name && m.display_name.trim()) ||
    (m.full_name && m.full_name.trim()) ||
    (m.email && m.email.trim()) ||
    m.user_id.slice(0, 8)
  );
}

export function chemicalLinesSummary(lines?: SprayJobChemicalLine[] | null): string {
  if (!lines || !lines.length) return "—";
  return lines
    .map((l) => {
      const name = l.name ?? "Unnamed";
      const rate = l.rate != null ? `${l.rate}${l.unit ? ` ${l.unit}` : ""}` : "";
      return rate ? `${name} (${rate})` : name;
    })
    .join(", ");
}
