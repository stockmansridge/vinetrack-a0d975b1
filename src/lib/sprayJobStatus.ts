// Canonical spray_jobs.status values — must match the shared backend CHECK
// constraint public.spray_jobs_status_check exactly:
//   CHECK (status IN ('draft','planned','in_progress','completed','cancelled','archived'))
// Status is a planning label only; "completed" never creates or verifies a
// spray record (records are written separately).

export const SPRAY_JOB_STATUSES = [
  "draft",
  "planned",
  "in_progress",
  "completed",
  "cancelled",
  "archived",
] as const;

export type SprayJobStatus = (typeof SPRAY_JOB_STATUSES)[number];

/** Statuses a user may pick in forms/filters ('archived' uses the archive action). */
export const SELECTABLE_SPRAY_JOB_STATUSES: readonly SprayJobStatus[] = [
  "draft",
  "planned",
  "in_progress",
  "completed",
  "cancelled",
];

export const SPRAY_JOB_STATUS_LABEL: Record<SprayJobStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  archived: "Archived",
};

export const SPRAY_JOB_STATUS_ORDER: Record<SprayJobStatus, number> = {
  draft: 1, planned: 2, in_progress: 3, completed: 4, cancelled: 5, archived: 6,
};

export function isSprayJobStatus(v: unknown): v is SprayJobStatus {
  return typeof v === "string" && (SPRAY_JOB_STATUSES as readonly string[]).includes(v);
}

/**
 * UI-boundary normalisation only. Legacy 'scheduled' (previously offered by
 * the Portal, rejected by the constraint) reads as 'planned'. Never used to
 * rewrite stored rows on its own.
 */
export function normalizeSprayJobStatus(v: unknown): SprayJobStatus | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "scheduled") return "planned";
  return isSprayJobStatus(s) ? s : null;
}

/** Status sent to spray_jobs on save — always a constraint-valid value. */
export function sprayJobStatusForSave(v: unknown): SprayJobStatus {
  return normalizeSprayJobStatus(v) ?? "draft";
}

export function sprayJobStatusLabel(v: unknown): string {
  const n = normalizeSprayJobStatus(v);
  return n ? SPRAY_JOB_STATUS_LABEL[n] : v == null || v === "" ? "—" : String(v);
}
