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

function describeBox(label: string, box: any): SeedingBox | null {
  if (!box || typeof box !== "object") return null;
  const keys = Object.keys(box).filter((k) => box[k] != null && box[k] !== "");
  if (keys.length === 0) return null;
  return {
    name: label,
    contents: pick(box, "contents", "seed", "product", "mix"),
    rate: pick(box, "rate", "rate_kg_per_ha", "rate_per_ha", "rateKgPerHa"),
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
    kg_per_ha: pick(m, "kg_per_ha", "kgPerHa", "rate_kg_per_ha"),
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
): Record<string, string> {
  const cov = summarizeCoverage(t);
  return {
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

function ensureSpace(doc: jsPDF, y: number, needed: number, marginBottom = 56): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - marginBottom) {
    doc.addPage();
    return 56;
  }
  return y;
}

function sectionHeader(doc: jsPDF, title: string, y: number): number {
  y = ensureSpace(doc, y, 28);
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(0);
  doc.text(title, 40, y);
  return y + 6;
}

function tripTitle(ctx: TripPdfContext, t: Trip): string {
  const fn = ctx.tripFunctionLabel ?? (t.trip_function ?? null);
  return fn ? `Trip Report — ${fn}` : "Trip Report";
}

export function buildTripPdf(t: Trip, ctx: TripPdfContext): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 48;

  // 1. Title
  doc.setFont("helvetica", "bold").setFontSize(18);
  doc.text(tripTitle(ctx, t), 40, y);
  y += 24;

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
    ["Trip details", fmt(t.trip_title)],
    ["Operator", fmt(t.person_name)],
    ["Date", fmtDate(t.start_time)],
    ["Start time", fmtTime(t.start_time)],
    ["Finish time", fmtTime(t.end_time)],
    ["Duration", fmtDuration(t.start_time, t.end_time)],
    ["Distance", fmtDistance(t.total_distance)],
    ["Average speed", fmtAvgSpeed(t.total_distance, t.start_time, t.end_time)],
    ["Pattern", fmt(t.tracking_pattern)],
    ["Pins logged", ctx.pinCount == null ? fmt(len(t.pin_ids) || null) : String(ctx.pinCount)],
  ];
  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [50, 50, 50] },
    columnStyles: { 0: { cellWidth: 130, fontStyle: "bold" } },
    head: [["Field", "Value"]],
    body: tripDetailsRows,
  });
  y = (doc as any).lastAutoTable.finalY + 18;

  // 3. Seeding Details (only when applicable)
  const seeding = parseSeeding(t.seeding_details);
  if (seeding && t.trip_function === "seeding") {
    y = sectionHeader(doc, "Seeding Details", y);
    const body: [string, string][] = [];
    if (seeding.sowing_depth_cm != null)
      body.push(["Sowing depth", `${seeding.sowing_depth_cm} cm`]);
    body.push(["Front box used", seeding.front_used ? "Yes" : "No"]);
    body.push(["Rear box used", seeding.back_used ? "Yes" : "No"]);
    autoTable(doc, {
      startY: y,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: { 0: { cellWidth: 130, fontStyle: "bold" } },
      head: [["Field", "Value"]],
      body,
    });
    y = (doc as any).lastAutoTable.finalY + 12;

    for (const b of seeding.boxes) {
      y = ensureSpace(doc, y, 60);
      doc.setFont("helvetica", "bold").setFontSize(10);
      doc.text(b.name, 40, y);
      y += 4;
      autoTable(doc, {
        startY: y,
        theme: "striped",
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 0: { cellWidth: 130, fontStyle: "bold" } },
        body: [
          ["Mix", fmt(b.contents)],
          ["Rate/ha", fmt(b.rate)],
          ["Shutter slide", fmt(b.shutter_slide)],
          ["Bottom flap", fmt(b.bottom_flap)],
          ["Metering wheel", fmt(b.metering_wheel)],
          ["Seed volume", fmt(b.seed_volume)],
          ["Gearbox setting", fmt(b.gearbox_setting)],
        ].filter(([, v]) => v !== "—" || true),
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }

    if (seeding.mix_lines.length > 0) {
      y = ensureSpace(doc, y, 40);
      doc.setFont("helvetica", "bold").setFontSize(10);
      doc.text("Mix Lines", 40, y);
      y += 4;
      autoTable(doc, {
        startY: y,
        theme: "grid",
        styles: { fontSize: 9, cellPadding: 3 },
        head: [["Name", "% of mix", "Seed box", "Kg/ha", "Supplier"]],
        body: seeding.mix_lines.map((m) => [
          fmt(m.name),
          fmt(m.percent),
          fmt(m.seed_box),
          fmt(m.kg_per_ha),
          fmt(m.supplier),
        ]),
      });
      y = (doc as any).lastAutoTable.finalY + 18;
    }
  }

  // 4. Rows / Paths Covered
  const cov = summarizeCoverage(t);
  y = sectionHeader(doc, "Rows / Paths Covered", y);
  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 4 },
    head: [["Total planned", "Completed", "Partial", "Missed", "Manually marked complete"]],
    body: [[
      String(cov.totalPlanned),
      String(cov.completed),
      String(cov.partial),
      String(cov.skipped),
      String(cov.manuallyMarkedComplete),
    ]],
  });
  y = (doc as any).lastAutoTable.finalY + 18;

  // 5. Tank Sessions (spray only)
  if (t.trip_function === "spraying") {
    const sessions = parseTankSessions(t.tank_sessions);
    if (sessions.length > 0) {
      y = sectionHeader(doc, "Tank Sessions", y);
      autoTable(doc, {
        startY: y,
        theme: "striped",
        styles: { fontSize: 9, cellPadding: 4 },
        head: [["Tank #", "Status", "Rows covered", "Duration", "Fill duration"]],
        body: sessions.map((s) => [s.number, s.status, s.rows, s.duration, s.fillDuration]),
      });
      y = (doc as any).lastAutoTable.finalY + 18;
    }
  }

  // 6. Manual Corrections
  const corrections = parseCorrections(t.manual_correction_events);
  if (corrections.length > 0) {
    y = sectionHeader(doc, "Manual Corrections", y);
    autoTable(doc, {
      startY: y,
      theme: "striped",
      styles: { fontSize: 9, cellPadding: 4 },
      head: [["Time", "Event"]],
      body: corrections.map((c) => [fmtTimeOnly(c.timestamp) ?? "—", c.label]),
    });
    y = (doc as any).lastAutoTable.finalY + 18;
  }

  // 7. Costs — placeholder section (only render if trip carries cost data)
  const costs = (t as any).costs ?? (t as any).cost_lines;
  if (Array.isArray(costs) && costs.length > 0) {
    y = sectionHeader(doc, "Costs", y);
    autoTable(doc, {
      startY: y,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 4 },
      head: [["Item", "Amount"]],
      body: costs.map((c: any) => [
        String(c.label ?? c.name ?? "—"),
        String(c.amount ?? c.value ?? "—"),
      ]),
    });
    y = (doc as any).lastAutoTable.finalY + 18;
  }

  // 8. Route Map
  y = sectionHeader(doc, "Route Map", y);
  const mapH = 240;
  y = ensureSpace(doc, y, mapH + 10);
  const points = extractPathPoints(t.path_points);
  drawRouteMap(doc, points, 40, y, pageW - 80, mapH);
  y += mapH + 12;

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

export function downloadTripPdf(t: Trip, ctx: TripPdfContext) {
  const doc = buildTripPdf(t, ctx);
  const vineyardSeg = safeFileSegment(ctx.vineyardName, "Vineyard");
  const fnSeg = safeFileSegment(ctx.tripFunctionLabel ?? t.trip_function, "Trip");
  const date = (t.start_time ?? t.created_at ?? "").slice(0, 10) || "trip";
  doc.save(`TripReport_${vineyardSeg}_${fnSeg}_${date}.pdf`);
}
