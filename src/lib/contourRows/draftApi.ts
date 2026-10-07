// Backend access for Contour Row Mapping drafts (shared VineTrack DB).
// Only the three draft RPCs are called — never the paddocks table.
import { supabase } from "@/integrations/ios-supabase/client";
import type { ContourDraft } from "./draft";

export interface StoredDraft { revision: number; payload: ContourDraft; updatedAt: string | null }

export type DraftLoad =
  | { status: "setup_required"; detail: string }
  | { status: "empty" }
  | { status: "loaded"; draft: StoredDraft };

export class DraftApiError extends Error {
  constructor(public kind: "setup_required" | "stale" | "denied" | "invalid" | "network" | "unknown", message: string) { super(message); }
}

export function classifyError(e: any): DraftApiError {
  const code = String(e?.code ?? ""), msg = String(e?.message ?? e ?? "");
  if (code === "PGRST202" || code === "42883" || code === "42P01" || /could not find the function/i.test(msg))
    return new DraftApiError("setup_required", "Contour Row Mapping is not set up on the VineTrack database yet.");
  if (/stale_revision/.test(msg)) return new DraftApiError("stale", "This draft was changed elsewhere since you opened it. Your edits are kept here — export a backup, then reload to see the latest version.");
  if (code === "42501" || /not_authori[sz]ed/.test(msg)) return new DraftApiError("denied", "You don't have access to Contour Row Mapping for this block.");
  if (/invalid_/.test(msg)) return new DraftApiError("invalid", `The database rejected this draft: ${msg.replace(/^.*invalid_/, "invalid ")}`);
  if (/fetch|network|timeout/i.test(msg)) return new DraftApiError("network", "Couldn't reach VineTrack. Check your connection and try Save again — your edits are kept.");
  return new DraftApiError("unknown", msg || "Something went wrong.");
}

const rpc = (fn: string, args: Record<string, unknown>) => (supabase as any).rpc(fn, args);

function toStored(data: any): StoredDraft | null {
  if (!data) return null;
  return { revision: Number(data.revision), payload: data.payload as ContourDraft, updatedAt: data.updated_at ?? null };
}

export async function loadDraft(paddockId: string): Promise<DraftLoad> {
  const { data, error } = await rpc("get_contour_row_mapping_draft", { p_paddock_id: paddockId });
  if (error) {
    const e = classifyError(error);
    if (e.kind === "setup_required") return { status: "setup_required", detail: e.message };
    throw e;
  }
  const s = toStored(data);
  return s ? { status: "loaded", draft: s } : { status: "empty" };
}

/**
 * Save with optimistic revision + idempotent client save id. On success the
 * draft is read back and its identity/revision re-checked before the save
 * is reported as confirmed.
 */
export async function saveDraft(paddockId: string, expectedRevision: number, clientSaveId: string, payload: ContourDraft): Promise<StoredDraft> {
  if (payload.paddockId !== paddockId) throw new DraftApiError("invalid", "Draft belongs to a different block.");
  const { data, error } = await rpc("save_contour_row_mapping_draft", {
    p_paddock_id: paddockId, p_expected_revision: expectedRevision, p_client_save_id: clientSaveId, p_payload: payload,
  });
  if (error) throw classifyError(error);
  const saved = toStored(data);
  if (!saved) throw new DraftApiError("unknown", "The save was not acknowledged.");
  const back = await loadDraft(paddockId);
  if (back.status !== "loaded" || back.draft.revision < saved.revision || back.draft.payload?.draftId !== payload.draftId || back.draft.payload?.paddockId !== paddockId)
    throw new DraftApiError("unknown", "The saved draft could not be confirmed on read-back. Try Save again.");
  return back.draft;
}

export async function discardDraft(paddockId: string, expectedRevision: number): Promise<void> {
  const { error } = await rpc("discard_contour_row_mapping_draft", { p_paddock_id: paddockId, p_expected_revision: expectedRevision });
  if (error) throw classifyError(error);
}
