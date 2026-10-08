// Crew / External Contractors (shared table public.vineyard_external_resources).
// Vineyard-scoped directory; no accounts, no global list. Retire by is_active=false (no DELETE).
import { supabase } from "@/integrations/ios-supabase/client";

export type ExternalResourceKind = "crew" | "contractor";
export interface ExternalResource {
  id: string;
  vineyard_id: string;
  name: string;
  kind: ExternalResourceKind;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_active: boolean;
}
export interface ResourceMember { userId: string; name: string; email?: string | null }

/** One selection in the shared resource picker. */
export type ResourceValue =
  | { kind: "none" }
  | { kind: "member"; userId: string }
  | { kind: "external"; id: string }
  | { kind: "other"; text: string };

export const canManageExternalResources = (role: string | null | undefined) =>
  role === "owner" || role === "manager";

const db = () => supabase as any;

export async function listExternalResources(vineyardId: string): Promise<ExternalResource[]> {
  const { data, error } = await db().from("vineyard_external_resources")
    .select("id,vineyard_id,name,kind,contact_name,phone,email,notes,is_active")
    .eq("vineyard_id", vineyardId).is("deleted_at", null).order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as ExternalResource[]).filter((r) => r.vineyard_id === vineyardId);
}

export type ExternalResourceInput = Pick<ExternalResource, "name" | "kind" | "contact_name" | "phone" | "email" | "notes">;

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Duplicate-name guard within one vineyard (case/space insensitive). */
export function findDuplicateName(list: ExternalResource[], name: string, excludeId?: string | null) {
  const n = norm(name);
  return list.find((r) => r.id !== excludeId && norm(r.name) === n) ?? null;
}

export function validateExternalResource(input: ExternalResourceInput): string | null {
  if (!input.name.trim()) return "Name is required.";
  if (input.name.trim().length > 120) return "Name is too long.";
  if (input.kind !== "crew" && input.kind !== "contractor") return "Choose Crew or Contractor.";
  if (input.email && !/^\S+@\S+\.\S+$/.test(input.email.trim())) return "Email looks invalid.";
  return null;
}

const clean = (i: ExternalResourceInput) => ({
  name: i.name.trim().replace(/\s+/g, " "), kind: i.kind,
  contact_name: i.contact_name?.trim() || null, phone: i.phone?.trim() || null,
  email: i.email?.trim() || null, notes: i.notes?.trim() || null,
});

export async function createExternalResource(vineyardId: string, userId: string | null, input: ExternalResourceInput) {
  const { data, error } = await db().from("vineyard_external_resources")
    .insert({ vineyard_id: vineyardId, created_by: userId, is_active: true, ...clean(input) })
    .select("id").single();
  if (error) throw new Error(error.code === "42501" ? "Only owners and managers can add crews or contractors." : error.message);
  return data as { id: string };
}

export async function updateExternalResource(id: string, vineyardId: string, patch: Partial<ExternalResourceInput> & { is_active?: boolean }) {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) Object.assign(body, clean(patch as ExternalResourceInput));
  if (patch.is_active !== undefined) body.is_active = patch.is_active;
  const { data, error } = await db().from("vineyard_external_resources")
    .update(body).eq("id", id).eq("vineyard_id", vineyardId).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Not saved — you may not have permission to change this entry.");
}

// ---------------------------------------------------------------- picker model

/** Internal members first, then ACTIVE external resources of this vineyard only. */
export function buildResourceGroups(members: ResourceMember[], externals: ExternalResource[], vineyardId: string) {
  return {
    internal: [...members].sort((a, b) => a.name.localeCompare(b.name)),
    external: externals.filter((r) => r.is_active && r.vineyard_id === vineyardId)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function resourceLabel(v: ResourceValue, memberName: (id: string) => string | null, externals: ExternalResource[]): string {
  switch (v.kind) {
    case "member": return memberName(v.userId) ?? "Unknown member";
    case "external": return externals.find((r) => r.id === v.id)?.name ?? "Unknown crew / contractor";
    case "other": return v.text.trim();
    default: return "";
  }
}

/** Work Task: write exactly one of assigned_to / assigned_external_resource_id. */
export function workTaskAssignmentFields(v: ResourceValue) {
  return {
    assigned_to: v.kind === "member" ? v.userId : null,
    assigned_external_resource_id: v.kind === "external" ? v.id : null,
  };
}

export function workTaskAssignmentValue(t: { assigned_to?: string | null; assigned_external_resource_id?: string | null } | null | undefined): ResourceValue {
  if (t?.assigned_external_resource_id) return { kind: "external", id: t.assigned_external_resource_id };
  if (t?.assigned_to) return { kind: "member", userId: t.assigned_to };
  return { kind: "none" };
}

/** Pruning: typed ids take precedence, otherwise keep historical free text. */
export function pruningResourceValue(a: { externalResourceId?: string | null; workerUserId?: string | null; worker?: string | null }): ResourceValue {
  if (a.externalResourceId) return { kind: "external", id: a.externalResourceId };
  if (a.workerUserId) return { kind: "member", userId: a.workerUserId };
  const t = (a.worker ?? "").trim();
  return t && t !== "—" ? { kind: "other", text: t } : { kind: "none" };
}

/**
 * After a successful pruning save: only when the user explicitly changed the
 * resource, call set_pruning_activity_resource. Untouched edits never clear an
 * older saved association. Failure is reported (activity itself is saved) so
 * the caller can show a warning and retry safely (the RPC is idempotent).
 */
export async function persistPruningResourceAfterSave(
  activityId: string, value: ResourceValue, touched: boolean,
  call: (id: string, v: ResourceValue) => Promise<void> = setPruningActivityResource,
): Promise<{ status: "skipped" | "ok" | "failed"; error?: string }> {
  if (!touched) return { status: "skipped" };
  try { await call(activityId, value); return { status: "ok" }; }
  catch (e: any) { return { status: "failed", error: e?.message ?? String(e) }; }
}

/** Legacy worker_or_crew snapshot text for the selected resource. */
export function pruningWorkerSnapshot(v: ResourceValue, memberName: (id: string) => string | null, externals: ExternalResource[]) {
  return resourceLabel(v, memberName, externals);
}

/** Persist typed pruning resource identity AFTER the pruning save RPC. */
export async function setPruningActivityResource(activityId: string, v: ResourceValue): Promise<void> {
  const { data, error } = await db().rpc("set_pruning_activity_resource", {
    p_activity_id: activityId,
    p_external_resource_id: v.kind === "external" ? v.id : null,
    p_worker_user_id: v.kind === "member" ? v.userId : null,
  });
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && (data as any).error) throw new Error(String((data as any).error));
}
