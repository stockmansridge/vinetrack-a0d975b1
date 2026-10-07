// In-memory (tab-only) working copies of unsaved Contour Row Mapping drafts,
// so browser Back/Forward or switching vineyard never silently discards edits.
// NOT authoritative storage: never persisted (no localStorage), restored
// only after the page has passed its normal admin/scope/backend load.
import type { ContourDraft } from "./draft";

export interface WorkingCopy {
  draft: ContourDraft;
  base: { draftId: string | null; revision: number };
  savedJson: string;
}

const copies = new Map<string, WorkingCopy>();

export const workingCopyKey = (userId: string, vineyardId: string, paddockId: string) => `${userId}:${vineyardId}:${paddockId}`;

export function getWorkingCopy(key: string): WorkingCopy | null {
  const c = copies.get(key);
  return c ? structuredClone(c) : null;
}

export function putWorkingCopy(key: string, c: WorkingCopy): void {
  if (JSON.stringify(c.draft) === c.savedJson) copies.delete(key);
  else copies.set(key, structuredClone(c));
}

export function clearWorkingCopy(key: string): void { copies.delete(key); }

/** Save confirmed (possibly after the editor unmounted): drop the copy if it
 *  matches what was saved, otherwise rebase it onto the new revision. */
export function reconcileSaved(key: string, savedJson: string, base: { draftId: string; revision: number }): void {
  const c = copies.get(key);
  if (!c) return;
  if (JSON.stringify(c.draft) === savedJson) copies.delete(key);
  else copies.set(key, { ...c, base, savedJson });
}

/** Drop every copy not owned by `userId` (null = signed out → drop all). */
export function clearWorkingCopiesExcept(userId: string | null): void {
  for (const k of Array.from(copies.keys())) if (!userId || !k.startsWith(`${userId}:`)) copies.delete(k);
}

export const _workingCopyCount = () => copies.size;
