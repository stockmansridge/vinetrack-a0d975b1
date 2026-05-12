// READ-ONLY query helpers for Growth Stage Records.
//
// Primary source: the iOS Supabase view `v_growth_stage_observations`,
// which unifies the new `growth_stage_records` table with legacy
// `pins`-based growth observations and de-duplicates pins that have a
// mirrored growth_stage_records row.
//
// Fallback: if the view is unavailable (older deployments), we read
// directly from `pins` with `mode = 'Growth'` or any growth_stage_code.
import { supabase } from "@/integrations/ios-supabase/client";

export interface GrowthStageRecord {
  id: string;
  vineyard_id: string;
  paddock_id?: string | null;
  paddock_name?: string | null;
  variety?: string | null;
  growth_stage_code?: string | null;
  growth_stage_label?: string | null;
  notes?: string | null;
  date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  completed_at?: string | null;
  /** Legacy single photo path (pins) or first photo from the array. */
  photo_path?: string | null;
  /** All photo paths (new growth_stage_records may carry several). */
  photo_paths?: string[];
  latitude?: number | null;
  longitude?: number | null;
  row_number?: number | null;
  side?: string | null;
  title?: string | null;
  category?: string | null;
  mode?: string | null;
  sync_version?: number | null;
  /** 'record' | 'pin' — origin row this came from, when reported by the view. */
  source?: string | null;
}

interface PaddockLite {
  id: string;
  name?: string | null;
  variety_allocations?: any;
}

const firstVariety = (p: PaddockLite | undefined): string | null => {
  const arr = Array.isArray(p?.variety_allocations) ? p!.variety_allocations : [];
  const v = arr[0]?.variety;
  return v ? String(v) : null;
};

const pickDate = (r: any): string | null =>
  r.date ?? r.observed_at ?? r.completed_at ?? r.created_at ?? null;

const pickStageCode = (r: any): string | null =>
  r.el_stage_code ?? r.growth_stage_code ?? r.stage_code ?? null;

const pickStageLabel = (r: any): string | null =>
  r.el_stage_label ?? r.growth_stage_label ?? r.stage_label ?? null;

const pickPhotoPaths = (r: any): string[] => {
  if (Array.isArray(r.photo_paths) && r.photo_paths.length) return r.photo_paths.filter(Boolean);
  if (r.photo_path) return [r.photo_path];
  return [];
};

function mapRow(r: any, paddockMap: Map<string, PaddockLite>): GrowthStageRecord {
  const pad = r.paddock_id ? paddockMap.get(r.paddock_id) : undefined;
  const photos = pickPhotoPaths(r);
  return {
    id: r.id,
    vineyard_id: r.vineyard_id,
    paddock_id: r.paddock_id ?? null,
    paddock_name: r.paddock_name ?? pad?.name ?? null,
    variety: r.variety ?? firstVariety(pad),
    growth_stage_code: pickStageCode(r),
    growth_stage_label: pickStageLabel(r),
    notes: r.notes ?? null,
    date: pickDate(r),
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
    created_by: r.created_by ?? null,
    updated_by: r.updated_by ?? null,
    completed_at: r.completed_at ?? null,
    photo_path: photos[0] ?? null,
    photo_paths: photos,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    row_number: r.row_number ?? null,
    side: r.side ?? null,
    title: r.title ?? null,
    category: r.category ?? null,
    mode: r.mode ?? null,
    sync_version: r.sync_version ?? null,
    source: r.source ?? null,
  };
}

async function fetchPaddockMap(vineyardId: string): Promise<Map<string, PaddockLite>> {
  const { data, error } = await supabase
    .from("paddocks")
    .select("id,name,variety_allocations")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (error) throw error;
  const map = new Map<string, PaddockLite>();
  (data ?? []).forEach((p: any) => map.set(p.id, p));
  return map;
}

async function fetchFromView(
  vineyardId: string,
  paddockMap: Map<string, PaddockLite>,
): Promise<GrowthStageRecord[] | null> {
  const { data, error } = await supabase
    .from("v_growth_stage_observations" as any)
    .select("*")
    .eq("vineyard_id", vineyardId);
  if (error) {
    // View missing or not exposed → caller should fall back.
    if (/relation|does not exist|not found|schema cache/i.test(error.message)) {
      return null;
    }
    throw error;
  }
  return (data ?? []).map((r: any) => mapRow(r, paddockMap));
}

async function fetchFromPins(
  vineyardId: string,
  paddockMap: Map<string, PaddockLite>,
): Promise<GrowthStageRecord[]> {
  const { data, error } = await supabase
    .from("pins")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .or("mode.eq.Growth,growth_stage_code.not.is.null");
  if (error) throw error;
  return (data ?? []).map((r: any) => mapRow(r, paddockMap));
}

export async function fetchGrowthStageRecords(
  vineyardId: string,
): Promise<GrowthStageRecord[]> {
  const paddockMap = await fetchPaddockMap(vineyardId);
  const fromView = await fetchFromView(vineyardId, paddockMap);
  if (fromView) return fromView;
  return fetchFromPins(vineyardId, paddockMap);
}

export interface BlockSummaryRow {
  paddock_id: string;
  paddock_name: string;
  variety: string | null;
  latest_stage: string | null;
  latest_date: string | null;
  days_since: number | null;
}

export function summariseLatestByBlock(rows: GrowthStageRecord[]): BlockSummaryRow[] {
  const byBlock = new Map<string, GrowthStageRecord>();
  for (const r of rows) {
    if (!r.paddock_id) continue;
    const existing = byBlock.get(r.paddock_id);
    if (!existing || (r.date ?? "") > (existing.date ?? "")) {
      byBlock.set(r.paddock_id, r);
    }
  }
  const now = Date.now();
  return Array.from(byBlock.values())
    .map((r) => {
      const t = r.date ? new Date(r.date).getTime() : NaN;
      const days = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
      return {
        paddock_id: r.paddock_id!,
        paddock_name: r.paddock_name ?? "—",
        variety: r.variety ?? null,
        latest_stage: r.growth_stage_code ?? null,
        latest_date: r.date ?? null,
        days_since: days,
      };
    })
    .sort((a, b) => a.paddock_name.localeCompare(b.paddock_name));
}

export function toCsv(rows: GrowthStageRecord[], operatorName: (id?: string | null) => string): string {
  const headers = ["date", "block", "variety", "el_stage", "el_label", "notes", "created_by"];
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.date ? new Date(r.date).toISOString().slice(0, 10) : "",
      r.paddock_name ?? "",
      r.variety ?? "",
      r.growth_stage_code ?? "",
      r.growth_stage_label ?? "",
      r.notes ?? "",
      operatorName(r.created_by),
    ].map(esc).join(","));
  }
  return lines.join("\n");
}
