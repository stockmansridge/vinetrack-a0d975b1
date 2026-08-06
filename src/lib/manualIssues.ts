// Manual Issues (SQL 169) — shared pin records with mode = 'ManualIssue'.
//
// Pure, testable logic: canonical enums, customer-facing labels, RPC argument
// builders, scope-change cleanup, validation, filtering and error mapping.
// Nothing here touches the network so it can be unit tested directly.

export const MANUAL_ISSUE_PIN_MODE = "ManualIssue";

export type IssueScope = "point" | "row" | "block";
export type IssueStatus = "open" | "in_progress" | "completed" | "cancelled";
export type IssuePriority = "low" | "normal" | "high" | "urgent";
export type IssueCategory =
  | "general"
  | "action_required"
  | "inspection"
  | "planning"
  | "infrastructure"
  | "vine_or_row"
  | "safety"
  | "other";

export const ISSUE_SCOPES: IssueScope[] = ["point", "row", "block"];
export const ISSUE_STATUSES: IssueStatus[] = ["open", "in_progress", "completed", "cancelled"];
export const ISSUE_PRIORITIES: IssuePriority[] = ["low", "normal", "high", "urgent"];
export const ISSUE_CATEGORIES: IssueCategory[] = [
  "general",
  "action_required",
  "inspection",
  "planning",
  "infrastructure",
  "vine_or_row",
  "safety",
  "other",
];

/** Filter default — active work only. Completed/cancelled stay reachable. */
export const ACTIVE_STATUSES: IssueStatus[] = ["open", "in_progress"];

export const ISSUE_DEFAULTS = {
  category: "general" as IssueCategory,
  priority: "normal" as IssuePriority,
  status: "open" as IssueStatus,
};

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  general: "General",
  action_required: "Action required",
  inspection: "Inspection",
  planning: "Planning",
  infrastructure: "Infrastructure",
  vine_or_row: "Vine or row issue",
  safety: "Safety",
  other: "Other",
};

export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const SCOPE_LABELS: Record<IssueScope, string> = {
  point: "Point",
  row: "Rows or sections",
  block: "Whole block",
};

export function categoryLabel(v?: string | null): string {
  return CATEGORY_LABELS[(v ?? "") as IssueCategory] ?? "General";
}
export function priorityLabel(v?: string | null): string {
  return PRIORITY_LABELS[(v ?? "") as IssuePriority] ?? "Normal";
}
export function statusLabel(v?: string | null): string {
  return STATUS_LABELS[(v ?? "") as IssueStatus] ?? "Open";
}
export function scopeLabel(v?: string | null): string {
  return SCOPE_LABELS[(v ?? "") as IssueScope] ?? "Point";
}

// ---------------------------------------------------------------- segments

export interface RowSegment {
  row: number;
  segment: number;
}

/** Canonical row sections supported by SQL 169. */
export const ROW_SEGMENTS = [1, 2, 3, 4];

/** Parse "5, 7-9" into [5,7,8,9]. Ignores junk, dedupes, sorts. */
export function parseRowSelection(input: string): number[] {
  const out = new Set<number>();
  for (const part of String(input ?? "").split(/[,\s]+/)) {
    if (!part) continue;
    const range = part.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        for (let i = Math.ceil(lo); i <= Math.floor(hi); i++) out.add(i);
      }
      continue;
    }
    const n = Number(part);
    if (Number.isFinite(n)) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Build the canonical segment payload: one entry per row × selected section. */
export function buildSegments(rows: number[], segments: number[]): RowSegment[] {
  const secs = segments.length ? [...segments].sort((a, b) => a - b) : ROW_SEGMENTS;
  const out: RowSegment[] = [];
  for (const row of rows) {
    for (const segment of secs) out.push({ row, segment });
  }
  return out;
}

/** "Rows 5–7 (all sections)" / "Row 5 (sections 1, 2)" for display. */
export function summariseSegments(segments: RowSegment[] | null | undefined): string | null {
  if (!segments || !segments.length) return null;
  const byRow = new Map<number, number[]>();
  for (const s of segments) {
    const list = byRow.get(s.row) ?? [];
    list.push(s.segment);
    byRow.set(s.row, list);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const allFull = rows.every((r) => (byRow.get(r) ?? []).length >= ROW_SEGMENTS.length);
  const rowText = rows.length === 1 ? `Row ${rows[0]}` : `Rows ${compactRanges(rows)}`;
  if (allFull) return `${rowText} (all sections)`;
  if (rows.length === 1) {
    return `${rowText} (sections ${[...new Set(byRow.get(rows[0]) ?? [])].sort().join(", ")})`;
  }
  return `${rowText} (part rows)`;
}

function compactRanges(nums: number[]): string {
  const parts: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return parts.join(", ");
}

// ------------------------------------------------------------------ record

export interface ManualIssue {
  id: string;
  vineyard_id: string;
  paddock_id: string | null;
  title: string;
  description: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  location_scope: string | null;

  latitude: number | null;
  longitude: number | null;
  original_latitude: number | null;
  original_longitude: number | null;
  snapped_latitude: number | null;
  snapped_longitude: number | null;

  driving_row_number: number | null;
  pin_row_number: number | null;
  pin_side: string | null;
  along_row_distance_m: number | null;
  snapped_to_row: boolean | null;

  assigned_user_id: string | null;
  due_date: string | null;
  linked_work_task_id: string | null;
  photo_path: string | null;

  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  client_updated_at: string | null;
  deleted_at: string | null;

  completed_at: string | null;
  completed_by: string | null;
  completed_by_user_id: string | null;

  segments: RowSegment[] | null;
}

/** Customer-facing row wording, e.g. "On row 19.5". Never raw field names. */
export function locationSummary(issue: Partial<ManualIssue>): string {
  const scope = (issue.location_scope ?? "point") as IssueScope;
  if (scope === "row") return summariseSegments(issue.segments ?? null) ?? "Rows selected";
  if (scope === "block") return "Whole block";
  const driving = issue.driving_row_number;
  if (driving != null && Number.isFinite(Number(driving))) return `On row ${driving}`;
  const pinRow = issue.pin_row_number;
  if (pinRow != null && Number.isFinite(Number(pinRow))) return `Attached to row ${pinRow}`;
  if (issue.latitude != null && issue.longitude != null) {
    return `${Number(issue.latitude).toFixed(5)}, ${Number(issue.longitude).toFixed(5)}`;
  }
  return "—";
}

// -------------------------------------------------------------- form state

export interface IssueFormState {
  id?: string;
  title: string;
  description: string;
  category: IssueCategory;
  priority: IssuePriority;
  locationScope: IssueScope;
  paddockId: string | null;
  assignedUserId: string | null;
  dueDate: string | null;
  // point-only
  latitude: number | null;
  longitude: number | null;
  snappedLatitude: number | null;
  snappedLongitude: number | null;
  drivingRowNumber: number | null;
  pinRowNumber: number | null;
  pinSide: string | null;
  alongRowDistanceM: number | null;
  snappedToRow: boolean | null;
  // row-only
  rowSelection: string;
  rowSections: number[];
}

export function emptyIssueForm(): IssueFormState {
  return {
    title: "",
    description: "",
    category: ISSUE_DEFAULTS.category,
    priority: ISSUE_DEFAULTS.priority,
    locationScope: "point",
    paddockId: null,
    assignedUserId: null,
    dueDate: null,
    latitude: null,
    longitude: null,
    snappedLatitude: null,
    snappedLongitude: null,
    drivingRowNumber: null,
    pinRowNumber: null,
    pinSide: null,
    alongRowDistanceM: null,
    snappedToRow: null,
    rowSelection: "",
    rowSections: [...ROW_SEGMENTS],
  };
}

export function formFromIssue(issue: ManualIssue): IssueFormState {
  const segs = issue.segments ?? [];
  const rows = [...new Set(segs.map((s) => s.row))].sort((a, b) => a - b);
  const sections = [...new Set(segs.map((s) => s.segment))].sort((a, b) => a - b);
  return {
    ...emptyIssueForm(),
    id: issue.id,
    title: issue.title ?? "",
    description: issue.description ?? "",
    category: (issue.category as IssueCategory) ?? ISSUE_DEFAULTS.category,
    priority: (issue.priority as IssuePriority) ?? ISSUE_DEFAULTS.priority,
    locationScope: (issue.location_scope as IssueScope) ?? "point",
    paddockId: issue.paddock_id,
    assignedUserId: issue.assigned_user_id,
    dueDate: issue.due_date,
    latitude: issue.latitude,
    longitude: issue.longitude,
    snappedLatitude: issue.snapped_latitude,
    snappedLongitude: issue.snapped_longitude,
    drivingRowNumber: issue.driving_row_number,
    pinRowNumber: issue.pin_row_number,
    pinSide: issue.pin_side,
    alongRowDistanceM: issue.along_row_distance_m,
    snappedToRow: issue.snapped_to_row,
    rowSelection: rows.join(", "),
    rowSections: sections.length ? sections : [...ROW_SEGMENTS],
  };
}

/**
 * Clear obsolete local state when the location scope changes so the form never
 * displays stale values. The backend clears the stored data atomically.
 */
export function applyScopeChange(form: IssueFormState, next: IssueScope): IssueFormState {
  if (form.locationScope === next) return form;
  const base: IssueFormState = { ...form, locationScope: next };
  if (next !== "point") {
    base.latitude = null;
    base.longitude = null;
    base.snappedLatitude = null;
    base.snappedLongitude = null;
    base.drivingRowNumber = null;
    base.pinRowNumber = null;
    base.pinSide = null;
    base.alongRowDistanceM = null;
    base.snappedToRow = null;
  }
  if (next !== "row") {
    base.rowSelection = "";
    base.rowSections = [...ROW_SEGMENTS];
  }
  return base;
}

export function validateIssueForm(form: IssueFormState): string | null {
  if (!form.title.trim()) return "Title is required.";
  if (!ISSUE_SCOPES.includes(form.locationScope)) return "Choose a valid location type.";
  if (form.locationScope === "point") {
    if (form.latitude == null || form.longitude == null) {
      return "Choose a location on the map for this issue.";
    }
  }
  if (form.locationScope === "block" && !form.paddockId) return "Choose a block for this issue.";
  if (form.locationScope === "row") {
    if (!form.paddockId) return "Choose a block for this issue.";
    if (!parseRowSelection(form.rowSelection).length) return "Select at least one row.";
    if (!form.rowSections.length) return "Select at least one row section.";
  }
  return null;
}

// ----------------------------------------------------------- RPC arguments

export interface CreateIssueArgs {
  p_id: string;
  p_vineyard_id: string;
  p_title: string;
  p_location_scope: IssueScope;
  p_client_updated_at: string;
  p_description: string | null;
  p_category: IssueCategory;
  p_priority: IssuePriority;
  p_paddock_id: string | null;
  p_assigned_user_id: string | null;
  p_due_date: string | null;
  p_latitude: number | null;
  p_longitude: number | null;
  p_snapped_latitude: number | null;
  p_snapped_longitude: number | null;
  p_driving_row_number: number | null;
  p_pin_row_number: number | null;
  p_pin_side: string | null;
  p_along_row_distance_m: number | null;
  p_snapped_to_row: boolean | null;
  p_segments: RowSegment[] | null;
}

export type UpdateIssueArgs = Omit<CreateIssueArgs, "p_vineyard_id">;

function sharedArgs(form: IssueFormState) {
  const isPoint = form.locationScope === "point";
  const isRow = form.locationScope === "row";
  return {
    p_title: form.title.trim(),
    p_location_scope: form.locationScope,
    p_description: form.description.trim() || null,
    p_category: form.category,
    p_priority: form.priority,
    p_paddock_id: form.paddockId,
    p_assigned_user_id: form.assignedUserId,
    p_due_date: form.dueDate || null,
    p_latitude: isPoint ? form.latitude : null,
    p_longitude: isPoint ? form.longitude : null,
    p_snapped_latitude: isPoint ? form.snappedLatitude : null,
    p_snapped_longitude: isPoint ? form.snappedLongitude : null,
    p_driving_row_number: isPoint ? form.drivingRowNumber : null,
    p_pin_row_number: isPoint ? form.pinRowNumber : null,
    p_pin_side: isPoint ? form.pinSide : null,
    p_along_row_distance_m: isPoint ? form.alongRowDistanceM : null,
    p_snapped_to_row: isPoint ? form.snappedToRow : null,
    p_segments: isRow ? buildSegments(parseRowSelection(form.rowSelection), form.rowSections) : null,
  };
}

export function buildCreateArgs(
  form: IssueFormState,
  opts: { vineyardId: string; id: string; clientUpdatedAt?: string },
): CreateIssueArgs {
  return {
    p_id: opts.id,
    p_vineyard_id: opts.vineyardId,
    p_client_updated_at: opts.clientUpdatedAt ?? new Date().toISOString(),
    ...sharedArgs(form),
  } as CreateIssueArgs;
}

export function buildUpdateArgs(
  form: IssueFormState,
  opts: { id: string; clientUpdatedAt?: string },
): UpdateIssueArgs {
  return {
    p_id: opts.id,
    p_client_updated_at: opts.clientUpdatedAt ?? new Date().toISOString(),
    ...sharedArgs(form),
  } as UpdateIssueArgs;
}

// -------------------------------------------------------------- error copy

const ERROR_COPY: Record<string, string> = {
  PERMISSION_DENIED: "You don't have permission to do that for this vineyard.",
  AUTH_REQUIRED: "Please sign in again to continue.",
  TITLE_REQUIRED: "Add a title for this issue.",
  INVALID_CATEGORY: "Choose a valid category.",
  INVALID_PRIORITY: "Choose a valid priority.",
  INVALID_STATUS: "Choose a valid status.",
  INVALID_LOCATION_SCOPE: "Choose a valid location type.",
  INVALID_SCOPE: "Choose a valid location type.",
  POINT_REQUIRED: "Choose a location on the map for this issue.",
  COORDINATES_REQUIRED: "Choose a location on the map for this issue.",
  BLOCK_REQUIRED: "Choose a block for this issue.",
  PADDOCK_REQUIRED: "Choose a block for this issue.",
  SEGMENTS_REQUIRED: "Select at least one row or row section.",
  ASSIGNEE_NOT_IN_VINEYARD: "That person isn't an active member of this vineyard.",
  INVALID_ASSIGNEE: "That person isn't an active member of this vineyard.",
  NOT_FOUND: "This issue no longer exists.",
  CONFLICT: "This issue was changed on another device. Refresh it and try again.",
  STALE_UPDATE: "This issue was changed on another device. Refresh it and try again.",
};

/** Map SQL 169 prefix-coded errors to safe copy. Never surface raw SQL. */
export function manualIssueErrorMessage(err: unknown): string {
  const raw = String((err as any)?.message ?? err ?? "").trim();
  const code = raw.split(":")[0]?.trim().toUpperCase();
  if (code && ERROR_COPY[code]) return ERROR_COPY[code];
  for (const key of Object.keys(ERROR_COPY)) {
    if (raw.toUpperCase().includes(key)) return ERROR_COPY[key];
  }
  if (/row-level security|permission denied|42501/i.test(raw)) return ERROR_COPY.PERMISSION_DENIED;
  return "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------- filtering

export interface IssueFilters {
  search?: string;
  statuses?: IssueStatus[];
  paddockId?: string | null;
  priority?: IssuePriority | null;
  category?: IssueCategory | null;
  assignedUserId?: string | null;
  scope?: IssueScope | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  dueFrom?: string | null;
  dueTo?: string | null;
  overdueOnly?: boolean;
}

export function isOverdue(issue: ManualIssue, now: Date = new Date()): boolean {
  if (!issue.due_date) return false;
  if (issue.status === "completed" || issue.status === "cancelled") return false;
  return new Date(issue.due_date).getTime() < now.getTime();
}

export function filterIssues(
  issues: ManualIssue[],
  filters: IssueFilters,
  now: Date = new Date(),
): ManualIssue[] {
  const q = (filters.search ?? "").trim().toLowerCase();
  return issues.filter((i) => {
    if (i.deleted_at) return false; // soft-deleted never appear
    if (filters.statuses?.length && !filters.statuses.includes((i.status ?? "open") as IssueStatus)) {
      return false;
    }
    if (filters.paddockId && i.paddock_id !== filters.paddockId) return false;
    if (filters.priority && i.priority !== filters.priority) return false;
    if (filters.category && i.category !== filters.category) return false;
    if (filters.assignedUserId && i.assigned_user_id !== filters.assignedUserId) return false;
    if (filters.scope && i.location_scope !== filters.scope) return false;
    if (filters.createdFrom && (i.created_at ?? "") < filters.createdFrom) return false;
    if (filters.createdTo && (i.created_at ?? "") > `${filters.createdTo}T23:59:59Z`) return false;
    if (filters.dueFrom && (!i.due_date || i.due_date < filters.dueFrom)) return false;
    if (filters.dueTo && (!i.due_date || i.due_date > filters.dueTo)) return false;
    if (filters.overdueOnly && !isOverdue(i, now)) return false;
    if (q) {
      const hay = [i.title, i.description, categoryLabel(i.category), priorityLabel(i.priority)]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ");
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function countByStatus(issues: ManualIssue[]): Record<IssueStatus, number> {
  const out: Record<IssueStatus, number> = {
    open: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const i of issues) {
    if (i.deleted_at) continue;
    const s = (i.status ?? "open") as IssueStatus;
    if (s in out) out[s] += 1;
  }
  return out;
}

// ------------------------------------------------------------ map identity

/** Amber identity, muted once closed — matches iOS and Android. */
export const MANUAL_ISSUE_COLOUR = "#FF9500";
export const MANUAL_ISSUE_COLOUR_MUTED = "#C89A5B";

export function manualIssueMarkerColour(status?: string | null): string {
  const s = (status ?? "open").toLowerCase();
  return s === "completed" || s === "cancelled" ? MANUAL_ISSUE_COLOUR_MUTED : MANUAL_ISSUE_COLOUR;
}

export function isManualIssuePin(pin: { mode?: string | null } | null | undefined): boolean {
  return String(pin?.mode ?? "").toLowerCase() === MANUAL_ISSUE_PIN_MODE.toLowerCase();
}
