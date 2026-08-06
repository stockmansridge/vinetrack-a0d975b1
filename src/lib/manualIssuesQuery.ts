// Manual Issues data layer — SQL 169 RPCs on the shared VineTrack backend.
// All reads/writes go through the shared pin contract used by iOS and Android.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import {
  ACTIVE_STATUSES,
  buildCreateArgs,
  buildUpdateArgs,
  manualIssueErrorMessage,
  type IssueFormState,
  type IssueStatus,
  type ManualIssue,
  type RowSegment,
} from "@/lib/manualIssues";

function normaliseSegments(raw: any): RowSegment[] | null {
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? safeParse(raw) : null;
  if (!Array.isArray(arr)) return null;
  const out = arr
    .map((s: any) => ({
      row: Number(s?.row ?? s?.row_number ?? s?.pin_row_number),
      segment: Number(s?.segment ?? s?.segment_number ?? s?.section ?? 1),
    }))
    .filter((s) => Number.isFinite(s.row) && Number.isFinite(s.segment));
  return out.length ? out : null;
}

function safeParse(v: string): any {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function num(v: any): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normaliseIssue(raw: any): ManualIssue {
  return {
    id: raw.id,
    vineyard_id: raw.vineyard_id,
    paddock_id: raw.paddock_id ?? null,
    title: raw.title ?? "",
    description: raw.description ?? raw.notes ?? null,
    category: raw.category ?? null,
    priority: raw.priority ?? null,
    status: raw.status ?? (raw.is_completed ? "completed" : "open"),
    location_scope: raw.location_scope ?? null,
    latitude: num(raw.latitude),
    longitude: num(raw.longitude),
    original_latitude: num(raw.original_latitude),
    original_longitude: num(raw.original_longitude),
    snapped_latitude: num(raw.snapped_latitude),
    snapped_longitude: num(raw.snapped_longitude),
    driving_row_number: num(raw.driving_row_number),
    pin_row_number: num(raw.pin_row_number),
    pin_side: raw.pin_side ?? null,
    along_row_distance_m: num(raw.along_row_distance_m),
    snapped_to_row: raw.snapped_to_row ?? null,
    assigned_user_id: raw.assigned_user_id ?? null,
    due_date: raw.due_date ?? null,
    linked_work_task_id: raw.linked_work_task_id ?? null,
    photo_path: raw.photo_path ?? null,
    created_by: raw.created_by ?? raw.created_by_user_id ?? null,
    created_at: raw.created_at ?? null,
    updated_at: raw.updated_at ?? null,
    client_updated_at: raw.client_updated_at ?? null,
    deleted_at: raw.deleted_at ?? null,
    completed_at: raw.completed_at ?? null,
    completed_by: raw.completed_by ?? null,
    completed_by_user_id: raw.completed_by_user_id ?? null,
    segments: normaliseSegments(raw.segments ?? raw.row_segments ?? raw.pin_row_segments),
  };
}

async function rpc<T>(fn: string, args: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as any, args);
  if (error) throw new Error(manualIssueErrorMessage(error));
  return data as T;
}

export function manualIssuesKey(vineyardId: string | null, statuses?: IssueStatus[]) {
  return ["manual-issues", vineyardId, (statuses ?? []).join(",")] as const;
}

export function useManualIssues(
  vineyardId: string | null,
  opts: { statuses?: IssueStatus[]; paddockId?: string | null } = {},
) {
  const statuses = opts.statuses ?? [...ACTIVE_STATUSES, "completed", "cancelled"];
  return useQuery({
    queryKey: [...manualIssuesKey(vineyardId, statuses as IssueStatus[]), opts.paddockId ?? null],
    enabled: !!vineyardId,
    queryFn: async (): Promise<ManualIssue[]> => {
      const rows = await rpc<any[]>("list_manual_issues", {
        p_vineyard_id: vineyardId,
        p_paddock_id: opts.paddockId ?? null,
        p_statuses: statuses,
        p_include_deleted: false,
      });
      return (rows ?? []).map(normaliseIssue);
    },
  });
}

export function useManualIssue(id: string | null) {
  return useQuery({
    queryKey: ["manual-issue", id],
    enabled: !!id,
    queryFn: async (): Promise<ManualIssue | null> => {
      const data = await rpc<any>("get_manual_issue", { p_id: id });
      const row = Array.isArray(data) ? data[0] : data;
      return row ? normaliseIssue(row) : null;
    },
  });
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useSaveManualIssue(vineyardId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: IssueFormState) => {
      if (form.id) {
        return rpc("update_manual_issue", buildUpdateArgs(form, { id: form.id }));
      }
      if (!vineyardId) throw new Error("Select a vineyard first.");
      return rpc("create_manual_issue", buildCreateArgs(form, { vineyardId, id: newId() }));
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useSetManualIssueStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: IssueStatus }) =>
      rpc("set_manual_issue_status", {
        p_id: id,
        p_status: status,
        p_client_updated_at: new Date().toISOString(),
      }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteOrCancelManualIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "delete" | "cancel" }) =>
      rpc("delete_or_cancel_manual_issue", {
        p_id: id,
        p_action: action,
        p_client_updated_at: new Date().toISOString(),
      }),
    onSuccess: () => invalidate(qc),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["manual-issues"] });
  qc.invalidateQueries({ queryKey: ["manual-issue"] });
  qc.invalidateQueries({ queryKey: ["pins"] });
}
