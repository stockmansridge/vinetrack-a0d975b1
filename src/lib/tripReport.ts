// Helpers for Trip Detail / Trip Report rendering and export.
// Pure functions — no I/O beyond jsPDF below.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Trip } from "./tripsQuery";

export interface ParsedCorrection {
  /** Original raw event string, always preserved as fallback. */
  raw: string;
  /** Best-effort timestamp ISO string, if found. */
  timestamp?: string;
  /** Friendly human-readable label. */
  label: string;
}

const TIME_RE = /\bat\s+(\d{4}-\d{2}-\d{2}T[\d:.+-]+)/i;

function fmtTimeOnly(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Parse one manual_correction_events string into a friendly label.
 * Always falls back to the raw string when the format is unfamiliar.
 *
 * Known patterns from iOS:
 *   "manual_next_path: 4.5 at 2026-05-08T09:48:00+10:00"
 *   "manual_back_path: 4.5 at ..."
 *   "auto_realign_accepted: 4.5 at ..."
 *   "auto_realign_ignored: 4.5 at ..."
 *   "end_review_completed: [10.5, 11] at ..."
 *   "end_review_finalised at ..."
 */
export function parseCorrection(raw: string): ParsedCorrection {
  const tsMatch = raw.match(TIME_RE);
  const timestamp = tsMatch?.[1];
  const head = raw.split(" at ")[0].trim();
  const [keyRaw, valueRaw] = head.split(":").map((s) => s?.trim());
  const value = valueRaw ?? "";

  let label = raw;
  switch (keyRaw) {
    case "manual_next_path":
      label = `Operator advanced to next row/path ${value}`;
      break;
    case "manual_back_path":
      label = `Operator went back to row/path ${value}`;
      break;
    case "auto_realign_accepted":
      label = `Accepted auto-realign to row/path ${value}`;
      break;
    case "auto_realign_ignored":
      label = `Ignored auto-realign suggestion (row/path ${value})`;
      break;
    case "end_review_completed": {
      const list = value.replace(/^\[|\]$/g, "").trim();
      label = list
        ? `Row/path ${list} manually marked complete at end review`
        : `Rows manually marked complete at end review`;
      break;
    }
    case "end_review_skipped": {
      const list = value.replace(/^\[|\]$/g, "").trim();
      label = list
        ? `Row/path ${list} marked skipped at end review`
        : `Rows marked skipped at end review`;
      break;
    }
    case "end_review_finalised":
    case "end_review_finalized":
      label = "End trip review finalised";
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
  name: string; // e.g. "Front box"
  contents?: string;
  rate?: string;
  notes?: string;
  raw: any;
}

export interface ParsedSeeding {
  boxes: SeedingBox[];
  sowing_depth_cm?: number | null;
  mix_lines: string[];
}

function describeBox(label: string, box: any): SeedingBox | null {
  if (!box || typeof box !== "object") return null;
  const keys = Object.keys(box).filter((k) => box[k] != null && box[k] !== "");
  if (keys.length === 0) return null;
  return {
    name: label,
    contents: box.contents ?? box.seed ?? box.product ?? undefined,
    rate: box.rate ?? box.rate_kg_per_ha ?? box.rate_per_ha ?? undefined,
    notes: box.notes ?? undefined,
    raw: box,
  };
}

export function parseSeeding(details: any): ParsedSeeding | null {
  if (!details || typeof details !== "object") return null;
  const boxes: SeedingBox[] = [];
  const front = describeBox("Front box", details.front_box);
  const back = describeBox("Back box", details.back_box);
  if (front) boxes.push(front);
  if (back) boxes.push(back);
  const mixLinesRaw = Array.isArray(details.mix_lines) ? details.mix_lines : [];
  const mix_lines = mixLinesRaw
    .map((m: any) => (typeof m === "string" ? m : JSON.stringify(m)))
    .filter(Boolean);
  const depth =
    details.sowing_depth_cm ??
    details.sowingDepthCm ??
    details.depth_cm ??
    null;
  if (boxes.length === 0 && mix_lines.length === 0 && depth == null) return null;
  return { boxes, sowing_depth_cm: depth, mix_lines };
}

// ---------- Coverage summary ----------

function len(v: any): number {
  return Array.isArray(v) ? v.length : 0;
}

/** Heuristic: end_review_completed lists in correction events = manually marked complete count. */
export function manuallyCompletedCount(events?: string[] | null): number {
  if (!Array.isArray(events)) return 0;
  let n = 0;
  for (const e of events) {
    if (typeof e !== "string") continue;
    if (e.startsWith("end_review_completed:")) {
      const head = e.split(" at ")[0];
      const inside = head.split(":")[1]?.trim() ?? "";
      const list = inside.replace(/^\[|\]$/g, "").trim();
      if (!list) continue;
      n += list.split(",").length;
    }
  }
  return n;
}

export interface CoverageSummary {
  rowsCovered: number;
  completed: number;
  skipped: number;
  manuallyMarkedComplete: number;
  partial: number;
}

export function summarizeCoverage(t: Trip): CoverageSummary {
  const completed = len(t.completed_paths);
  const skipped = len(t.skipped_paths);
  const rowSeq = len(t.row_sequence);
  const rowsCovered = rowSeq || completed + skipped;
  const manuallyMarkedComplete = manuallyCompletedCount(t.manual_correction_events);
  const partial = Math.max(0, rowsCovered - completed - skipped);
  return { rowsCovered, completed, skipped, manuallyMarkedComplete, partial };
}

// ---------- Formatting ----------

const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString();
};
const fmtTime = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime())
    ? v
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const fmtDuration = (start?: string | null, end?: string | null) => {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
    rows_covered: String(cov.rowsCovered),
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
}

export function buildTripPdf(t: Trip, ctx: TripPdfContext): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const cov = summarizeCoverage(t);
  let y = 48;

  doc.setFont("helvetica", "bold").setFontSize(16);
  doc.text("Trip Report", 40, y);
  y += 22;
  doc.setFont("helvetica", "normal").setFontSize(11);
  doc.text(ctx.tripDisplay, 40, y);
  y += 16;

  // Job record table
  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [50, 50, 50] },
    head: [["Field", "Value"]],
    body: [
      ["Trip type / function", ctx.tripFunctionLabel ?? t.trip_function ?? "—"],
      ["Title / details", t.trip_title ?? "—"],
      ["Date", fmtDate(t.start_time)],
      ["Start time", fmtTime(t.start_time)],
      ["Finish time", fmtTime(t.end_time)],
      ["Duration", fmtDuration(t.start_time, t.end_time)],
      ["Paddock / block", ctx.paddockName ?? "—"],
      ["Tracking pattern", fmt(t.tracking_pattern)],
      ["Person", fmt(t.person_name)],
      ["Total distance (m)", t.total_distance == null ? "—" : String(t.total_distance)],
    ],
  });
  y = (doc as any).lastAutoTable.finalY + 20;

  // Coverage
  doc.setFont("helvetica", "bold").setFontSize(12);
  doc.text("Rows / paths", 40, y);
  y += 8;
  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 4 },
    head: [["Rows covered", "Completed", "Partial", "Skipped", "Manually completed"]],
    body: [[
      String(cov.rowsCovered),
      String(cov.completed),
      String(cov.partial),
      String(cov.skipped),
      String(cov.manuallyMarkedComplete),
    ]],
  });
  y = (doc as any).lastAutoTable.finalY + 20;

  // Manual corrections
  const corrections = parseCorrections(t.manual_correction_events);
  if (corrections.length > 0) {
    doc.setFont("helvetica", "bold").setFontSize(12);
    doc.text("Manual corrections", 40, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      theme: "striped",
      styles: { fontSize: 9, cellPadding: 4 },
      head: [["Time", "Event"]],
      body: corrections.map((c) => [fmtTimeOnly(c.timestamp) ?? "—", c.label]),
    });
    y = (doc as any).lastAutoTable.finalY + 20;
  }

  // Seeding
  const seeding = parseSeeding(t.seeding_details);
  if (seeding) {
    doc.setFont("helvetica", "bold").setFontSize(12);
    doc.text("Seeding details", 40, y);
    y += 8;
    const body: string[][] = [];
    seeding.boxes.forEach((b) => {
      body.push([b.name, [b.contents, b.rate, b.notes].filter(Boolean).join(" · ") || "—"]);
    });
    if (seeding.sowing_depth_cm != null) {
      body.push(["Sowing depth", `${seeding.sowing_depth_cm} cm`]);
    }
    seeding.mix_lines.forEach((line, i) => body.push([`Mix line ${i + 1}`, line]));
    autoTable(doc, {
      startY: y,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 4 },
      head: [["Field", "Value"]],
      body,
    });
  }

  return doc;
}

export function downloadTripPdf(t: Trip, ctx: TripPdfContext) {
  const doc = buildTripPdf(t, ctx);
  const safe = (ctx.tripDisplay || "trip").replace(/[^\w\-]+/g, "_").slice(0, 40);
  const date = (t.start_time ?? t.created_at ?? "").slice(0, 10) || "trip";
  doc.save(`trip_${date}_${safe}.pdf`);
}
