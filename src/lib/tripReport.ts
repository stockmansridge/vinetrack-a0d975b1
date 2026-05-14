// Helpers for Trip Detail / Trip Report rendering and export.
// Pure functions — no I/O beyond jsPDF below.
//
// Layout mirrors the iOS Trip Report PDF service:
//   1. Title (dynamic, based on trip_function)
//   2. Trip Details
//   3. Seeding Details (when applicable)
//   4. Rows / Paths Covered
//   5. Tank Sessions (spray trips only)
//   6. Manual Corrections
//   7. Costs (when available)
//   8. Route Map (from path_points)
//   9. Footer
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Trip } from "./tripsQuery";
import type { TripCostBreakdown } from "./tripCosting";
import { fmtCurrency, fmtHa, fmtHours, fmtTonnes } from "./tripCosting";
import logoUrl from "@/assets/vinetrack-leaf.png";
import { composeSatelliteRouteImage } from "./satelliteRouteMap";

// Cache the logo data URL between exports.
let _logoDataUrl: string | null = null;
async function loadLogoDataUrl(): Promise<string | null> {
  if (_logoDataUrl) return _logoDataUrl;
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    _logoDataUrl = dataUrl;
    return dataUrl;
  } catch {
    return null;
  }
}

// ---------- Manual corrections parsing ----------

export interface ParsedCorrection {
  raw: string;
  timestamp?: string;
  label: string;
}

const TIME_RE = /\bat\s+(\d{4}-\d{2}-\d{2}T[\d:.+-]+)/i;

function fmtTimeOnly(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Parse one manual_correction_events string into a friendly label. */
export function parseCorrection(raw: string): ParsedCorrection {
  const tsMatch = raw.match(TIME_RE);
  const timestamp = tsMatch?.[1];
  const head = raw.split(" at ")[0].trim();
  const [keyRaw, valueRaw] = head.split(":").map((s) => s?.trim());
  const value = valueRaw ?? "";
  const stripBrackets = (v: string) => v.replace(/^\[|\]$/g, "").trim();

  let label = raw;
  switch (keyRaw) {
    case "manual_next_path":
      label = `Operator advanced to next row ${value}`.trim();
      break;
    case "manual_back_path":
      label = `Stepped back to row ${value}`.trim();
      break;
    case "manual_complete":
      label = `Row ${value} manually marked complete`.trim();
      break;
    case "manual_skip":
      label = `Row ${value} manually skipped`.trim();
      break;
    case "confirm_locked_path":
      label = `Operator confirmed current row ${value}`.trim();
      break;
    case "snap_to_live_path":
      label = `Snapped planned sequence to live row ${value}`.trim();
      break;
    case "auto_realign_accepted":
      label = `Auto-realign accepted for row ${value}`.trim();
      break;
    case "auto_realign_ignored":
      label = `Auto-realign ignored for row ${value}`.trim();
      break;
    case "paddocks_added":
      label = `Added blocks ${value}`.trim();
      break;
    case "end_review_completed": {
      const list = stripBrackets(value);
      label = list
        ? `End-review marked complete: row ${list}`
        : "End-review manually marked complete";
      break;
    }
    case "end_review_skipped": {
      const list = stripBrackets(value);
      label = list ? `End-review skipped: row ${list}` : "End-review skipped";
      break;
    }
    case "end_review_finalised":
    case "end_review_finalized":
      label = "End-trip review finalised";
      break;
    default:
      label = head || raw;
  }
  return { raw, timestamp, label };
}

export function parseCorrections(events?: string[] | null): ParsedCorrection[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  return events.map((e) => parseCorrection(String(e)));
}

export function formatCorrectionLine(c: ParsedCorrection): string {
  const t = fmtTimeOnly(c.timestamp);
  return t ? `${t} — ${c.label}` : c.label;
}

// Internal recovery / diagnostic event keys we hide from the formal report.
// They flood the log without giving an operator anything actionable.
const INTERNAL_CORRECTION_KEYS = new Set([
  "auto_sequence_recover",
  "auto_sequence_recovered",
  "auto_sequence_advanced",
  "auto_sequence_resync",
  "auto_lock_recover",
  "snap_to_live_path",
  "live_path_resync",
  "kalman_reset",
  "gps_reacquired",
]);

function correctionKey(raw: string): string {
  const head = raw.split(" at ")[0].trim();
  return head.split(":")[0]?.trim() ?? "";
}

function correctionValue(raw: string): string {
  const head = raw.split(" at ")[0].trim();
  return head.split(":").slice(1).join(":").trim();
}

export interface CorrectionGroup {
  /** Either a single parsed event or a collapsed summary. */
  timestampLabel: string;
  label: string;
  count: number;
  hidden: boolean;
}

/**
 * Build the rows shown in the PDF's Manual Corrections section:
 *  - Drop purely internal recovery/diagnostic events.
 *  - Collapse runs of repeated keys (e.g. dozens of `auto_sequence_recover`)
 *    into a single readable summary line.
 *  - Preserve operator-meaningful events (manual_complete, end_review_*,
 *    paddocks_added, auto_realign_*).
 */
export function summariseCorrections(events?: string[] | null): CorrectionGroup[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  const visible: { raw: string; key: string; parsed: ParsedCorrection }[] = [];
  let hiddenCount = 0;
  let firstHiddenTs: string | undefined;
  for (const e of events) {
    if (typeof e !== "string") continue;
    const key = correctionKey(e);
    if (INTERNAL_CORRECTION_KEYS.has(key)) {
      hiddenCount += 1;
      if (!firstHiddenTs) {
        const ts = e.match(TIME_RE)?.[1];
        if (ts) firstHiddenTs = ts;
      }
      continue;
    }
    visible.push({ raw: e, key, parsed: parseCorrection(e) });
  }

  // Collapse adjacent duplicates (same key + same value) into a single row
  // with a count. Non-adjacent duplicates remain separate so timeline order
  // is preserved.
  const out: CorrectionGroup[] = [];
  for (let i = 0; i < visible.length; i++) {
    const cur = visible[i];
    let count = 1;
    const curVal = correctionValue(cur.raw);
    while (
      i + 1 < visible.length &&
      visible[i + 1].key === cur.key &&
      correctionValue(visible[i + 1].raw) === curVal
    ) {
      count += 1;
      i += 1;
    }
    const t = fmtTimeOnly(cur.parsed.timestamp) ?? "—";
    out.push({
      timestampLabel: t,
      label: count > 1 ? `${cur.parsed.label} (×${count})` : cur.parsed.label,
      count,
      hidden: false,
    });
  }
  if (hiddenCount > 0) {
    out.push({
      timestampLabel: fmtTimeOnly(firstHiddenTs) ?? "—",
      label: `${hiddenCount} internal sequence-recovery event${hiddenCount === 1 ? "" : "s"} hidden`,
      count: hiddenCount,
      hidden: true,
    });
  }
  return out;
}

// ---------- Pattern label ----------

const PATTERN_LABELS: Record<string, string> = {
  everysecondrow: "Every Second Row",
  every_second_row: "Every Second Row",
  everyotherrow: "Every Other Row",
  sequential: "Sequential",
  oneafteranother: "Sequential",
  freedrive: "Free Drive",
  free_drive: "Free Drive",
  threefive: "3/5 Pattern",
  three_five: "3/5 Pattern",
  "3/5": "3/5 Pattern",
  "3_5": "3/5 Pattern",
  fullcoverage: "Full Coverage",
  full_coverage: "Full Coverage",
};

export function formatPatternLabel(p?: string | null): string {
  if (!p) return "—";
  const norm = String(p).trim();
  const key = norm.toLowerCase().replace(/\s+/g, "");
  if (PATTERN_LABELS[key]) return PATTERN_LABELS[key];
  // Fall back: split camelCase / snake_case / kebab-case → Title Case.
  const spaced = norm
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return spaced
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

// ---------- Seeding details ----------

export interface SeedingBox {
  name: string;
  contents?: string;
  rate?: string;
  notes?: string;
  // Detailed iOS spec fields
  shutter_slide?: string;
  bottom_flap?: string;
  metering_wheel?: string;
  seed_volume?: string;
  gearbox_setting?: string;
  raw: any;
}

export interface SeedingMixLine {
  name?: string;
  percent?: string;
  seed_box?: string;
  kg_per_ha?: string;
  supplier?: string;
  raw: any;
}

export interface ParsedSeeding {
  boxes: SeedingBox[];
  sowing_depth_cm?: number | null;
  mix_lines: SeedingMixLine[];
  front_used: boolean;
  back_used: boolean;
}

const pick = (obj: any, ...keys: string[]) => {
  for (const k of keys) {
    if (obj?.[k] != null && obj?.[k] !== "") return String(obj[k]);
  }
  return undefined;
};

function formatRate(v: string | undefined): string | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (/kg\s*\/\s*ha/i.test(s)) return s;
  return /^[\d.]+$/.test(s) ? `${s} kg/ha` : s;
}

function describeBox(label: string, box: any): SeedingBox | null {
  if (!box || typeof box !== "object") return null;
  const keys = Object.keys(box).filter((k) => box[k] != null && box[k] !== "");
  if (keys.length === 0) return null;
  return {
    name: label,
    contents: pick(box, "contents", "seed", "product", "mix", "mix_name", "mixName", "cover_crop", "coverCrop", "name", "label"),
    rate: formatRate(pick(box, "rate", "rate_kg_per_ha", "rate_per_ha", "rateKgPerHa", "rate_kgPerHa")),
    notes: pick(box, "notes"),
    shutter_slide: pick(box, "shutter_slide", "shutterSlide"),
    bottom_flap: pick(box, "bottom_flap", "bottomFlap"),
    metering_wheel: pick(box, "metering_wheel", "meteringWheel"),
    seed_volume: pick(box, "seed_volume", "seedVolume"),
    gearbox_setting: pick(box, "gearbox_setting", "gearboxSetting", "gearbox"),
    raw: box,
  };
}

function describeMixLine(m: any): SeedingMixLine {
  if (typeof m === "string") return { raw: m, name: m };
  return {
    name: pick(m, "name", "species"),
    percent: pick(m, "percent", "percentage", "pct"),
    seed_box: pick(m, "seed_box", "seedBox", "box"),
    kg_per_ha: formatRate(pick(m, "kg_per_ha", "kgPerHa", "rate_kg_per_ha", "rate")),
    supplier: pick(m, "supplier", "manufacturer"),
    raw: m,
  };
}

export function parseSeeding(details: any): ParsedSeeding | null {
  if (!details || typeof details !== "object") return null;
  const front = describeBox("Front box", details.front_box);
  const back = describeBox("Rear box", details.back_box ?? details.rear_box);
  const boxes: SeedingBox[] = [];
  if (front) boxes.push(front);
  if (back) boxes.push(back);
  const mixLinesRaw = Array.isArray(details.mix_lines) ? details.mix_lines : [];
  const mix_lines = mixLinesRaw.map(describeMixLine);
  const depth =
    details.sowing_depth_cm ??
    details.sowingDepthCm ??
    details.depth_cm ??
    null;
  if (boxes.length === 0 && mix_lines.length === 0 && depth == null) return null;
  return {
    boxes,
    sowing_depth_cm: depth,
    mix_lines,
    front_used: !!front,
    back_used: !!back,
  };
}

/**
 * Returns mix lines with `percent` populated. If percent is missing but
 * kg/ha values are present, computes percent within the line's seed box
 * (or across all lines if no box is set). Display-only — never written back.
 */
export function withCalculatedPercents(lines: SeedingMixLine[]): SeedingMixLine[] {
  if (!Array.isArray(lines) || lines.length === 0) return lines;
  // Group by normalised seed_box label (default "_all" when unset).
  const groups = new Map<string, { total: number; lines: SeedingMixLine[] }>();
  for (const l of lines) {
    const key = (l.seed_box ?? "").trim().toLowerCase() || "_all";
    const kg = Number(l.kg_per_ha);
    const g = groups.get(key) ?? { total: 0, lines: [] };
    if (Number.isFinite(kg) && kg > 0) g.total += kg;
    g.lines.push(l);
    groups.set(key, g);
  }
  return lines.map((l) => {
    if (l.percent != null && l.percent !== "") return l;
    const key = (l.seed_box ?? "").trim().toLowerCase() || "_all";
    const g = groups.get(key);
    const kg = Number(l.kg_per_ha);
    if (!g || g.total <= 0 || !Number.isFinite(kg) || kg <= 0) return l;
    return { ...l, percent: `${((kg / g.total) * 100).toFixed(1)}%` };
  });
}


// ---------- Coverage summary ----------

function len(v: any): number {
  return Array.isArray(v) ? v.length : 0;
}

export function manuallyCompletedCount(events?: string[] | null): number {
  if (!Array.isArray(events)) return 0;
  let n = 0;
  for (const e of events) {
    if (typeof e !== "string") continue;
    if (e.startsWith("end_review_completed:") || e.startsWith("manual_complete:")) {
      const head = e.split(" at ")[0];
      const inside = head.split(":").slice(1).join(":").trim();
      const list = inside.replace(/^\[|\]$/g, "").trim();
      if (!list) continue;
      n += list.split(",").length;
    }
  }
  return n;
}

export interface CoverageSummary {
  totalPlanned: number;
  rowsCovered: number;
  completed: number;
  skipped: number;
  manuallyMarkedComplete: number;
  partial: number;
}

export function summarizeCoverage(t: Trip): CoverageSummary {
  const completed = len(t.completed_paths);
  const skipped = len(t.skipped_paths);
  const totalPlanned = len(t.row_sequence);
  const rowsCovered = completed + skipped;
  const manuallyMarkedComplete = manuallyCompletedCount(t.manual_correction_events);
  const partial = Math.max(0, totalPlanned - completed - skipped);
  return { totalPlanned, rowsCovered, completed, skipped, manuallyMarkedComplete, partial };
}

// ---------- Row-by-row breakdown ----------

const SOURCE_LABELS: Record<string, string> = {
  auto: "Auto",
  automatic: "Auto",
  manual: "Manual",
  manual_complete: "Manual",
  end_review: "End review",
  end_review_completed: "End review",
  system_recovery: "System recovery",
  auto_sequence_recover: "System recovery",
  recovery: "System recovery",
};

function formatSource(s: any): string {
  if (s == null) return "Auto";
  const k = String(s).trim().toLowerCase();
  return SOURCE_LABELS[k] ?? (k ? k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Auto");
}

function pathRowNumber(p: any): string | null {
  if (p == null) return null;
  if (typeof p === "string" || typeof p === "number") return String(p);
  const v =
    p.row_number ?? p.rowNumber ?? p.row ?? p.path_row_number ?? p.number ??
    p.row_label ?? p.rowLabel ?? p.label ?? null;
  return v == null ? null : String(v);
}

function pathPaddockId(p: any): string | null {
  if (!p || typeof p !== "object") return null;
  const v = p.paddock_id ?? p.paddockId ?? p.block_id ?? p.blockId ?? null;
  return v == null ? null : String(v);
}

function pathSource(p: any): string {
  if (!p || typeof p !== "object") return "Auto";
  return formatSource(p.source ?? p.completion_source ?? p.completionSource ?? p.method);
}

function pathKey(p: any): string {
  return `${pathPaddockId(p) ?? ""}|${pathRowNumber(p) ?? ""}`;
}

export interface RowLineEntry {
  row: string;
  status: "complete" | "partial" | "missed";
  source: string;
}
export interface RowBlockGroup {
  blockId: string | null;
  blockName: string;
  total: number;
  complete: number;
  partial: number;
  missed: number;
  rows: RowLineEntry[];
}

export function buildRowsByBlock(
  t: Trip,
  paddockNameById?: Map<string, string | null | undefined>,
): RowBlockGroup[] {
  const planned = Array.isArray(t.row_sequence) ? t.row_sequence : [];
  const completed = Array.isArray(t.completed_paths) ? t.completed_paths : [];
  const skipped = Array.isArray(t.skipped_paths) ? t.skipped_paths : [];

  const completedMap = new Map<string, any>();
  for (const c of completed) completedMap.set(pathKey(c), c);
  const skippedMap = new Map<string, any>();
  for (const s of skipped) skippedMap.set(pathKey(s), s);

  // Use planned as canonical order; if empty fall back to completed+skipped.
  const ordered: any[] = planned.length ? planned : [...completed, ...skipped];

  const groups = new Map<string, RowBlockGroup>();
  for (const p of ordered) {
    const pid = pathPaddockId(p);
    const key = pid ?? "_unknown";
    let name = (pid && paddockNameById?.get(pid)) || (p && (p.paddock_name ?? p.paddockName ?? p.block_name)) || (pid ? "Block" : (t.paddock_name ?? "Rows"));
    let g = groups.get(key);
    if (!g) {
      g = { blockId: pid, blockName: String(name), total: 0, complete: 0, partial: 0, missed: 0, rows: [] };
      groups.set(key, g);
    }
    const k = pathKey(p);
    let status: RowLineEntry["status"];
    let source: string;
    if (completedMap.has(k)) {
      status = "complete";
      source = pathSource(completedMap.get(k));
    } else if (skippedMap.has(k)) {
      status = "missed";
      source = pathSource(skippedMap.get(k));
    } else {
      status = "partial";
      source = pathSource(p);
    }
    g.total += 1;
    if (status === "complete") g.complete += 1;
    else if (status === "missed") g.missed += 1;
    else g.partial += 1;
    g.rows.push({ row: pathRowNumber(p) ?? "—", status, source });
  }
  return Array.from(groups.values());
}

// ---------- Tank sessions ----------

export interface TankSessionRow {
  number: string;
  status: string;
  rows: string;
  duration: string;
  fillDuration: string;
}

function fmtDurationMs(ms?: number | null): string {
  if (ms == null || isNaN(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDurationBetween(a?: string | null, b?: string | null): string {
  if (!a || !b) return "—";
  return fmtDurationMs(new Date(b).getTime() - new Date(a).getTime());
}

export function parseTankSessions(sessions: any): TankSessionRow[] {
  if (!Array.isArray(sessions) || sessions.length === 0) return [];
  return sessions.map((s: any, i: number): TankSessionRow => {
    const num = s?.tank_number ?? s?.tankNumber ?? s?.number ?? i + 1;
    const isComplete =
      s?.is_complete ?? s?.isComplete ?? s?.complete ?? !!(s?.end_time ?? s?.endTime);
    const start = s?.start_time ?? s?.startTime;
    const end = s?.end_time ?? s?.endTime;
    const fillStart = s?.fill_start_time ?? s?.fillStartTime;
    const fillEnd = s?.fill_end_time ?? s?.fillEndTime;
    const rows = Array.isArray(s?.rows_covered ?? s?.rowsCovered)
      ? (s.rows_covered ?? s.rowsCovered).length
      : s?.rows_covered_count ?? s?.rowsCoveredCount ?? "—";
    return {
      number: String(num),
      status: isComplete ? "Complete" : "Active",
      rows: String(rows),
      duration: fmtDurationBetween(start, end),
      fillDuration: fmtDurationBetween(fillStart, fillEnd),
    };
  });
}

// ---------- Path points ----------

export interface LatLng {
  lat: number;
  lng: number;
}

export function extractPathPoints(points: any): LatLng[] {
  if (!Array.isArray(points)) return [];
  const out: LatLng[] = [];
  for (const p of points) {
    if (!p) continue;
    if (Array.isArray(p) && p.length >= 2) {
      const a = Number(p[0]);
      const b = Number(p[1]);
      // Heuristic: if first looks like longitude (out of [-90,90]) treat as [lng,lat]
      if (Math.abs(a) > 90 && Math.abs(b) <= 90) out.push({ lat: b, lng: a });
      else out.push({ lat: a, lng: b });
      continue;
    }
    const lat = Number(p.lat ?? p.latitude ?? p.coord?.lat);
    const lng = Number(p.lng ?? p.lon ?? p.longitude ?? p.coord?.lng ?? p.coord?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
  }
  return out;
}

// ---------- Formatting ----------

const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime())
    ? v
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
const fmtTime = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime())
    ? v
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};
const fmtDuration = (start?: string | null, end?: string | null) => {
  if (!start || !end) return "—";
  return fmtDurationMs(new Date(end).getTime() - new Date(start).getTime());
};
const fmtDistance = (m?: number | null) => {
  if (m == null) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
};
const fmtAvgSpeed = (m?: number | null, start?: string | null, end?: string | null) => {
  if (m == null || !start || !end) return "—";
  const sec = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  if (!isFinite(sec) || sec <= 0) return "—";
  const kmh = (m / 1000) / (sec / 3600);
  return `${kmh.toFixed(1)} km/h`;
};

// ---------- CSV ----------

export function tripToCsvRow(
  t: Trip,
  paddockName: string | null,
  tripDisplay: string,
  tripFunctionLabel: string | null,
  cost?: TripCostBreakdown | null,
): Record<string, string> {
  const cov = summarizeCoverage(t);
  const base: Record<string, string> = {
    id: t.id,
    title: t.trip_title ?? "",
    name: tripDisplay,
    function: tripFunctionLabel ?? t.trip_function ?? "",
    date: fmtDate(t.start_time),
    start_time: fmtTime(t.start_time),
    end_time: fmtTime(t.end_time),
    duration: fmtDuration(t.start_time, t.end_time),
    paddock: paddockName ?? "",
    pattern: t.tracking_pattern ?? "",
    person: t.person_name ?? "",
    total_distance_m: t.total_distance == null ? "" : String(t.total_distance),
    total_planned: String(cov.totalPlanned),
    completed: String(cov.completed),
    partial: String(cov.partial),
    skipped: String(cov.skipped),
    manually_completed: String(cov.manuallyMarkedComplete),
    manual_correction_events: Array.isArray(t.manual_correction_events)
      ? t.manual_correction_events.join(" | ")
      : "",
    seeding_details: t.seeding_details ? JSON.stringify(t.seeding_details) : "",
  };
  if (cost) {
    const num = (n: number | null | undefined) => (n == null || !isFinite(n) ? "" : n.toFixed(2));
    base.active_hours = num(cost.activeHours);
    base.labour_category = cost.labour.categoryName ?? "";
    base.labour_rate_per_hour = num(cost.labour.ratePerHour);
    base.labour_cost = num(cost.labour.cost);
    base.fuel_litres_estimated = num(cost.fuel.litres);
    base.fuel_cost_per_litre = num(cost.fuel.costPerLitre);
    base.fuel_cost = num(cost.fuel.cost);
    base.chemical_cost = num(cost.chemicals.cost);
    base.chemical_lines = String(cost.chemicals.lineCount);
    base.chemical_lines_missing_cost = String(cost.chemicals.missingCostLines);
    base.input_cost = num(cost.inputs.cost);
    base.input_lines = String(cost.inputs.lineCount);
    base.input_lines_missing_cost = String(cost.inputs.missingCostLines);
    base.total_estimated_cost = num(cost.total);
    base.treated_area_ha = num(cost.treatedAreaHa);
    base.cost_per_ha = num(cost.costPerHa);
    base.yield_tonnes = num(cost.yieldTonnes);
    base.cost_per_tonne = num(cost.costPerTonne);
    base.costing_warnings = cost.warnings.join(" | ");
  }
  return base;
}

export function rowsToCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: string) => {
    if (v == null) return "";
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => escape(String(r[h] ?? ""))).join(","));
  return lines.join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- PDF ----------

export interface TripPdfContext {
  paddockName: string | null;
  tripDisplay: string;
  tripFunctionLabel: string | null;
  vineyardName?: string | null;
  blockNames?: string[];
  pinCount?: number | null;
  /** Vineyard logo (signed URL or data URL). Falls back to VineTrack logo. */
  vineyardLogoDataUrl?: string | null;
  /** Block id → name lookup for grouping rows by block. */
  paddockNameById?: Map<string, string | null | undefined>;
  /** Owner/manager-only trip cost breakdown. Caller MUST gate on useCanSeeCosts(). */
  cost?: TripCostBreakdown | null;
}


function drawRouteMap(
  doc: jsPDF,
  points: LatLng[],
  x: number,
  y: number,
  w: number,
  h: number,
) {
  // Frame
  doc.setDrawColor(180);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, h);

  if (points.length < 2) {
    doc.setFont("helvetica", "italic").setFontSize(10).setTextColor(120);
    doc.text(
      "Route map unavailable — no path points recorded.",
      x + w / 2,
      y + h / 2,
      { align: "center", baseline: "middle" },
    );
    doc.setTextColor(0);
    return;
  }

  // Bounds
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const dLat = Math.max(maxLat - minLat, 1e-9);
  const dLng = Math.max(maxLng - minLng, 1e-9);
  const pad = 12;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  // Preserve aspect (rough — mercator-ish at small extents)
  const latMid = (minLat + maxLat) / 2;
  const lngScale = Math.cos((latMid * Math.PI) / 180);
  const ratio = (dLat) / (dLng * lngScale);
  let drawW = innerW;
  let drawH = innerW * ratio;
  if (drawH > innerH) {
    drawH = innerH;
    drawW = innerH / ratio;
  }
  const offX = x + (w - drawW) / 2;
  const offY = y + (h - drawH) / 2;

  const project = (p: LatLng) => {
    const px = offX + ((p.lng - minLng) / dLng) * drawW;
    const py = offY + (1 - (p.lat - minLat) / dLat) * drawH;
    return [px, py] as const;
  };

  // Route polyline
  doc.setDrawColor(30, 90, 200);
  doc.setLineWidth(1.2);
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = project(points[i - 1]);
    const [x2, y2] = project(points[i]);
    doc.line(x1, y1, x2, y2);
  }

  // Start (green) & end (red)
  const [sx, sy] = project(points[0]);
  const [ex, ey] = project(points[points.length - 1]);
  doc.setFillColor(34, 160, 70);
  doc.circle(sx, sy, 3.5, "F");
  doc.setFillColor(210, 50, 50);
  doc.circle(ex, ey, 3.5, "F");

  // Legend
  doc.setFontSize(8).setTextColor(60);
  doc.setFillColor(34, 160, 70);
  doc.circle(x + 8, y + h - 10, 2.5, "F");
  doc.text("Start", x + 14, y + h - 8);
  doc.setFillColor(210, 50, 50);
  doc.circle(x + 44, y + h - 10, 2.5, "F");
  doc.text("Finish", x + 50, y + h - 8);
  doc.setTextColor(0);
}

/** Pick the iOS-synced completion notes using the same fallback as the on-screen Trip Report. */
function pickCompletionNotes(t: Trip): string | null {
  const candidates = [
    (t as any).completion_notes,
    (t as any).notes,
    (t as any).job_notes,
  ];
  for (const v of candidates) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function ensureSpace(doc: jsPDF, y: number, needed: number, marginBottom = 56): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - marginBottom) {
    doc.addPage();
    return 56;
  }
  return y;
}

function sectionHeader(doc: jsPDF, title: string, y: number): number {
  y = ensureSpace(doc, y, 32);
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(30, 60, 40);
  doc.text(title, 40, y);
  doc.setDrawColor(210);
  doc.setLineWidth(0.5);
  doc.line(40, y + 4, doc.internal.pageSize.getWidth() - 40, y + 4);
  doc.setTextColor(0);
  return y + 14;
}

// Render a clean two-column "field / value" list (iOS-style, no dark header).
function renderFieldList(doc: jsPDF, rows: [string, string][], y: number): number {
  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 10, cellPadding: { top: 2, right: 4, bottom: 2, left: 0 }, textColor: 30 },
    columnStyles: {
      0: { cellWidth: 140, textColor: 110 },
      1: { textColor: 20, fontStyle: "bold" as any },
    },
    body: rows,
  });
  return (doc as any).lastAutoTable.finalY + 12;
}

function tripTitle(ctx: TripPdfContext, t: Trip): string {
  const fn = ctx.tripFunctionLabel ?? (t.trip_function ?? null);
  return fn ? `Trip Report — ${fn}` : "Trip Report";
}

export function buildTripPdf(t: Trip, ctx: TripPdfContext & { logoDataUrl?: string | null }): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 48;

  // 1. Header — vineyard logo if available, else VineTrack fallback
  const title = tripTitle(ctx, t);
  const logoSize = 36;
  const headerLogo = ctx.vineyardLogoDataUrl ?? ctx.logoDataUrl ?? null;
  if (headerLogo) {
    try {
      const fmtType = /^data:image\/jpeg/i.test(headerLogo) ? "JPEG" : "PNG";
      doc.addImage(headerLogo, fmtType, 40, y - 26, logoSize, logoSize);
    } catch {
      /* ignore image errors */
    }
  }
  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(0);
  doc.text(title, headerLogo ? 40 + logoSize + 12 : 40, y);
  if (ctx.vineyardName) {
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(110);
    doc.text(ctx.vineyardName, headerLogo ? 40 + logoSize + 12 : 40, y + 14);
    doc.setTextColor(0);
  }
  y += 28;

  // 2. Trip Details
  y = sectionHeader(doc, "Trip Details", y);
  const blocks =
    ctx.blockNames && ctx.blockNames.length
      ? ctx.blockNames.join(", ")
      : ctx.paddockName ?? "—";
  const blockLabel = ctx.blockNames && ctx.blockNames.length > 1 ? "Blocks" : "Block";
  const tripDetailsRows: [string, string][] = [
    ["Vineyard", fmt(ctx.vineyardName)],
    [blockLabel, fmt(blocks)],
    ["Trip type", fmt(ctx.tripFunctionLabel ?? t.trip_function)],
    ["Trip name", fmt(t.trip_title)],
    ["Operator", fmt(t.person_name)],
    ["Date", fmtDate(t.start_time)],
    ["Start time", fmtTime(t.start_time)],
    ["Finish time", fmtTime(t.end_time)],
    ["Duration", fmtDuration(t.start_time, t.end_time)],
    ["Distance", fmtDistance(t.total_distance)],
    ["Average speed", fmtAvgSpeed(t.total_distance, t.start_time, t.end_time)],
    ["Pattern", formatPatternLabel(t.tracking_pattern)],
    ["Pins logged", ctx.pinCount == null ? fmt(len(t.pin_ids) || null) : String(ctx.pinCount)],
  ];
  y = renderFieldList(doc, tripDetailsRows, y);
  y += 6;

  // 2b. Completion Notes (synced from iOS) — same fallback as on-screen Trip Report.
  const completionNotes = pickCompletionNotes(t);
  if (completionNotes) {
    y = sectionHeader(doc, "Completion Notes", y);
    const pageW2 = doc.internal.pageSize.getWidth();
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(30);
    const lines = doc.splitTextToSize(completionNotes, pageW2 - 80) as string[];
    for (const line of lines) {
      y = ensureSpace(doc, y, 14);
      doc.text(line, 40, y);
      y += 14;
    }
    y += 6;
  }

  // 3. Seeding Details (only when applicable)
  const seeding = parseSeeding(t.seeding_details);
  if (seeding && t.trip_function === "seeding") {
    y = sectionHeader(doc, "Seeding Details", y);
    const overview: [string, string][] = [];
    if (seeding.sowing_depth_cm != null) overview.push(["Sowing depth", `${seeding.sowing_depth_cm} cm`]);
    overview.push(["Front box used", seeding.front_used ? "Yes" : "No"]);
    overview.push(["Rear box used", seeding.back_used ? "Yes" : "No"]);
    y = renderFieldList(doc, overview, y);

    for (const b of seeding.boxes) {
      y = ensureSpace(doc, y, 80);
      y = sectionHeader(doc, b.name, y);
      const rows: [string, string][] = [
        ["Mix", fmt(b.contents)],
        ["Rate/ha", fmt(b.rate)],
        ["Shutter slide", fmt(b.shutter_slide)],
        ["Bottom flap", fmt(b.bottom_flap)],
        ["Metering wheel", fmt(b.metering_wheel)],
        ["Seed volume", fmt(b.seed_volume)],
        ["Gearbox setting", fmt(b.gearbox_setting)],
      ];
      y = renderFieldList(doc, rows, y);
    }

    if (seeding.mix_lines.length > 0) {
      y = ensureSpace(doc, y, 60);
      y = sectionHeader(doc, "Mix Lines", y);
      const mixWithPct = withCalculatedPercents(seeding.mix_lines);
      mixWithPct.forEach((m, idx) => {
        y = ensureSpace(doc, y, 64);
        doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(20);
        doc.text(`Line ${idx + 1}${m.name ? ` — ${m.name}` : ""}`, 40, y);
        y += 4;
        const rows: [string, string][] = [
          ["% of mix", fmt(m.percent)],
          ["Seed box", fmt(m.seed_box)],
          ["Kg/ha", fmt(m.kg_per_ha)],
        ];
        if (m.supplier) rows.push(["Supplier", fmt(m.supplier)]);
        y = renderFieldList(doc, rows, y);
      });
    }
  }

  // 4. Rows / Paths — row-by-row grouped by block (iOS style).
  y = ensureSpace(doc, y, 60);
  y = sectionHeader(doc, "Rows / Paths", y);
  const groups = buildRowsByBlock(t, ctx.paddockNameById);
  if (groups.length === 0) {
    doc.setFont("helvetica", "italic").setFontSize(10).setTextColor(120);
    doc.text("No row sequence recorded.", 40, y);
    doc.setTextColor(0);
    y += 14;
  } else {
    for (const g of groups) {
      y = ensureSpace(doc, y, 40 + g.rows.length * 14);
      doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(20);
      doc.text(g.blockName, 40, y);
      y += 12;
      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
      doc.text(
        `Total planned ${g.total}   Complete ${g.complete}   Partial ${g.partial}   Missed ${g.missed}`,
        40,
        y,
      );
      y += 12;
      for (const r of g.rows) {
        y = ensureSpace(doc, y, 14);
        // Status indicator: filled circle in green/orange/red
        const color: [number, number, number] =
          r.status === "complete" ? [34, 160, 70] :
          r.status === "partial" ? [220, 150, 30] : [200, 50, 50];
        doc.setFillColor(color[0], color[1], color[2]);
        doc.circle(46, y - 3, 3, "F");
        doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(20);
        const statusLabel =
          r.status === "complete" ? "Complete" :
          r.status === "partial" ? "Partial" : "Not complete";
        doc.text(`${r.row}  ${statusLabel} — ${r.source}`, 56, y);
        y += 12;
      }
      y += 6;
    }
  }

  // 5. Tank Sessions (spray only)
  if (t.trip_function === "spraying") {
    const sessions = parseTankSessions(t.tank_sessions);
    if (sessions.length > 0) {
      y = sectionHeader(doc, "Tank Sessions", y);
      autoTable(doc, {
        startY: y,
        theme: "plain",
        styles: { fontSize: 9, cellPadding: 4, textColor: 30 },
        headStyles: { fontStyle: "bold", textColor: 60, lineWidth: { bottom: 0.5 } as any, lineColor: [200, 200, 200] as any },
        head: [["Tank #", "Status", "Rows covered", "Duration", "Fill duration"]],
        body: sessions.map((s) => [s.number, s.status, s.rows, s.duration, s.fillDuration]),
      });
      y = (doc as any).lastAutoTable.finalY + 18;
    }
  }

  // (Manual Corrections section intentionally removed from customer report.)

  // 6. Estimated trip cost — owner/manager only (caller gates).
  if (ctx.cost) {
    const c = ctx.cost;
    y = sectionHeader(doc, "Estimated trip cost", y);
    const labourLabel = `Labour${c.labour.categoryName ? ` (${c.labour.categoryName})` : ""}`;
    const labourValue =
      c.labour.cost != null
        ? `${fmtCurrency(c.labour.cost)}${c.labour.ratePerHour != null ? ` · ${fmtCurrency(c.labour.ratePerHour)}/h` : ""}`
        : "—";
    const fuelValue =
      c.fuel.cost != null
        ? `${fmtCurrency(c.fuel.cost)}${c.fuel.litres != null ? ` · ${c.fuel.litres.toFixed(1)} L` : ""}${c.fuel.costPerLitre != null ? ` @ ${fmtCurrency(c.fuel.costPerLitre)}/L` : ""}`
        : c.fuel.litres != null
          ? `${c.fuel.litres.toFixed(1)} L (no cost/L on file)`
          : "—";
    const chemLabel = `Chemicals${c.chemicals.lineCount ? ` (${c.chemicals.lineCount} line${c.chemicals.lineCount === 1 ? "" : "s"})` : ""}`;
    const chemValue = c.chemicals.cost != null ? fmtCurrency(c.chemicals.cost) : "—";
    const rows: [string, string][] = [
      ["Active hours", fmtHours(c.activeHours)],
      [labourLabel, labourValue],
      ["Fuel", fuelValue],
      [chemLabel, chemValue],
    ];
    if (c.inputs.lineCount > 0) {
      rows.push([
        `Seed / inputs (${c.inputs.lineCount} line${c.inputs.lineCount === 1 ? "" : "s"})`,
        c.inputs.cost != null ? fmtCurrency(c.inputs.cost) : "—",
      ]);
    }
    rows.push(["Estimated total", c.total != null ? fmtCurrency(c.total) : "—"]);
    rows.push(["Treated area", c.treatedAreaHa != null ? fmtHa(c.treatedAreaHa) : "— (treated area missing)"]);
    rows.push(["Cost per ha", c.costPerHa != null ? fmtCurrency(c.costPerHa) + " / ha" : "Unavailable"]);
    rows.push(["Yield tonnes", c.yieldTonnes != null ? fmtTonnes(c.yieldTonnes) : "Unavailable"]);
    rows.push(["Cost per tonne", c.costPerTonne != null ? fmtCurrency(c.costPerTonne) + " / t" : "Unavailable"]);
    y = renderFieldList(doc, rows, y);
    if (c.warnings.length > 0) {
      y = ensureSpace(doc, y, 20 + c.warnings.length * 12);
      doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(120, 80, 20);
      doc.text("Costing completeness", 40, y);
      y += 12;
      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
      const pageW2 = doc.internal.pageSize.getWidth();
      for (const w of c.warnings) {
        const lines = doc.splitTextToSize(`• ${w}`, pageW2 - 80) as string[];
        for (const line of lines) {
          y = ensureSpace(doc, y, 12);
          doc.text(line, 40, y);
          y += 12;
        }
      }
      doc.setTextColor(0);
    }
    y += 6;
  }

  // 7. Route Map — own page so it stays large and readable.
  doc.addPage();
  let mapY = 56;
  mapY = sectionHeader(doc, "Route Map", mapY);
  const points = extractPathPoints(t.path_points);
  const pageH = doc.internal.pageSize.getHeight();
  const mapW = pageW - 80;
  const mapH = pageH - mapY - 70; // leave room for footer
  const satelliteDataUrl = (ctx as any).satelliteRouteDataUrl as string | null | undefined;
  const satelliteSize = (ctx as any).satelliteRouteSize as { width: number; height: number } | undefined;
  if (satelliteDataUrl && points.length >= 2 && satelliteSize && satelliteSize.width > 0 && satelliteSize.height > 0) {
    try {
      const srcAspect = satelliteSize.width / satelliteSize.height;
      const boxAspect = mapW / mapH;
      let drawW = mapW;
      let drawH = mapH;
      if (srcAspect > boxAspect) {
        drawH = mapW / srcAspect;
      } else {
        drawW = mapH * srcAspect;
      }
      const offX = 40 + (mapW - drawW) / 2;
      const offY = mapY + (mapH - drawH) / 2;
      doc.setFillColor(245, 245, 245);
      doc.rect(40, mapY, mapW, mapH, "F");
      doc.addImage(satelliteDataUrl, "PNG", offX, offY, drawW, drawH);
      doc.setDrawColor(180);
      doc.setLineWidth(0.5);
      doc.rect(40, mapY, mapW, mapH);
    } catch {
      drawRouteMap(doc, points, 40, mapY, mapW, mapH);
    }
  } else {
    if (points.length >= 2 && !satelliteDataUrl) {
      doc.setFont("helvetica", "italic").setFontSize(9).setTextColor(120);
      doc.text("Satellite imagery unavailable — route-only preview shown.", 40, mapY - 2);
      doc.setTextColor(0);
    }
    drawRouteMap(doc, points, 40, mapY, mapW, mapH);
  }

  // 9. Footer (every page)
  const totalPages = doc.getNumberOfPages();
  const tz =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const footer = `Generated ${new Date().toLocaleString()} (${tz}) • VineTrack`;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(120);
    doc.text(footer, 40, doc.internal.pageSize.getHeight() - 24);
    doc.text(
      `Page ${i} of ${totalPages}`,
      pageW - 40,
      doc.internal.pageSize.getHeight() - 24,
      { align: "right" },
    );
    doc.setTextColor(0);
  }

  return doc;
}

function safeFileSegment(s: string | null | undefined, fallback: string): string {
  const v = (s ?? "").trim() || fallback;
  return v.replace(/[^\w\-]+/g, "_").slice(0, 50);
}

async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function downloadTripPdf(
  t: Trip,
  ctx: TripPdfContext & { vineyardLogoUrl?: string | null },
) {
  const logoDataUrl = await loadLogoDataUrl();
  // Resolve vineyard logo (signed URL → data URL) when caller provided one.
  let vineyardLogoDataUrl: string | null = ctx.vineyardLogoDataUrl ?? null;
  if (!vineyardLogoDataUrl && ctx.vineyardLogoUrl) {
    vineyardLogoDataUrl = await urlToDataUrl(ctx.vineyardLogoUrl);
  }
  // Compose satellite route image (best-effort; may return null if tiles fail).
  let satelliteRouteDataUrl: string | null = null;
  let satelliteRouteSize: { width: number; height: number } | null = null;
  try {
    const points = extractPathPoints(t.path_points);
    if (points.length >= 2) {
      const result = await composeSatelliteRouteImage(points, 1100, 660);
      if (result) {
        satelliteRouteDataUrl = result.dataUrl;
        satelliteRouteSize = { width: result.width, height: result.height };
      }
    }
  } catch {
    satelliteRouteDataUrl = null;
  }
  const doc = buildTripPdf(t, {
    ...ctx,
    logoDataUrl,
    vineyardLogoDataUrl,
    satelliteRouteDataUrl,
    satelliteRouteSize,
  } as any);
  const vineyardSeg = safeFileSegment(ctx.vineyardName, "Vineyard");
  const fnSeg = safeFileSegment(ctx.tripFunctionLabel ?? t.trip_function, "Trip");
  const date = (t.start_time ?? t.created_at ?? "").slice(0, 10) || "trip";
  // Append HHMM so duplicate downloads keep clean, customer-facing names
  // (no "(Lovable)" / "(1)" suffix from the browser dedupe logic).
  const now = new Date();
  const stamp = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  doc.save(`TripReport_${vineyardSeg}_${fnSeg}_${date}_${stamp}.pdf`);
}
