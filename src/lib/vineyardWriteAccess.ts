// Read-only vineyard mode (expired trial). Decides from the server access row
// whether the Portal may enter a vineyard and whether it may write.
//
// Contract (additive server fields on get_my_vineyard_access_matrix rows):
//   can_write          missing => true (older backends keep full write access)
//   read_only_reason   e.g. "trial_expired"
//
// Transitional rule until the server returns can_enter_vineyard=true for
// expired trials: a row that is (a) denied, (b) flagged is_trial, (c) has the
// server reason "expired" and (d) still has a membership role is treated as
// read-only rather than blocked. Revoked, unfunded or role-less rows stay
// blocked exactly as before.
import type { VineyardAccessRow } from "@/lib/vineyardAccessQuery";

export type ReadOnlyReason = "trial_expired" | string;

export interface VineyardWriteAccess {
  canEnter: boolean;
  canWrite: boolean;
  readOnlyReason: ReadOnlyReason | null;
}

export function resolveVineyardWriteAccess(
  row: Pick<
    VineyardAccessRow,
    "can_enter_vineyard" | "can_write" | "read_only_reason" | "is_trial" | "vineyard_access_reason" | "membership_role"
  > | null | undefined,
): VineyardWriteAccess {
  if (!row) return { canEnter: false, canWrite: false, readOnlyReason: null };
  if (row.can_enter_vineyard) {
    const canWrite = row.can_write !== false;
    return {
      canEnter: true,
      canWrite,
      readOnlyReason: canWrite ? null : row.read_only_reason ?? "read_only",
    };
  }
  if (row.is_trial && row.vineyard_access_reason === "expired" && !!row.membership_role) {
    return { canEnter: true, canWrite: false, readOnlyReason: "trial_expired" };
  }
  return { canEnter: false, canWrite: false, readOnlyReason: null };
}

/* ------------------------------------------------------------------ */
/* Global read-only store (read by the QueryClient mutation guard).    */
/* ------------------------------------------------------------------ */

type Listener = () => void;
const listeners = new Set<Listener>();
let state = { readOnly: false, reason: null as string | null, promptOpen: false };

function emit() {
  listeners.forEach((l) => l());
}

export const readOnlyStore = {
  get: () => state,
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setReadOnly(readOnly: boolean, reason: string | null = null) {
    if (state.readOnly === readOnly && state.reason === reason) return;
    state = { ...state, readOnly, reason: readOnly ? reason : null };
    emit();
  },
  openPrompt() {
    state = { ...state, promptOpen: true };
    emit();
  },
  closePrompt() {
    state = { ...state, promptOpen: false };
    emit();
  },
};

export const READ_ONLY_ERROR_CODE = "VT_READ_ONLY";

export class ReadOnlyBlockedError extends Error {
  readonly code = READ_ONLY_ERROR_CODE;
  constructor() {
    super("Your VineTrack trial has ended. Your data is still available in read-only mode.");
    this.name = "ReadOnlyBlockedError";
  }
}

/** True for the Portal guard error or a server write-denied error carrying VT_READ_ONLY. */
export function isReadOnlyError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof ReadOnlyBlockedError) return true;
  const e = err as { code?: unknown; message?: unknown; hint?: unknown; details?: unknown };
  return [e.code, e.message, e.hint, e.details].some(
    (v) => typeof v === "string" && v.includes(READ_ONLY_ERROR_CODE),
  );
}

/** Mutations tagged with this meta keep working in read-only mode (billing, invites, access refresh). */
export const ALLOW_READ_ONLY = { allowReadOnly: true } as const;

/** Called before every useMutation runs. Throws to cancel the write. */
export function guardMutation(meta: Record<string, unknown> | undefined): void {
  if (!readOnlyStore.get().readOnly) return;
  if (meta?.allowReadOnly === true) return;
  readOnlyStore.openPrompt();
  throw new ReadOnlyBlockedError();
}

/** Called on every mutation error: a server VT_READ_ONLY denial opens the same prompt. */
export function handleMutationError(err: unknown): void {
  if (isReadOnlyError(err)) readOnlyStore.openPrompt();
}
