// Backend access for Contour Row Mapping drafts (shared VineTrack DB).
// Only the three draft RPCs are called — never the paddocks table.
// Contract: docs/contour-row-mapping-contract.md
import { supabase } from "@/integrations/ios-supabase/client";
import { isUuid } from "@/lib/uuid";
import { type ContourDraft, type DraftScope, validateDraftShape } from "./draft";

export interface StoredDraft { draftId: string; revision: number; payload: ContourDraft; updatedAt: string | null; lastClientSaveId: string | null }

/** `revision` on "empty" is the slot's current revision (0 if never saved; >0 after a discard tombstone). */
export type DraftLoad =
  | { status: "setup_required"; detail: string }
  | { status: "empty"; revision: number }
  | { status: "loaded"; draft: StoredDraft };

export type DraftErrorKind = "setup_required" | "stale" | "conflict" | "denied" | "invalid" | "network" | "unknown";
export class DraftApiError extends Error {
  constructor(public kind: DraftErrorKind, message: string) { super(message); }
}

export function classifyError(e: any): DraftApiError {
  const code = String(e?.code ?? ""), msg = String(e?.message ?? e ?? "");
  if (code === "PGRST202" || code === "42883" || code === "42P01" || code === "3F000" || /could not find the function/i.test(msg))
    return new DraftApiError("setup_required", "Contour Row Mapping is not set up on the VineTrack database yet.");
  if (/stale_draft_discarded/.test(msg)) return new DraftApiError("stale", "This draft was discarded elsewhere. Your edits are kept here — export a backup, then reload.");
  if (/stale_revision/.test(msg)) return new DraftApiError("stale", "This draft was changed elsewhere since you opened it. Your edits are kept here — export a backup, then reload to see the latest version.");
  if (/invalid_client_save_id_reused/.test(msg)) return new DraftApiError("invalid", "This save id was already used for different content. Try Save again.");
  if (code === "42501" || /not_authori[sz]ed/.test(msg)) return new DraftApiError("denied", "You don't have access to Contour Row Mapping for this block.");
  if (/invalid_/.test(msg)) return new DraftApiError("invalid", `The database rejected this draft: ${msg.replace(/^.*?invalid_/, "invalid ").replace(/_/g, " ")}.`);
  if (/fetch|network|timeout|load failed/i.test(msg)) return new DraftApiError("network", "Couldn't reach VineTrack. Check your connection and try Save again — your edits are kept.");
  return new DraftApiError("unknown", msg || "Something went wrong.");
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<{ data: any; error: any }> {
  try { return await (supabase as any).rpc(fn, args); }
  catch (e) { return { data: null, error: e }; }
}

const isRev = (v: unknown, min: number) => typeof v === "number" && Number.isInteger(v) && v >= min;

/** Order-insensitive deep equality for JSON values (jsonb does not keep key order). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => jsonEqual(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object).filter((k) => (a as any)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as any)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => jsonEqual((a as any)[k], (b as any)[k]));
}

function parseLoad(data: any, scope: DraftScope): DraftLoad {
  if (data == null) return { status: "empty", revision: 0 };
  if (typeof data !== "object" || !isRev(data.revision, 0)) throw new DraftApiError("invalid", "VineTrack returned an unreadable draft. Nothing has been changed.");
  if (data.draft_id == null && data.payload == null) return { status: "empty", revision: data.revision };
  if (!isUuid(data.draft_id) || !isRev(data.revision, 1)) throw new DraftApiError("invalid", "VineTrack returned an unreadable draft. Nothing has been changed.");
  // Shape + scope only: canonical links are flagged in the editor so a block-row change can't lock the draft.
  const errs = validateDraftShape(data.payload, { vineyardId: scope.vineyardId, paddockId: scope.paddockId });
  if (errs.length || data.payload.draftId !== data.draft_id)
    throw new DraftApiError("invalid", `The stored draft failed validation and wasn't opened: ${errs[0] ?? "identity mismatch"}`);
  return {
    status: "loaded",
    draft: { draftId: data.draft_id, revision: data.revision, payload: data.payload as ContourDraft, updatedAt: data.updated_at ?? null,
      lastClientSaveId: isUuid(data.last_client_save_id) ? data.last_client_save_id : null },
  };
}

export async function loadDraft(scope: DraftScope): Promise<DraftLoad> {
  const { data, error } = await rpc("get_contour_row_mapping_draft", { p_paddock_id: scope.paddockId });
  if (error) {
    const e = classifyError(error);
    if (e.kind === "setup_required") return { status: "setup_required", detail: e.message };
    throw e;
  }
  return parseLoad(data, scope);
}

export interface SaveBase { draftId: string | null; revision: number }

/**
 * Save with optimistic draft identity + revision and an idempotent client
 * save id. A network failure is retried with the SAME save id. The save is
 * confirmed only when the server acknowledges our save id and the read-back
 * shows that exact revision, save id and content. If someone saved after
 * us, a conflict is raised — their payload is never reported as ours.
 */
export async function saveDraft(scope: DraftScope, base: SaveBase, clientSaveId: string, payload: ContourDraft, attempts = 2): Promise<StoredDraft> {
  if (!isUuid(clientSaveId)) throw new DraftApiError("invalid", "Missing save id.");
  if (!isRev(base.revision, 0)) throw new DraftApiError("invalid", "Invalid expected revision.");
  if (base.draftId !== null && base.draftId !== payload.draftId) throw new DraftApiError("invalid", "Draft identity changed unexpectedly.");
  const errs = validateDraftShape(payload, scope);
  if (errs.length) throw new DraftApiError("invalid", errs.join(" "));
  const args = {
    p_paddock_id: scope.paddockId, p_expected_draft_id: base.draftId, p_expected_revision: base.revision,
    p_client_save_id: clientSaveId, p_payload: payload,
  };
  let res = await rpc("save_contour_row_mapping_draft", args);
  for (let i = 1; i < attempts && res.error && classifyError(res.error).kind === "network"; i++)
    res = await rpc("save_contour_row_mapping_draft", args); // same identity
  if (res.error) throw classifyError(res.error);
  const ack = res.data;
  if (!ack || ack.client_save_id !== clientSaveId || ack.draft_id !== payload.draftId || !isRev(ack.revision, 1))
    throw new DraftApiError("unknown", "The save was not acknowledged correctly. Try Save again.");
  const back = await loadDraft(scope);
  if (back.status === "loaded") {
    const b = back.draft;
    if (b.draftId === payload.draftId && b.revision === ack.revision && b.lastClientSaveId === clientSaveId && jsonEqual(b.payload, payload)) return b;
    if (b.revision > ack.revision || b.draftId !== payload.draftId)
      throw new DraftApiError("conflict", `Your save reached VineTrack as revision ${ack.revision}, but the draft was changed again elsewhere straight after. Your edits are kept here — export a backup, then reload.`);
  } else if (back.status === "empty" && back.revision > ack.revision) {
    throw new DraftApiError("conflict", "Your save reached VineTrack, but the draft was discarded elsewhere straight after. Your edits are kept here — export a backup.");
  }
  throw new DraftApiError("unknown", "The saved draft could not be confirmed on read-back. Try Save again.");
}

export interface DiscardResult { revision: number; alreadyDiscarded: boolean }

/** Idempotent: discarding an already-discarded draft id succeeds. */
export async function discardDraft(paddockId: string, draftId: string, expectedRevision: number): Promise<DiscardResult> {
  const args = { p_paddock_id: paddockId, p_draft_id: draftId, p_expected_revision: expectedRevision };
  let res = await rpc("discard_contour_row_mapping_draft", args);
  if (res.error && classifyError(res.error).kind === "network") res = await rpc("discard_contour_row_mapping_draft", args);
  if (res.error) throw classifyError(res.error);
  if (!res.data || !isRev(res.data.revision, 1)) throw new DraftApiError("unknown", "The discard was not acknowledged.");
  return { revision: res.data.revision, alreadyDiscarded: !!res.data.already_discarded };
}
