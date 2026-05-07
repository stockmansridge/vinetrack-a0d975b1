// Rainfall data access.
//
// Uses ONLY the safe RPC `public.get_daily_rainfall(p_vineyard_id, p_from_date, p_to_date)`
// exposed by Rork on the iOS Supabase project. We never query
// `rainfall_daily` directly, never call Davis from the browser, and never
// touch service-role keys.
import { supabase } from "@/integrations/ios-supabase/client";

export interface RainfallDay {
  date: string; // ISO YYYY-MM-DD
  rainfall_mm: number | null;
  source: string | null;
  station_name: string | null;
  notes: string | null;
  updated_at: string | null;
}

export type RainfallFetchResult =
  | { ok: true; rows: RainfallDay[]; rpcUsed: string }
  | {
      ok: false;
      reason: "rpc_missing" | "forbidden" | "error";
      message: string;
      rpcUsed: string;
    };

const RPC_NAME = "get_daily_rainfall";
const RPC_SHAPE = `${RPC_NAME}(p_vineyard_id, p_from_date, p_to_date)`;

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function fetchDailyRainfall(
  vineyardId: string,
  fromDate: Date,
  toDate: Date,
): Promise<RainfallFetchResult> {
  const res = await (supabase.rpc as any)(RPC_NAME, {
    p_vineyard_id: vineyardId,
    p_from_date: toDateString(fromDate),
    p_to_date: toDateString(toDate),
  });

  if (res.error) {
    const msg = String(res.error.message ?? "");
    const code = String((res.error as any).code ?? "");
    if (code === "PGRST202" || /not\s*found|does not exist/i.test(msg)) {
      return { ok: false, reason: "rpc_missing", message: msg, rpcUsed: RPC_SHAPE };
    }
    if (code === "42501" || /permission denied|forbidden/i.test(msg)) {
      return { ok: false, reason: "forbidden", message: msg, rpcUsed: RPC_SHAPE };
    }
    return { ok: false, reason: "error", message: msg, rpcUsed: RPC_SHAPE };
  }

  const raw = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
  const rows: RainfallDay[] = raw.map((r: any) => ({
    date: String(r.date ?? r.day ?? r.observation_date ?? ""),
    rainfall_mm:
      r.rainfall_mm ?? r.rain_mm ?? r.total_mm ?? r.amount_mm ?? null,
    source: r.source ?? null,
    station_name: r.station_name ?? r.station ?? null,
    notes: r.notes ?? null,
    updated_at: r.updated_at ?? null,
  }));

  return { ok: true, rows, rpcUsed: RPC_SHAPE };
}

// ---------- Range presets ----------

export type RangePreset =
  | "last7"
  | "last14"
  | "last30"
  | "currentYear"
  | "last365"
  | "custom";

export function rangeForPreset(preset: RangePreset, today = new Date()): { from: Date; to: Date } {
  const to = new Date(today);
  to.setHours(23, 59, 59, 999);
  const from = new Date(today);
  from.setHours(0, 0, 0, 0);

  switch (preset) {
    case "last7":
      from.setDate(from.getDate() - 6);
      return { from, to };
    case "last14":
      from.setDate(from.getDate() - 13);
      return { from, to };
    case "last30":
      from.setDate(from.getDate() - 29);
      return { from, to };
    case "currentYear":
      return { from: new Date(today.getFullYear(), 0, 1), to };
    case "last365":
      from.setDate(from.getDate() - 364);
      return { from, to };
    case "custom":
      return { from, to };
  }
}

// ---------- Source labels ----------

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  davis_weatherlink: "Davis WeatherLink",
  wunderground_pws: "Weather Underground",
  open_meteo: "Open-Meteo fallback",
};

export function sourceLabel(src: string | null | undefined): string {
  if (!src) return "—";
  return SOURCE_LABELS[src] ?? src;
}

// ---------- Summary ----------

export interface RainfallSummary {
  totalMm: number;
  rainDays: number;
  wettest: { date: string; mm: number } | null;
  avgPerRainDay: number | null;
  sources: string[];
  sourceLabel: string;
}

export function summarizeRainfall(rows: RainfallDay[]): RainfallSummary {
  let total = 0;
  let rainDays = 0;
  let wettest: { date: string; mm: number } | null = null;
  const sources = new Set<string>();

  for (const r of rows) {
    const mm = typeof r.rainfall_mm === "number" ? r.rainfall_mm : 0;
    total += mm;
    if (mm > 0) {
      rainDays += 1;
      if (!wettest || mm > wettest.mm) wettest = { date: r.date, mm };
    }
    if (r.source) sources.add(r.source);
  }

  const list = Array.from(sources);
  let label = "No data";
  if (list.length === 1) label = sourceLabel(list[0]);
  else if (list.length > 1) label = `Mixed (${list.map(sourceLabel).join(", ")})`;
  else if (rows.length > 0) label = "Unknown";

  return {
    totalMm: Math.round(total * 10) / 10,
    rainDays,
    wettest,
    avgPerRainDay: rainDays > 0 ? Math.round((total / rainDays) * 10) / 10 : null,
    sources: list,
    sourceLabel: label,
  };
}
