// Scout Report PDF export (read-only).
//
// Multi-page A4 export of one synced scout visit: branding, visit info,
// captured weather snapshots, every stop (never flattened), recorded
// observation values/notes, photo evidence and measured GPS locations.
//
// Honesty rules:
//  * value_label snapshots are printed verbatim.
//  * Weather comes only from stored snapshots; missing/stale snapshots are
//    labelled, never replaced with current weather.
//  * Locations print measured coordinates or "Location unavailable" — never
//    a fabricated or block-centroid coordinate.
//  * Anything that could not be included (e.g. an unreadable photo) is
//    disclosed in an Omissions section.
import jsPDF from "jspdf";
import {
  loadSprayReportBranding,
  type SprayReportBranding,
} from "@/lib/sprayReportBranding";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import {
  locationLabel,
  stopCoord,
  stopLabel,
  stopTime,
  stopWeather,
  type ScoutAssessment,
  type ScoutObservation,
  type ScoutObservationPhoto,
  type ScoutVisit,
} from "@/lib/scoutReports";

const MARGIN = 48;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 40;

export interface ScoutPdfStop {
  assessment: ScoutAssessment;
  blockName: string | null;
  observations: ScoutObservation[];
  photosByObservation: Map<string, ScoutObservationPhoto[]>;
  /** observation photo id -> data URL, only for photos that loaded. */
  photoImages: Map<string, string>;
  /** linked growth record ids verified as canonical records. */
  canonicalGrowthIds: Set<string>;
}

export interface ScoutPdfModel {
  visit: ScoutVisit;
  vineyardName: string;
  stops: ScoutPdfStop[];
  /** Human-readable disclosure lines for anything left out. */
  omissions: string[];
}

interface Ctx {
  doc: jsPDF;
  branding: SprayReportBranding;
  y: number;
}

function ensureSpace(ctx: Ctx, needed: number): void {
  if (ctx.y + needed > PAGE_H - MARGIN - FOOTER_H) {
    ctx.doc.addPage();
    ctx.y = MARGIN;
  }
}

function line(ctx: Ctx, text: string, opts?: { size?: number; bold?: boolean; gap?: number }) {
  const size = opts?.size ?? 10;
  ctx.doc.setFontSize(size);
  ctx.doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
  const wrapped: string[] = ctx.doc.splitTextToSize(text, CONTENT_W);
  // True line-by-line pagination: a wrapped paragraph longer than one page
  // must flow across pages instead of overflowing past the footer.
  for (const w of wrapped) {
    ensureSpace(ctx, size + 2);
    ctx.doc.text(w, MARGIN, ctx.y);
    ctx.y += size + 2;
  }
  ctx.y += opts?.gap ?? 4;
}

function section(ctx: Ctx, title: string) {
  ensureSpace(ctx, 30);
  ctx.y += 6;
  ctx.doc.setDrawColor(200, 200, 200);
  ctx.doc.line(MARGIN, ctx.y, PAGE_W - MARGIN, ctx.y);
  ctx.y += 14;
  line(ctx, title, { size: 13, bold: true, gap: 6 });
}

function weatherLines(snapshot: Record<string, unknown> | null): string[] {
  if (!snapshot) return ["Weather snapshot: not recorded."];
  const entries = Object.entries(snapshot).filter(
    ([, v]) => v != null && (typeof v !== "object" || Array.isArray(v)),
  );
  if (!entries.length) return ["Weather snapshot: recorded but empty."];
  return entries.map(([k, v]) => `${k}: ${String(v)}`);
}

function photoCaption(p: ScoutObservationPhoto): string {
  const bits = [
    p.captured_at ? `captured ${formatDateTime(p.captured_at)}` : null,
    locationLabel(p),
  ].filter(Boolean);
  return bits.join(" — ");
}

function renderStop(ctx: Ctx, stop: ScoutPdfStop, index: number) {
  const a = stop.assessment;
  section(ctx, `${stopLabel(a, index)}${stop.blockName ? ` — ${stop.blockName}` : ""}`);
  line(ctx, `Status: ${a.status}`, { gap: 2 });
  const t = stopTime(a);
  line(ctx, `Stop time: ${t ? formatDateTime(t) : "not recorded"}`, { gap: 2 });
  for (const w of weatherLines(stopWeather(a))) line(ctx, w, { size: 9, gap: 2 });

  if (!stop.observations.length) {
    line(ctx, "No observations recorded at this stop.", { size: 9, gap: 2 });
    return;
  }

  for (const obs of stop.observations) {
    ensureSpace(ctx, 60);
    ctx.y += 6;
    const value = obs.value_label ?? obs.value_code ?? "No value recorded";
    line(ctx, `${obs.item_kind}: ${value}`, { size: 10, bold: true, gap: 2 });
    if (obs.notes) line(ctx, `Notes: ${obs.notes}`, { size: 9, gap: 2 });
    line(ctx, `Location: ${locationLabel(obs)}`, { size: 9, gap: 2 });
    if (obs.linked_growth_record_id) {
      const verified = stop.canonicalGrowthIds.has(obs.linked_growth_record_id);
      line(
        ctx,
        verified
          ? "Linked growth stage record: verified canonical record."
          : "Linked growth stage: stored snapshot only — the canonical record could not be verified.",
        { size: 9, gap: 2 },
      );
    }
    if (obs.linked_pin_id) line(ctx, "Linked to a vineyard pin.", { size: 9, gap: 2 });

    const photos = stop.photosByObservation.get(obs.id) ?? [];
    for (const p of photos) {
      const img = stop.photoImages.get(p.id);
      ensureSpace(ctx, img ? 170 : 20);
      if (img) {
        try {
          ctx.doc.addImage(img, "JPEG", MARGIN, ctx.y, 220, 150);
          ctx.y += 154;
        } catch {
          line(ctx, `Photo could not be embedded (${photoCaption(p)}).`, { size: 9, gap: 2 });
        }
      } else {
        line(ctx, `Photo not available for export (${photoCaption(p)}).`, { size: 9, gap: 2 });
      }
    }
  }
}

function brandPages(doc: jsPDF, branding: SprayReportBranding, vineyardName: string) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    if (branding.vineyardLogo) {
      try {
        doc.addImage(branding.vineyardLogo.dataUrl, "PNG", MARGIN, 16, 72, 24);
      } catch {
        /* text header already present */
      }
    }
    if (branding.vineTrackMark) {
      try {
        doc.addImage(branding.vineTrackMark.dataUrl, "PNG", MARGIN, PAGE_H - 32, 60, 18);
      } catch {
        /* footer mark optional */
      }
    }
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`${vineyardName} — Scout Report`, PAGE_W - MARGIN, PAGE_H - 24, { align: "right" });
    doc.text(`Page ${i} of ${total}`, PAGE_W - MARGIN, PAGE_H - 14, { align: "right" });
  }
}

/** Build the PDF document for one visit. Pure rendering — no fetching. */
export function buildScoutReportPdf(model: ScoutPdfModel, branding: SprayReportBranding): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const ctx: Ctx = { doc, branding, y: MARGIN + 24 };
  const { visit } = model;

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Scout Report", MARGIN, MARGIN);
  line(ctx, model.vineyardName, { size: 12, bold: true });

  section(ctx, "Visit");
  line(ctx, `Scout date: ${formatDate(visit.scout_date)}`, { gap: 2 });
  line(ctx, `Vintage: ${visit.vintage_year ?? "not recorded"}`, { gap: 2 });
  line(ctx, `Scout: ${visit.scout_name_snapshot ?? "not recorded"}`, { gap: 2 });
  line(ctx, `Status: ${visit.status}`, { gap: 2 });
  if (visit.visit_summary) line(ctx, `Summary: ${visit.visit_summary}`, { gap: 2 });

  section(ctx, "Visit weather (captured at the time)");
  for (const w of weatherLines(visit.weather_snapshot)) line(ctx, w, { size: 9, gap: 2 });

  section(ctx, "Stops");
  if (!model.stops.length) {
    line(ctx, "No block stops were recorded for this visit.", { size: 9 });
  } else {
    model.stops.forEach((stop, i) => renderStop(ctx, stop, i));
  }

  // Location evidence: the on-screen report shows an interactive map. Map
  // imagery cannot be embedded in this export, so every measured coordinate
  // is listed explicitly and the omitted map is disclosed.
  section(ctx, "Location evidence");
  line(
    ctx,
    "The interactive report map is not embedded in this PDF. Every measured " +
      "coordinate recorded during the visit is listed below; entries marked " +
      "\u201cLocation unavailable\u201d had no GPS fix recorded.",
    { size: 9, gap: 4 },
  );
  model.stops.forEach((stop, i) => {
    const label = stopLabel(stop.assessment, i);
    const sc = stopCoord(stop.assessment);
    line(
      ctx,
      `${label}${stop.blockName ? ` (${stop.blockName})` : ""} — stop: ${
        sc ? `${sc.lat.toFixed(6)}, ${sc.lng.toFixed(6)} (measured)` : "Location unavailable"
      }`,
      { size: 9, gap: 2 },
    );
    for (const obs of stop.observations) {
      line(ctx, `${label} — ${obs.item_kind}: ${locationLabel(obs)}`, { size: 9, gap: 2 });
      for (const p of stop.photosByObservation.get(obs.id) ?? []) {
        line(ctx, `${label} — photo: ${locationLabel(p)}`, { size: 9, gap: 2 });
      }
    }
  });

  if (model.omissions.length) {
    section(ctx, "Omissions and limitations");
    for (const o of model.omissions) line(ctx, `• ${o}`, { size: 9, gap: 2 });
  }
  if (branding.warning) {
    section(ctx, "Branding");
    line(ctx, branding.warning, { size: 9 });
  }

  brandPages(doc, branding, model.vineyardName);
  return doc;
}

export function scoutReportFilename(visit: ScoutVisit): string {
  const date = String(visit.scout_date).slice(0, 10).replace(/[^0-9-]/g, "");
  return `scout-report-${date || "visit"}-${visit.id.slice(0, 8)}.pdf`;
}

/** Load branding for the visit's vineyard; never rejects. */
export async function loadScoutReportBranding(vineyardId: string): Promise<SprayReportBranding> {
  try {
    return await loadSprayReportBranding(vineyardId);
  } catch {
    return { vineyardLogo: null, vineTrackMark: null, warning: null };
  }
}
