// READ-ONLY query helpers for Growth Stage Records.
//
// Source-of-truth on the iOS Supabase project: there is **no dedicated
// growth-stage records table**. Growth observations are captured as
// `pins` rows with `mode = 'Growth'` (or any growth_stage_code set) —
// see docs/supabase-schema.md §3.7. Variety is held at the paddock
// level via `paddocks.variety_allocations` (jsonb), not on the pin.
//
// Gaps for Rork are tracked in docs/growth-stage-records-contract.md.
import { supabase } from "@/integrations/ios-supabase/client";

export interface GrowthStageRecord {
  id: string;
  vineyard_id: string;
  paddock_id?: string | null;
  paddock_name?: string | null;
  variety?: string | null;
  growth_stage_code?: string | null;
  notes?: string | null;
  date?: string | null; // derived from completed_at ?? created_at
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  completed_at?: string | null;
  photo_path?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  row_number?: number | null;
  side?: string | null;
  title?: string | null;
  category?: string | null;
  mode?: string | null;
  sync_version?: number | null;
}

export interface PaddockLite {
  id: string;
  name?: string | null;
  variety_allocations?: any;
}

const firstVariety = (p: PaddockLite | undefined): string | null => {
  const arr = Array.isArray(p?.variety_allocations) ? p!.variety_allocations : [];
  const v = arr[0]?.variety;
  return v ? String(v) : null;
};

export async function fetchGrowthStageRecords(
  vineyardId: string,
): Promise<GrowthStageRecord[]> {
  // Pins with growth context: either explicit Growth mode or any
  // growth_stage_code set. `or` filter covers both.
  const pinsRes = await supabase
    .from("pins")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .or("mode.eq.Growth,growth_stage_code.not.is.null");
  if (pinsRes.error) throw pinsRes.error;

  const paddocksRes = await supabase
    .from("paddocks")
    .select("id,name,variety_allocations")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (paddocksRes.error) throw paddocksRes.error;

  const paddockMap = new Map<string, PaddockLite>();
  (paddocksRes.data ?? []).forEach((p: any) => paddockMap.set(p.id, p));

  return ((pinsRes.data ?? []) as any[]).map((p) => {
    const pad = p.paddock_id ? paddockMap.get(p.paddock_id) : undefined;
    return {
      id: p.id,
      vineyard_id: p.vineyard_id,
      paddock_id: p.paddock_id ?? null,
      paddock_name: pad?.name ?? null,
      variety: firstVariety(pad),
      growth_stage_code: p.growth_stage_code ?? null,
      notes: p.notes ?? null,
      date: p.completed_at ?? p.created_at ?? null,
      created_at: p.created_at ?? null,
      updated_at: p.updated_at ?? null,
      created_by: p.created_by ?? null,
      updated_by: p.updated_by ?? null,
      completed_at: p.completed_at ?? null,
      photo_path: p.photo_path ?? null,
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      row_number: p.row_number ?? null,
      side: p.side ?? null,
      title: p.title ?? null,
      category: p.category ?? null,
      mode: p.mode ?? null,
      sync_version: p.sync_version ?? null,
    } as GrowthStageRecord;
  });
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
  const headers = ["date", "block", "variety", "el_stage", "notes", "created_by"];
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
      r.notes ?? "",
      operatorName(r.created_by),
    ].map(esc).join(","));
  }
  return lines.join("\n");
}
