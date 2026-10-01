// System Admin — catalogue-wide Master Chemical refresh.
//
// Every current CANDIDATE master row is re-evaluated by the CURRENTLY DEPLOYED
// `chemical-info-lookup` parser through the existing, trusted
// `action: "master_refresh"` path. The browser never writes authoritative
// chemical evidence itself, never uses a service-role key, never approves a
// candidate and never touches vineyard-private data (`saved_chemicals`,
// pricing, stock, spray records or historical snapshots).
//
// This module is pure except for the injected `invoke` / storage callbacks so
// the whole run is unit-testable.

import { withClientDiagnostics } from "@/lib/chemicalLookupRequest";

export const MASTER_REFRESH_ACTION = "master_refresh";
export const REFRESH_STORAGE_KEY = "vt.master-catalogue-refresh.v1";
export const DEFAULT_REFRESH_CONCURRENCY = 3;

/* ------------------------------------------------------------- request */

export interface MasterRefreshRequest {
  action: typeof MASTER_REFRESH_ACTION;
  masterChemicalId: string;
  /** Snake-case alias for older deployments of the same action. */
  master_chemical_id: string;
  /** Refresh the candidate in place. The backend keeps review_status = candidate. */
  apply: true;
}

/**
 * Exact request for one Master record. No country is sent: the backend derives
 * the jurisdiction from the exact Master record. Registration is optional.
 * The portal NEVER asks for approval here.
 */
export function masterRefreshRequestBody(
  masterChemicalId: string,
  correlationId?: string,
): Record<string, unknown> {
  const body: MasterRefreshRequest = {
    action: MASTER_REFRESH_ACTION,
    masterChemicalId,
    master_chemical_id: masterChemicalId,
    apply: true,
  };
  return withClientDiagnostics(body as unknown as Record<string, unknown>, correlationId);
}

/**
 * Rehydration scope: EVERY candidate Master record from the unfiltered
 * catalogue, independent of the current UI filter. Approved / retired rows are
 * never refreshed in place.
 */
export function rehydrationScopeIds(
  rows: Array<{ id: string; review_status?: string | null }>,
): string[] {
  return rows
    .filter((r) => (r.review_status ?? "candidate") === "candidate")
    .map((r) => r.id);
}

/* ------------------------------------------------------------- outcomes */

/** Backend-reported outcomes, reported separately. `failed` is transport. */
export type MasterRefreshOutcome =
  | "no_material_change"
  | "material_change"
  | "evidence_refreshed"
  | "conflict"
  | "source_unavailable"
  | "skipped"
  | "failed";

export const REFRESH_OUTCOME_LABEL: Record<MasterRefreshOutcome, string> = {
  no_material_change: "No change",
  material_change: "Updated",
  evidence_refreshed: "Evidence refreshed",
  conflict: "Conflict",
  source_unavailable: "Source unavailable",
  skipped: "Skipped",
  failed: "Failed",
};

/** Short per-row status for the Master list. */
export const REFRESH_ROW_STATUS_LABEL: Record<MasterRefreshOutcome, string> = {
  no_material_change: "No change",
  material_change: "Rehydrated",
  evidence_refreshed: "Rehydrated",
  conflict: "Conflict",
  source_unavailable: "Source unavailable",
  skipped: "Skipped",
  failed: "Failed",
};

/** Outcomes that belong in the "Rehydrated this run" review queue. */
export const REVIEW_QUEUE_OUTCOMES: MasterRefreshOutcome[] = [
  "material_change",
  "evidence_refreshed",
  "no_material_change",
  "conflict",
];

/** Processed ids for review, in planned order. Failed / unavailable excluded. */
export function rehydratedQueueIds(state: RefreshRunState | null): string[] {
  if (!state) return [];
  return state.planned.filter((id) => {
    const row = state.rows[id];
    return !!row && REVIEW_QUEUE_OUTCOMES.includes(row.outcome);
  });
}

/** Retryable ids from the run (failed / source unavailable). */
export function retryableRunIds(state: RefreshRunState | null): string[] {
  if (!state) return [];
  return state.planned.filter((id) => {
    const o = state.rows[id]?.outcome;
    return o === "failed" || o === "source_unavailable";
  });
}

/** Read the persisted run state (browser-refresh safe). */
export function readStoredRefreshState(): RefreshRunState | null {
  try {
    const raw = localStorage.getItem(REFRESH_STORAGE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && s.version === 1 && Array.isArray(s.planned) && s.rows ? s : null;
  } catch {
    return null;
  }
}

export function writeStoredRefreshState(state: RefreshRunState | null) {
  try {
    if (!state) localStorage.removeItem(REFRESH_STORAGE_KEY);
    else localStorage.setItem(REFRESH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage is a convenience only */
  }
}

/** Outcomes that must not be retried automatically. */
export const TERMINAL_OUTCOMES: MasterRefreshOutcome[] = [
  "no_material_change",
  "material_change",
  "evidence_refreshed",
  "conflict",
  "skipped",
];

const OUTCOME_ALIASES: Record<string, MasterRefreshOutcome> = {
  no_material_change: "no_material_change",
  unchanged: "no_material_change",
  no_change: "no_material_change",
  material_change: "material_change",
  changed: "material_change",
  updated: "material_change",
  evidence_refreshed: "evidence_refreshed",
  evidence_updated: "evidence_refreshed",
  refreshed: "evidence_refreshed",
  conflict: "conflict",
  conflicts: "conflict",
  needs_adjudication: "conflict",
  source_unavailable: "source_unavailable",
  unavailable: "source_unavailable",
  provider_unavailable: "source_unavailable",
  skipped: "skipped",
  not_applicable: "skipped",
};

/**
 * Classify whatever the backend returned. The portal never invents an outcome:
 * an unrecognised but successful response is reported as
 * `evidence_refreshed` only when the backend says a refresh happened,
 * otherwise as `no_material_change`.
 */
export function classifyRefreshOutcome(payload: unknown): MasterRefreshOutcome {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, any>;
  if (typeof root.error === "string" && root.error) {
    return /unavailable|timeout|429|temporar/i.test(root.error)
      ? "source_unavailable"
      : "failed";
  }
  const candidates = [
    root.refresh_outcome,
    root.outcome,
    root.result,
    root.status,
    root.master?.refresh_outcome,
  ];
  for (const c of candidates) {
    const key = String(c ?? "").trim().toLowerCase();
    if (key && OUTCOME_ALIASES[key]) return OUTCOME_ALIASES[key];
  }
  if (Array.isArray(root.conflicts) && root.conflicts.length > 0) return "conflict";
  if (root.material_change === true) return "material_change";
  if (root.material_change === false) return "no_material_change";
  if (root.updated === true || root.evidence_refreshed === true) return "evidence_refreshed";
  return "no_material_change";
}

/** Transport / server error → outcome. Transient failures stay retryable. */
export function classifyRefreshError(error: unknown): MasterRefreshOutcome {
  let text = "";
  try {
    text = typeof error === "string" ? error : JSON.stringify(error ?? "");
  } catch {
    text = String(error ?? "");
  }
  if (error && typeof error === "object") text += ` ${String((error as any).message ?? "")}`;
  if (/429|rate.?limit|quota|timeout|timed out|503|502|504|unavailable|transient/i.test(text)) {
    return "source_unavailable";
  }
  return "failed";
}

/* --------------------------------------------------------------- state */

export interface RefreshRowState {
  id: string;
  outcome: MasterRefreshOutcome;
  message?: string;
  attempts: number;
}

export interface RefreshRunState {
  version: 1;
  /** Every id in the planned run, in stable order. */
  planned: string[];
  /** Completed rows keyed by master chemical id. */
  rows: Record<string, RefreshRowState>;
  startedAt: string;
  updatedAt: string;
}

export function newRefreshRunState(ids: string[], now: string): RefreshRunState {
  return {
    version: 1,
    planned: [...ids],
    rows: {},
    startedAt: now,
    updatedAt: now,
  };
}

/**
 * Rows still to process. A row that already produced a terminal backend
 * outcome is NEVER restarted; `source_unavailable` / `failed` rows are
 * retryable and are returned again.
 */
export function pendingIds(state: RefreshRunState, ids: string[]): string[] {
  return ids.filter((id) => {
    const row = state.rows[id];
    if (!row) return true;
    return !TERMINAL_OUTCOMES.includes(row.outcome);
  });
}

export function recordRow(
  state: RefreshRunState,
  id: string,
  outcome: MasterRefreshOutcome,
  now: string,
  message?: string,
): RefreshRunState {
  const prev = state.rows[id];
  return {
    ...state,
    rows: {
      ...state.rows,
      [id]: { id, outcome, message, attempts: (prev?.attempts ?? 0) + 1 },
    },
    updatedAt: now,
  };
}

export interface RefreshTotals {
  total: number;
  processed: number;
  no_material_change: number;
  material_change: number;
  evidence_refreshed: number;
  conflict: number;
  source_unavailable: number;
  skipped: number;
  failed: number;
}

export function refreshTotals(state: RefreshRunState): RefreshTotals {
  const totals: RefreshTotals = {
    total: state.planned.length,
    processed: 0,
    no_material_change: 0,
    material_change: 0,
    evidence_refreshed: 0,
    conflict: 0,
    source_unavailable: 0,
    skipped: 0,
    failed: 0,
  };
  for (const row of Object.values(state.rows)) {
    totals.processed += 1;
    totals[row.outcome] += 1;
  }
  return totals;
}

/** Resume only when the run describes the same planned set. */
export function resumableState(
  raw: unknown,
  ids: string[],
): RefreshRunState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as RefreshRunState;
  if (s.version !== 1 || !Array.isArray(s.planned) || !s.rows) return null;
  const planned = new Set(s.planned);
  const overlap = ids.filter((id) => planned.has(id)).length;
  if (overlap === 0) return null;
  return { ...s, planned: [...ids] };
}

/* --------------------------------------------------------------- runner */

export interface RefreshRunnerOptions {
  ids: string[];
  /** Injected caller — returns the raw backend payload or throws. */
  invoke: (id: string) => Promise<unknown>;
  concurrency?: number;
  initialState?: RefreshRunState | null;
  now?: () => string;
  onProgress?: (state: RefreshRunState) => void;
  /** Cooperative cancel — checked before each request. */
  isCancelled?: () => boolean;
  /** Politeness delay between requests on one worker (ms). */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Bounded-concurrency catalogue refresh. Never floods the upstream register:
 * at most `concurrency` in-flight requests with an optional per-worker delay.
 */
export async function runCatalogueRefresh(
  opts: RefreshRunnerOptions,
): Promise<RefreshRunState> {
  const now = opts.now ?? (() => new Date().toISOString());
  const sleep = opts.sleep ?? defaultSleep;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_REFRESH_CONCURRENCY, 3));
  let state =
    opts.initialState && opts.initialState.version === 1
      ? { ...opts.initialState, planned: [...opts.ids] }
      : newRefreshRunState(opts.ids, now());

  const queue = pendingIds(state, opts.ids);
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      if (opts.isCancelled?.()) return;
      const index = cursor++;
      if (index >= queue.length) return;
      const id = queue[index];
      let outcome: MasterRefreshOutcome;
      let message: string | undefined;
      try {
        const payload = await opts.invoke(id);
        outcome = classifyRefreshOutcome(payload);
        const err = (payload as any)?.error;
        if (typeof err === "string" && err) message = err;
      } catch (e) {
        outcome = classifyRefreshError(e);
        message = e instanceof Error ? e.message : String(e);
      }
      state = recordRow(state, id, outcome, now(), message);
      opts.onProgress?.(state);
      if (opts.delayMs) await sleep(opts.delayMs);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return state;
}
