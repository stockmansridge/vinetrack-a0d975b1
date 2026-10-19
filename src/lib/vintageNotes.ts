// Vintage Notes — shared vineyard-wide notes.
//
// Portal scope (first pass): browse history and ADD notes. No Portal edit,
// delete or note-type administration — those stay with mobile / backend.
//
// Contract (shared with iOS/Android, owned by Rork):
//   vintage_notes       — note_date drives vintage_year via a server trigger;
//                         the Portal NEVER sends vintage_year and trusts the
//                         persisted value returned after insert.
//   vintage_note_types  — global seeded types have vineyard_id NULL; vineyard
//                         types carry the vineyard id. Retired (is_active =
//                         false) types are display-only for historic notes.
//
// A note is valid when EITHER a type OR non-blank text is present; only a
// note with neither is rejected.
//
// Backend gate: policies use public.can_use_vineyard_insights(), which
// currently requires System Admin + membership. Until the approved RLS change
// lands, ordinary members get a permission error — surfaced honestly, and the
// Add form keeps its contents so nothing typed is lost.
import { supabase } from "@/integrations/ios-supabase/client";
import { generateUuid } from "@/lib/uuid";
import { isPermissionError } from "@/lib/scoutReports";
import type { VintageScope } from "@/lib/vintageScope";
import { isWithinVintage } from "@/lib/vintageScope";

export { isPermissionError };

export interface VintageNote {
  id: string;
  vineyard_id: string;
  note_date: string;
  vintage_year: number | null;
  note_type_id: string | null;
  /** Historical snapshot of the type label — shown verbatim. */
  note_type_label: string | null;
  notes: string | null;
  observed_by_user_id: string | null;
  observer_name_snapshot: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface VintageNoteType {
  id: string;
  /** NULL for global seeded types. */
  vineyard_id: string | null;
  code: string;
  group_code: string;
  label: string;
  sort_order: number;
  is_system: boolean;
  is_active: boolean;
  deleted_at: string | null;
}

/** Canonical display order for note-type groups. */
export const NOTE_TYPE_GROUP_ORDER = [
  "weather",
  "phenology",
  "disease",
  "activity",
  "other",
] as const;

export function noteTypeGroupLabel(groupCode: string): string {
  switch (groupCode) {
    case "weather":
      return "Weather";
    case "phenology":
      return "Phenology";
    case "disease":
      return "Disease";
    case "activity":
      return "Activity";
    default:
      return "Other";
  }
}

export interface NoteTypeGroup {
  groupCode: string;
  label: string;
  types: VintageNoteType[];
}

/** Active types grouped in contract order, then by sort_order. */
export function groupNoteTypes(types: VintageNoteType[]): NoteTypeGroup[] {
  const active = types.filter((t) => t.is_active && !t.deleted_at);
  const rank = (g: string) => {
    const i = NOTE_TYPE_GROUP_ORDER.indexOf(g as (typeof NOTE_TYPE_GROUP_ORDER)[number]);
    return i === -1 ? NOTE_TYPE_GROUP_ORDER.length : i;
  };
  const groups = new Map<string, VintageNoteType[]>();
  for (const t of active) {
    const list = groups.get(t.group_code) ?? [];
    list.push(t);
    groups.set(t.group_code, list);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([groupCode, list]) => ({
      groupCode,
      label: noteTypeGroupLabel(groupCode),
      types: list.slice().sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)),
    }));
}

export async function fetchVintageNotes(vineyardId: string): Promise<VintageNote[]> {
  const { data, error } = await supabase
    .from("vintage_notes" as any)
    .select(
      "id, vineyard_id, note_date, vintage_year, note_type_id, note_type_label, notes, observed_by_user_id, observer_name_snapshot, created_at, updated_at, deleted_at",
    )
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .order("note_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as VintageNote[];
}

/** Global (vineyard_id NULL) plus this vineyard's active types. */
export async function fetchVintageNoteTypes(vineyardId: string): Promise<VintageNoteType[]> {
  const { data, error } = await supabase
    .from("vintage_note_types" as any)
    .select("id, vineyard_id, code, group_code, label, sort_order, is_system, is_active, deleted_at")
    .or(`vineyard_id.is.null,vineyard_id.eq.${vineyardId}`)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as unknown as VintageNoteType[];
}

export interface VintageNoteFilters {
  scope: VintageScope | null;
  /** "all" or a note_type_id. */
  typeId: string;
  search: string;
}

export const ALL_NOTE_TYPES = "all";

export function filterVintageNotes(notes: VintageNote[], filters: VintageNoteFilters): VintageNote[] {
  const q = filters.search.trim().toLowerCase();
  return notes.filter((n) => {
    if (!isWithinVintage(n.note_date, filters.scope)) return false;
    if (filters.typeId !== ALL_NOTE_TYPES && n.note_type_id !== filters.typeId) return false;
    if (!q) return true;
    const hay = [n.note_type_label, n.notes, n.observer_name_snapshot, n.note_date]
      .filter((x) => x != null)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export interface VintageNoteDraft {
  noteDate: string;
  noteTypeId: string | null;
  notes: string;
}

/** Valid when EITHER a type OR non-blank text is present. */
export function validateVintageNote(draft: VintageNoteDraft): { ok: boolean; reason?: string } {
  if (!draft.noteDate || draft.noteDate.trim() === "") {
    return { ok: false, reason: "Choose a date for the note." };
  }
  const hasType = !!draft.noteTypeId;
  const hasText = draft.notes.trim().length > 0;
  if (!hasType && !hasText) {
    return { ok: false, reason: "Add a note type or some note text — a note needs at least one." };
  }
  return { ok: true };
}

export interface InsertVintageNoteInput {
  vineyardId: string;
  draft: VintageNoteDraft;
  /** Signed-in user — the observer. Never spoofed from form input. */
  observerUserId: string;
  observerName: string;
  /** Selected type row, for the historical label snapshot. */
  noteType: VintageNoteType | null;
  /** Stable client id for safe retries; generated by the caller once. */
  clientId: string;
}

export function buildVintageNoteInsert(input: InsertVintageNoteInput): Record<string, unknown> {
  const text = input.draft.notes.trim();
  return {
    id: input.clientId,
    vineyard_id: input.vineyardId,
    note_date: input.draft.noteDate,
    // vintage_year is computed by the server trigger from note_date.
    note_type_id: input.noteType?.id ?? null,
    note_type_label: input.noteType?.label ?? null,
    notes: text === "" ? null : text,
    observed_by_user_id: input.observerUserId,
    observer_name_snapshot: input.observerName,
  };
}

/**
 * Insert one note through the authenticated client (RLS is the authority).
 * Returns the persisted row so the caller can trust the server-computed
 * vintage_year. Idempotent per clientId: a retry with the same id returns
 * the existing row instead of duplicating the note.
 */
export async function insertVintageNote(
  input: InsertVintageNoteInput,
): Promise<VintageNote> {
  const payload = buildVintageNoteInsert(input);
  const { data, error } = await supabase
    .from("vintage_notes" as any)
    .upsert(payload, { onConflict: "id", ignoreDuplicates: true })
    .select(
      "id, vineyard_id, note_date, vintage_year, note_type_id, note_type_label, notes, observed_by_user_id, observer_name_snapshot, created_at, updated_at, deleted_at",
    );
  if (error) throw error;
  const row = ((data ?? []) as unknown as VintageNote[])[0];
  if (row) return row;
  // ignoreDuplicates returned nothing: the id already exists — read it back.
  const { data: existing, error: readErr } = await supabase
    .from("vintage_notes" as any)
    .select(
      "id, vineyard_id, note_date, vintage_year, note_type_id, note_type_label, notes, observed_by_user_id, observer_name_snapshot, created_at, updated_at, deleted_at",
    )
    .eq("id", input.clientId)
    .eq("vineyard_id", input.vineyardId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!existing) throw new Error("The note could not be saved. Please try again.");
  return existing as unknown as VintageNote;
}

/** New stable id for one note-entry attempt session. */
export function newVintageNoteClientId(): string {
  return generateUuid();
}
