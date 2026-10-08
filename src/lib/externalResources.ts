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

/** Typed resource ids as currently stored on a pruning activity. */
export interface PruningResourceIds { externalResourceId: string | null; workerUserId: string | null }

export function resourceIdsOf(v: ResourceValue): PruningResourceIds {
  return {
    externalResourceId: v.kind === "external" ? v.id : null,
    workerUserId: v.kind === "member" ? v.userId : null,
  };
}

export function resourceValueFromIds(ids: PruningResourceIds, fallbackText?: string | null): ResourceValue {
  return pruningResourceValue({ ...ids, worker: fallbackText ?? null });
}

const sameIds = (a: PruningResourceIds, b: PruningResourceIds) =>
  (a.externalResourceId ?? null) === (b.externalResourceId ?? null) &&
  (a.workerUserId ?? null) === (b.workerUserId ?? null);

/** CAS precondition read from the canonical activity row. */
export interface PruningResourcePrecondition extends PruningResourceIds { clientUpdatedAt: string }

/**
 * Extract the precondition only when the canonical row explicitly carries all
 * three fields. A missing key is NOT treated as null — that could silently
 * overwrite another user's selection.
 */
export function preconditionFromCanonical(raw: unknown): PruningResourcePrecondition | null {
  const env = raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  const a = env && (env.activity ?? env.pruning_activity ?? env);
  if (!a || typeof a !== "object") return null;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(a, k);
  if (!has("client_updated_at") || !has("external_resource_id") || !has("worker_user_id")) return null;
  if (typeof a.client_updated_at !== "string" || !a.client_updated_at) return null;
  return {
    clientUpdatedAt: a.client_updated_at,
    externalResourceId: a.external_resource_id ?? null,
    workerUserId: a.worker_user_id ?? null,
  };
}

export type PruningResourcePersistResult =
  | { status: "skipped" | "ok" }
  | { status: "conflict"; current: PruningResourceIds }
  | { status: "failed"; error: string };

export interface PruningResourceDeps {
  /** Fresh authoritative read of the activity (raw canonical envelope). */
  readCanonical: (activityId: string) => Promise<unknown>;
  cas: typeof setPruningActivityResourceCas;
}

/**
 * After a successful pruning save, and only when the user explicitly changed
 * the resource: re-read the canonical row (the save RPC may have moved
 * client_updated_at), require its CURRENT ids to equal the ids the user was
 * editing against (`baseline`), then compare-and-set. Any mismatch or stale
 * CAS is a visible conflict — never an overwrite. There is no 3-arg fallback.
 */
export async function persistPruningResourceAfterSave(
  activityId: string, value: ResourceValue, touched: boolean,
  baseline: PruningResourceIds, deps: PruningResourceDeps,
): Promise<PruningResourcePersistResult> {
  if (!touched) return { status: "skipped" };
  try {
    const pre = preconditionFromCanonical(await deps.readCanonical(activityId));
    if (!pre) {
      return { status: "failed", error: "The current worker / crew link could not be verified, so it was not changed." };
    }
    const current = { externalResourceId: pre.externalResourceId, workerUserId: pre.workerUserId };
    if (!sameIds(current, baseline)) return { status: "conflict", current };
    const r = await deps.cas(activityId, value, pre);
    if (r.applied) return { status: "ok" };
    if (r.conflict) return { status: "conflict", current: r.current ?? current };
    return { status: "failed", error: "The worker / crew link was not confirmed by the server." };
  } catch (e: any) {
    return { status: "failed", error: e?.message ?? String(e) };
  }
}

/** Legacy worker_or_crew snapshot text for the selected resource. */
export function pruningWorkerSnapshot(v: ResourceValue, memberName: (id: string) => string | null, externals: ExternalResource[]) {
  return resourceLabel(v, memberName, externals);
}

/**
 * Compare-and-set typed pruning resource identity (production RPC
 * set_pruning_activity_resource_cas). Only `applied:true` counts as saved.
 */
export async function setPruningActivityResourceCas(
  activityId: string, v: ResourceValue, expected: PruningResourcePrecondition,
): Promise<{ applied: boolean; conflict: boolean; current: PruningResourceIds | null }> {
  const ids = resourceIdsOf(v);
  const { data, error } = await db().rpc("set_pruning_activity_resource_cas", {
    p_activity_id: activityId,
    p_external_resource_id: ids.externalResourceId,
    p_worker_user_id: ids.workerUserId,
    p_expected_client_updated_at: expected.clientUpdatedAt,
    p_expected_external_resource_id: expected.externalResourceId,
    p_expected_worker_user_id: expected.workerUserId,
  });
  if (error) throw new Error(error.message);
  const d = data && typeof data === "object" ? (data as Record<string, any>) : {};
  if (d.error) throw new Error(String(d.error));
  const c = d.canonical && typeof d.canonical === "object" ? d.canonical : null;
  const current = c && ("external_resource_id" in c || "worker_user_id" in c)
    ? { externalResourceId: c.external_resource_id ?? null, workerUserId: c.worker_user_id ?? null } : null;
  return { applied: d.applied === true, conflict: d.conflict === true, current };
}
