// Client wrappers for the Crop Health automatic backfill engine.
// Discovery finds every imagery date VineTrack expects but has not stored;
// the runner processes those dates newest-first in small batches so progress
// survives page refreshes; status reports live progress.
import { supabase } from "@/integrations/supabase/client";
import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";

async function invoke<T = any>(name: string, body: unknown): Promise<T> {
  const { data: { session } } = await iosSupabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in to VineTrack");
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  return data as T;
}

export type BackfillJobStatus =
  | "queued" | "discovering" | "downloading" | "processing"
  | "completed" | "completed_with_warnings" | "failed" | "cancelled";

export interface BackfillJob {
  id: string;
  vineyard_id: string;
  status: BackfillJobStatus;
  requested_paddock_ids: string[];
  index_types: string[];
  newest_date_checked: string | null;
  oldest_date_checked: string | null;
  current_processing_date: string | null;
  current_paddock_id: string | null;
  missing_dates_found: number;
  dates_completed: number;
  dates_skipped: number;
  dates_failed: number;
  paddocks_total: number;
  paddocks_completed: number;
  started_at: string | null;
  completed_at: string | null;
  heartbeat_at: string | null;
  last_error: string | null;
}

export interface BackfillStatus {
  active_job: BackfillJob | null;
  last_job: BackfillJob | null;
  settings: {
    vineyard_id: string;
    auto_backfill: boolean;
    cadence_days: number;
    history_days: number;
    last_auto_check_at: string | null;
  } | null;
  outcome_counts: Record<string, number>;
  expected_date_total: number;
  missing_dates: number;
  downloaded_dates: number;
  newest_missing_date: string | null;
  oldest_missing_date: string | null;
  percent_complete: number;
}

export interface BackfillRunResult {
  job: BackfillJob | null;
  processed: { paddock_id: string; date: string; outcome: string; error?: string }[];
  remaining: number;
  finished: boolean;
}

export function discoverBackfill(params: {
  vineyardId: string;
  paddockIds?: string[];
  historyDays?: number;
  indexTypes?: string[];
}): Promise<{ job: BackfillJob; missing_dates: number; skipped_dates: number; already_running?: boolean }> {
  return invoke("satellite-backfill-discover", {
    vineyard_id: params.vineyardId,
    paddock_ids: params.paddockIds,
    history_days: params.historyDays,
    index_types: params.indexTypes,
  });
}

export function runBackfillBatch(params: {
  vineyardId: string;
  jobId?: string;
  batchSize?: number;
}): Promise<BackfillRunResult> {
  return invoke("satellite-backfill-run", {
    vineyard_id: params.vineyardId,
    job_id: params.jobId,
    batch_size: params.batchSize,
  });
}

export function fetchBackfillStatus(vineyardId: string): Promise<BackfillStatus> {
  return invoke("satellite-backfill-status", { vineyard_id: vineyardId });
}

export function isBackfillActive(status: BackfillStatus | undefined): boolean {
  const s = status?.active_job?.status;
  return s === "queued" || s === "discovering" || s === "downloading" || s === "processing";
}
