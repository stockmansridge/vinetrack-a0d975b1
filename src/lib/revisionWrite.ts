// Shared SQL 198 revision-concurrency helper.
//
// SQL 198 applies to exactly three shared tables:
//   public.pruning_seasons, public.pruning_yield_settings, public.resistance_plans
// It does NOT apply to spray_jobs / spray_records.
//
// Contract used here (verified live on production `tbafuqwruefgkbyxrxyb`:
// all three tables expose `server_revision` and `base_revision`):
//   * read the row and retain the EXACT `server_revision` that was loaded;
//   * on update send `base_revision = <loaded server_revision>` — never
//     `server_revision + 1`, the server owns revision advancement;
//   * on insert omit `base_revision` (nothing to be stale against);
//   * always request the returned representation so the caller gets the new
//     authoritative `server_revision`;
//   * a stale write is reported as HTTP 409 with the machine-readable
//     `PT409` / `REVISION_CONFLICT` marker — anything else that happens to be
//     a 409 (e.g. Postgres `23505` unique_violation) is NOT a revision
//     conflict and must keep its true error.
//
// `client_updated_at` is intentionally retained by callers: it still carries
// change/resurrection semantics for shared sync. It simply no longer decides
// whether a write is stale.

/** Machine-readable markers published by the SQL 198 contract. */
const REVISION_CONFLICT_CODES = new Set(["PT409", "REVISION_CONFLICT"]);

export class RevisionConflictError extends Error {
  readonly name = "RevisionConflictError";
  readonly code = "REVISION_CONFLICT";
  /** The revision the client believed it was editing. */
  readonly baseRevision: number | null;
  /** Authoritative server row, when it could be re-read. */
  latest: unknown = null;
  constructor(baseRevision: number | null, message?: string) {
    super(
      message ??
        "This record was changed elsewhere. Your edits have been kept. Review the latest version before saving again.",
    );
    this.baseRevision = baseRevision;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * True only when the error carries the SQL 198 revision-conflict marker.
 * A bare HTTP 409 (unique violation, exclusion constraint, …) returns false.
 */
export function isRevisionConflict(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof RevisionConflictError) return true;
  const e = error as Record<string, unknown>;
  const code = text(e.code).toUpperCase();
  if (REVISION_CONFLICT_CODES.has(code)) return true;
  // Never reclassify a genuine constraint violation that shares HTTP 409.
  if (/^[0-9A-Z]{5}$/.test(code) && !REVISION_CONFLICT_CODES.has(code)) {
    // Postgres SQLSTATE (e.g. 23505) — trust it verbatim.
    return false;
  }
  const haystack = [
    text(e.message),
    text(e.details),
    text(e.hint),
    text((e.error as Record<string, unknown> | undefined)?.message),
  ]
    .join(" ")
    .toUpperCase();
  return haystack.includes("REVISION_CONFLICT") || haystack.includes("PT409");
}

export interface RevisionWriteOptions<T> {
  /** Runs the actual PostgREST call with the final payload. Must request the
   *  returned representation (`.select(...)`). */
  run: (payload: Record<string, unknown>) => Promise<{ data: T | null; error: unknown }>;
  /** Payload WITHOUT `base_revision` (callers keep `client_updated_at`). */
  payload: Record<string, unknown>;
  /** `server_revision` exactly as loaded. `null`/`undefined` = new row. */
  baseRevision?: number | null;
  /** Optional re-read of the authoritative row, attached to the conflict. */
  refetch?: () => Promise<T | null>;
}

/**
 * Perform one versioned write. Resolves with the authoritative returned row,
 * or throws {@link RevisionConflictError} on a genuine SQL 198 conflict.
 * Never retries — the caller keeps the user's unsaved edits and decides.
 */
export async function revisionWrite<T>(opts: RevisionWriteOptions<T>): Promise<T> {
  const { run, payload, refetch } = opts;
  const baseRevision =
    typeof opts.baseRevision === "number" && Number.isFinite(opts.baseRevision)
      ? opts.baseRevision
      : null;

  const finalPayload: Record<string, unknown> = { ...payload };
  if (baseRevision !== null) finalPayload.base_revision = baseRevision;

  const { data, error } = await run(finalPayload);

  if (error) {
    if (isRevisionConflict(error)) {
      const conflict = new RevisionConflictError(baseRevision);
      if (refetch) conflict.latest = await refetch().catch(() => null);
      throw conflict;
    }
    throw error; // auth (401/403), server (5xx), 23505, … keep their identity.
  }

  // An empty/minimal 2xx is NOT a successful versioned mutation: with
  // `base_revision` supplied it means the row moved on (or is no longer
  // visible). Treat it as a conflict rather than a silent no-op.
  if (data == null) {
    if (baseRevision === null) {
      throw new Error("The write did not return the saved record. Please try again.");
    }
    const conflict = new RevisionConflictError(baseRevision);
    if (refetch) conflict.latest = await refetch().catch(() => null);
    throw conflict;
  }

  return data;
}

/** Read the server revision off a raw row, without inventing a value. */
export function serverRevisionOf(row: unknown): number | null {
  const raw = (row as Record<string, unknown> | null | undefined)?.server_revision;
  const n = typeof raw === "string" ? Number(raw) : (raw as number | undefined);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Copy for the minimal Stage 2A conflict UI. */
export const REVISION_CONFLICT_MESSAGE =
  "This record was changed elsewhere. Your edits have been kept. Review the latest version before saving again.";
