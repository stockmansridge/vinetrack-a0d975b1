// System Admin → Dashboard "What people are doing": Soil Analysis activity.
//
// The read-only admin_platform_action_stats RPC (SQL 257) covers the
// operational tables only, so Soil Analysis rows are derived here from the
// live soil records using the SAME metric definitions as that RPC:
//   added    = records created in the period
//   edited   = records changed after they were created
//   deleted  = records removed in the period
//   vineyards / users = distinct attribution of records ADDED in the period
//
// Reads are read-only, use the same client as every other Soil Analysis read
// (the shared VineTrack backend, RLS is the authority) and fail closed: if a
// read errors the caller shows "unavailable" rather than a zero that could be
// mistaken for "no soil activity".

import { supabase } from "@/integrations/ios-supabase/client";
import type { PlatformActionStat } from "@/components/admin/PlatformActionStatsSection";

const db = supabase as any;

export const SOIL_ACTIVITY_CATEGORY = "Soil Analysis";
export const SOIL_SAMPLE_ACTIVITY_KEY = "soil_samples";
export const SOIL_DOCUMENT_ACTIVITY_KEY = "soil_sample_documents";

/** Minimal soil_samples columns the activity ledger needs. */
export interface SoilActivitySampleRow {
  id: string;
  vineyard_id: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

/** Minimal soil_sample_documents columns the activity ledger needs. */
export interface SoilActivityDocumentRow {
  id: string;
  vineyard_id: string | null;
  uploaded_by: string | null;
  created_at: string | null;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

/** Window start for a "last N days" period, or null for all time. */
export function soilActivityWindowStart(days: number | null): string | null {
  if (days == null) return null;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function within(iso: string | null | undefined, since: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  if (since == null) return true;
  const s = new Date(since).getTime();
  return Number.isFinite(s) ? t >= s : false;
}

function changedAfterCreation(row: {
  created_at: string | null;
  updated_at: string | null;
}): boolean {
  if (!row.created_at || !row.updated_at) return false;
  const created = new Date(row.created_at).getTime();
  const updated = new Date(row.updated_at).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;
  return updated > created;
}

function distinctIds(ids: Array<string | null | undefined>): number {
  const seen = new Set<string>();
  for (const id of ids) if (typeof id === "string" && id) seen.add(id);
  return seen.size;
}

/**
 * Pure builder: turns raw soil records into dashboard activity rows. Kept
 * separate from the reads so the metric definitions are directly testable.
 */
export function buildSoilActivityStats(
  samples: SoilActivitySampleRow[],
  documents: SoilActivityDocumentRow[],
  days: number | null,
): PlatformActionStat[] {
  const since = soilActivityWindowStart(days);

  const addedSamples = samples.filter((r) => within(r.created_at, since));
  const editedSamples = samples.filter(
    (r) => within(r.updated_at, since) && changedAfterCreation(r),
  );
  const deletedSamples = samples.filter((r) => within(r.deleted_at, since));

  const addedDocuments = documents.filter((r) => within(r.created_at, since));

  return [
    {
      action_key: SOIL_SAMPLE_ACTIVITY_KEY,
      label: "Soil Sample",
      category: SOIL_ACTIVITY_CATEGORY,
      created_count: addedSamples.length,
      edited_count: editedSamples.length,
      deleted_count: deletedSamples.length,
      vineyard_count: distinctIds(addedSamples.map((r) => r.vineyard_id)),
      user_count: distinctIds(addedSamples.map((r) => r.created_by)),
      // The SQL 257 participant RPC doesn't cover the soil tables, so these
      // counts are totals only and must not open a participant list.
      drilldown: false,
    },
    {
      action_key: SOIL_DOCUMENT_ACTIVITY_KEY,
      label: "Soil Lab Document",
      category: SOIL_ACTIVITY_CATEGORY,
      created_count: addedDocuments.length,
      // Lab documents are immutable evidence: they are never edited, and they
      // are removed only together with their sample, so neither is tracked.
      edited_count: null,
      deleted_count: null,
      vineyard_count: distinctIds(addedDocuments.map((r) => r.vineyard_id)),
      user_count: distinctIds(addedDocuments.map((r) => r.uploaded_by)),
      drilldown: false,
    },
  ];
}

async function fetchAll<T>(
  table: string,
  columns: string,
  build: (q: any) => any,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(
      db.from(table).select(columns).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1),
    );
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
  throw new Error("Too many soil records to summarise safely. Choose a shorter period.");
}

/**
 * Reads the soil records for the period and returns their dashboard activity
 * rows. Throws when a read fails so the caller can show "unavailable".
 */
export async function loadSoilActivityStats(
  days: number | null,
): Promise<PlatformActionStat[]> {
  const since = soilActivityWindowStart(days);

  const samples = await fetchAll<SoilActivitySampleRow>(
    "soil_samples",
    "id, vineyard_id, created_by, created_at, updated_at, deleted_at",
    (q) =>
      since
        ? q.or(
            `created_at.gte.${since},updated_at.gte.${since},deleted_at.gte.${since}`,
          )
        : q,
  );

  const documents = await fetchAll<SoilActivityDocumentRow>(
    "soil_sample_documents",
    "id, vineyard_id, uploaded_by, created_at",
    (q) => (since ? q.gte("created_at", since) : q),
  );

  return buildSoilActivityStats(samples, documents, days);
}
