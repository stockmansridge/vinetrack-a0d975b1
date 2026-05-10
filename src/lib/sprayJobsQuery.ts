// Query + mutation helpers for spray_jobs / spray_job_paddocks.
// Backed by the iOS Supabase project. RLS + DB triggers are the authority;
// the client filters by vineyard_id for safety.
import { supabase } from "@/integrations/ios-supabase/client";
import { toIOSChemicalLineCompat, displayUnitText } from "@/lib/rateBasis";

export interface SprayJobChemicalLine {
  chemical_id?: string | null;
  name?: string | null;
  active_ingredient?: string | null;
  rate?: number | null;
  /**
   * Composed unit text. Internally we may use "L/ha" / "mL/100L" while
   * editing; on save we normalise to the iOS raw enum ("Litres" / "mL" /
   * "Kg" / "g") plus the matching legacy `ratePerHa` / `ratePer100L`
   * numerics so iOS spray-template loading keeps working.
   */
  unit?: string | null;
  /** "liquid" → L/mL · "solid" → kg/g */
  product_type?: "liquid" | "solid" | null;
  /**
   * Explicit application basis for this line. Internal callers may write
   * either the short ("per_100L") or the iOS-compatible long form
   * ("per_100_litres"); persistence always uses the long form.
   */
  rate_basis?: "per_hectare" | "per_100L" | "per_100_litres" | null;
  /** iOS legacy numeric fields. Filled automatically on save. */
  ratePerHa?: number | null;
  ratePer100L?: number | null;
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

/**
 * Normalise a chemical_lines array so the persisted JSON carries the
 * legacy fields iOS expects (`unit` as raw enum, `ratePerHa`, `ratePer100L`,
 * `rate_basis = per_hectare | per_100_litres`) alongside our newer
 * structured fields.
 */
export function normaliseChemicalLinesForIOS(
  lines?: SprayJobChemicalLine[] | null,
): SprayJobChemicalLine[] | null | undefined {
  if (lines == null) return lines;
  return lines.map((l) => {
    const compat = toIOSChemicalLineCompat({
      unit: l.unit,
      product_type: l.product_type ?? null,
      rate_basis: l.rate_basis ?? null,
      rate: l.rate ?? null,
      ratePerHa: l.ratePerHa ?? null,
      ratePer100L: l.ratePer100L ?? null,
    });
    return {
      ...l,
      unit: compat.unit,
      rate_basis: compat.rate_basis,
      ratePerHa: compat.ratePerHa,
      ratePer100L: compat.ratePer100L,
    } as SprayJobChemicalLine;
  });
}

function withNormalisedLines<T extends { chemical_lines?: SprayJobChemicalLine[] | null }>(input: T): T {
  if (!("chemical_lines" in input) || input.chemical_lines == null) return input;
  return { ...input, chemical_lines: normaliseChemicalLinesForIOS(input.chemical_lines) ?? null };
}

export async function createSprayJob(input: SprayJobInput, paddockIds: string[]): Promise<SprayJob> {
  const payload = withNormalisedLines(input);
  const { data, error } = await supabase.from("spray_jobs").insert(payload).select("*").single();
  if (error) throw error;
  const job = data as SprayJob;
  if (paddockIds.length) {
    await replaceSprayJobPaddocks(job.id, paddockIds);
  }
  return job;
}

export async function updateSprayJob(id: string, patch: Partial<SprayJobInput>, paddockIds?: string[]): Promise<SprayJob> {
  const payload = withNormalisedLines(patch);
  const { data, error } = await supabase.from("spray_jobs").update(payload).eq("id", id).select("*").single();
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

// ---------------- Linked spray records ----------------
//
// `spray_records.spray_job_id` (uuid, nullable) connects a completed spray
// record back to its planned job. We update only that column from the client.

export interface LinkedSprayRecord {
  id: string;
  vineyard_id: string;
  spray_job_id?: string | null;
  trip_id?: string | null;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  spray_reference?: string | null;
  operation_type?: string | null;
  tractor?: string | null;
  equipment_type?: string | null;
  notes?: string | null;
  tanks?: any;
  is_template?: boolean | null;
}

export async function fetchLinkedSprayRecords(jobId: string): Promise<LinkedSprayRecord[]> {
  const { data, error } = await supabase
    .from("spray_records")
    .select("*")
    .eq("spray_job_id", jobId)
    .is("deleted_at", null)
    .order("date", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as LinkedSprayRecord[]).filter((r) => !r.is_template);
}

export async function fetchUnlinkedSprayRecords(vineyardId: string): Promise<LinkedSprayRecord[]> {
  const { data, error } = await supabase
    .from("spray_records")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("spray_job_id", null)
    .is("deleted_at", null)
    .order("date", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as LinkedSprayRecord[]).filter((r) => !r.is_template);
}

export async function linkSprayRecord(recordId: string, jobId: string): Promise<void> {
  const { error } = await supabase
    .from("spray_records")
    .update({ spray_job_id: jobId })
    .eq("id", recordId);
  if (error) throw error;
}

export async function unlinkSprayRecord(recordId: string): Promise<void> {
  const { error } = await supabase
    .from("spray_records")
    .update({ spray_job_id: null })
    .eq("id", recordId);
  if (error) throw error;
}

/** Sum of tank volumes across `tanks` jsonb (best-effort). */
export function recordTotalWaterLitres(rec: LinkedSprayRecord): number | null {
  const t = rec.tanks;
  if (!t) return null;
  const arr = Array.isArray(t) ? t : Array.isArray((t as any).tanks) ? (t as any).tanks : null;
  if (!arr) return null;
  let sum = 0;
  let any = false;
  for (const x of arr) {
    const v = Number(x?.volume ?? x?.water_volume ?? x?.litres);
    if (Number.isFinite(v) && v > 0) { sum += v; any = true; }
  }
  return any ? Math.round(sum) : null;
}

/** Flatten chemical names from a record's tanks jsonb. */
export function recordChemicalNames(rec: LinkedSprayRecord): string[] {
  const t = rec.tanks;
  if (!t) return [];
  const arr = Array.isArray(t) ? t : Array.isArray((t as any).tanks) ? (t as any).tanks : null;
  if (!arr) return [];
  const names = new Set<string>();
  for (const tk of arr) {
    const chems = Array.isArray(tk?.chemicals) ? tk.chemicals : Array.isArray(tk?.lines) ? tk.lines : [];
    for (const c of chems) {
      const n = (c?.name ?? c?.chemical_name ?? "").toString().trim();
      if (n) names.add(n);
    }
  }
  return Array.from(names);
}

export interface PlannedActualDiff {
  ok: boolean;
  notes: string[];
}

export function comparePlannedVsActual(
  job: SprayJob,
  rec: LinkedSprayRecord,
): PlannedActualDiff {
  const notes: string[] = [];
  const plannedOp = (job.operation_type ?? "").toLowerCase().trim();
  const actualOp = (rec.operation_type ?? "").toLowerCase().trim();
  if (plannedOp && actualOp && plannedOp !== actualOp) {
    notes.push(`Operation differs: planned ${job.operation_type} vs actual ${rec.operation_type}`);
  }
  const plannedChems = (job.chemical_lines ?? [])
    .map((l) => (l.name ?? "").trim().toLowerCase())
    .filter(Boolean);
  const actualChems = recordChemicalNames(rec).map((n) => n.toLowerCase());
  const missing = plannedChems.filter((c) => !actualChems.some((a) => a.includes(c) || c.includes(a)));
  const extra = actualChems.filter((c) => !plannedChems.some((a) => a.includes(c) || c.includes(a)));
  if (missing.length) notes.push(`Missing chemicals: ${missing.join(", ")}`);
  if (extra.length) notes.push(`Additional chemicals: ${extra.join(", ")}`);
  const plannedWater = job.water_volume ?? null;
  const actualWater = recordTotalWaterLitres(rec);
  if (plannedWater != null && actualWater != null) {
    const pct = Math.abs(actualWater - plannedWater) / Math.max(plannedWater, 1);
    if (pct > 0.15) {
      notes.push(`Water volume off by >15% (planned ${plannedWater} L, actual ${actualWater} L)`);
    }
  }
  return { ok: notes.length === 0, notes };
}

export function chemicalLinesSummary(lines?: SprayJobChemicalLine[] | null): string {
  if (!lines || !lines.length) return "—";
  return lines
    .map((l) => {
      const name = l.name ?? "Unnamed";
      const unitText = displayUnitText(l.unit);
      const rate = l.rate != null ? `${l.rate}${unitText ? ` ${unitText}` : ""}` : "";
      return rate ? `${name} (${rate})` : name;
    })
    .join(", ");
}
