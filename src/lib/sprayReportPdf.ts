// Spray Report v1 renderer.
//
// The ONLY semantic input is `SprayReportPayloadV1`. Nothing here parses trip
// or spray-record columns, infers tank attribution, re-derives row status, or
// builds its own weather table — those facts belong to `get_spray_report_v1`.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { AU_FORMATTERS, type RegionFormatters } from "./regionFormatters";
import {
  sprayReportFilename,
  type SprayReportPayloadV1,
  type SprayReportWeather,
} from "./sprayReportV1";
import {
  isManualEntryReport,
  MANUAL_ACTUAL_USE_LABEL,
  MANUAL_NOT_RECORDED_LABEL,
  sprayReportSourceLabel,
} from "./sprayReportV1";
import type { ResolvedRouteImage } from "./sprayReportRoute";
import {
  chemicalTotals,
  costFieldLabel,
  costValueKind,
  formatActual,
  formatPlanned,
  formatTotalActual,
  formatTotalPlanned,
  formatWaterLitres,
  matchSourceLabel,
  rowSourceLabel,
  waterTotals,
} from "./sprayReportQuantities";
import { EMPTY_BRANDING, type SprayReportBranding } from "./sprayReportBranding";
import {
  amendmentValueLabel,
  formatAmendmentTime,
  payloadAmendments,
  type SprayAmendment,
} from "./sprayActuals";
import { dataUrlImageFormat, fitWithin } from "./imageDimensions";




const NR = "Not recorded";
const NOT_ADDED = "Not added";

const txt = (v: unknown): string => (v == null || v === "" ? NR : String(v));

/** Distance is metres in the payload; render in the vineyard's region unit. */
export function formatDistance(metres: number | null, fmt: RegionFormatters): string {
  if (metres == null || !isFinite(metres)) return NR;
  const km = metres / 1000;
  // Values below one unit still render (2 dp) rather than collapsing to "0".
  return fmt.distance(km, km < 1 ? 3 : 2);
}

export function formatActiveDuration(seconds: number | null): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return NR;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function timeInZone(iso: string | null, timeZone: string): string {
  if (!iso) return NR;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return NR;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function hourInZone(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

function weatherRow(w: SprayReportWeather, fmt: RegionFormatters, tz: string): string[] {
  return [
    hourInZone(w.sampleSlot, tz),
    `${w.source || NR}${w.sourceKind && w.sourceKind !== "observed" ? ` (${w.sourceKind})` : ""}${w.isStale ? " · stale" : ""}`,
    w.temperatureC != null ? fmt.temperature(w.temperatureC, 1) : NR,
    w.humidityPct != null ? `${w.humidityPct}%` : NR,
    w.windSpeedKmh != null ? fmt.wind(w.windSpeedKmh, 1) : NR,
    w.windGustKmh != null ? fmt.wind(w.windGustKmh, 1) : NR,
    w.windDirectionDeg != null ? `${w.windDirectionDeg}°` : NR,
    w.rainMm != null ? fmt.rainfall(w.rainMm, 2) : NR,
  ];
}

export interface SprayReportPdfContext {
  formatters?: RegionFormatters;
  routeImage?: ResolvedRouteImage | null;
  /** Honest reason shown in the Route section when no image can be embedded. */
  routeWarning?: string | null;
  /** Trip-vineyard logo (top left) and the VineTrack mark (bottom left). */
  branding?: SprayReportBranding;
  /** Correction history; defaults to whatever the canonical payload carries. */
  amendments?: SprayAmendment[];
}

/** Space reserved at the top of every page so tables never reach the logo. */
const FIRST_PAGE_CONTENT_TOP = 96;
const CONTINUATION_CONTENT_TOP = 74;
/** Space reserved at the bottom for the VineTrack mark and footer text. */
const FOOTER_RESERVED = 62;

export function buildSprayReportPdf(
  payload: SprayReportPayloadV1,
  ctx: SprayReportPdfContext = {},
): jsPDF {
  const fmt = ctx.formatters ?? AU_FORMATTERS;
  const tz = payload.identity.vineyardTimeZone;
  const branding = ctx.branding ?? EMPTY_BRANDING;
  const amendments = ctx.amendments ?? payloadAmendments(payload);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  // Top-left vineyard logo, fitted inside a fixed box so a wide or a tall
  // logo both stay undistorted and inside the reserved header band.
  const logo = branding.vineyardLogo;
  const logoBox = { w: 96, h: 44 };
  const logoSize = logo ? fitWithin(logo.size, logoBox.w, logoBox.h) : null;
  const drawVineyardLogo = (top: number, box: { w: number; h: number }): number => {
    if (!logo) return 0;
    const size = fitWithin(logo.size, box.w, box.h);
    try {
      doc.addImage(
        logo.dataUrl,
        dataUrlImageFormat(logo.dataUrl),
        margin,
        top + (box.h - size.height) / 2,
        size.width,
        size.height,
      );
      return size.width;
    } catch {
      return 0;
    }
  };

  const usedLogoWidth = drawVineyardLogo(24, logoBox);
  const textLeft = usedLogoWidth ? margin + usedLogoWidth + 14 : margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Spray Report", textLeft, 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(
    `${txt(payload.identity.vineyardName)} · ${txt(payload.identity.reference)}`,
    textLeft,
    62,
  );
  doc.text(`Generated: ${fmt.dateTime(new Date())}`, pageWidth - margin, 62, {
    align: "right",
  });
  doc.setDrawColor(200);
  doc.line(margin, 82, pageWidth - margin, 82);
  doc.setTextColor(0);
  void logoSize;


  const blockNames =
    payload.blocks && payload.blocks.length
      ? payload.blocks.map((b) => b.name).join(", ")
      : NR;
  const treated = (payload.blocks ?? []).reduce<number | null>((acc, b) => {
    if (b.treatedAreaHa == null) return acc;
    return (acc ?? 0) + b.treatedAreaHa;
  }, null);
  const gross = (payload.blocks ?? []).reduce<number | null>((acc, b) => {
    if (b.grossAreaHa == null) return acc;
    return (acc ?? 0) + b.grossAreaHa;
  }, null);

  autoTable(doc, {
    startY: FIRST_PAGE_CONTENT_TOP,
    head: [["Field", "Value"]],
    body: [
      ["Start", timeInZone(payload.trip.startUtc, tz)],
      ["End", timeInZone(payload.trip.endUtc, tz)],
      ["Active duration", formatActiveDuration(payload.trip.activeDurationSeconds)],
      ["Distance", formatDistance(payload.trip.distanceMetres, fmt)],
      ["Operator", txt(payload.trip.operatorName)],
      ["Pins recorded", String(payload.trip.pinCount ?? 0)],
      [fmt.blocksLabel, blockNames],
      ["Gross area", gross != null ? fmt.area(gross) : NR],
      ["Treated area", treated != null ? fmt.area(treated) : NR],
      ["Tractor", txt(payload.equipment.tractorName)],
      ["Spray unit", txt(payload.equipment.sprayUnitName)],
      ["Start engine hours", txt(payload.equipment.startEngineHours)],
      ["End engine hours", txt(payload.equipment.endEngineHours)],
      ["Engine hours used", txt(payload.equipment.engineHoursUsed)],
    ],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 5, valign: "top" },
    headStyles: { fillColor: [60, 90, 60], textColor: 255 },
    columnStyles: { 0: { cellWidth: 150, fontStyle: "bold" }, 1: { cellWidth: "auto" } },
    margin: { left: margin, right: margin, top: CONTINUATION_CONTENT_TOP, bottom: FOOTER_RESERVED },
  });
  let y = (doc as any).lastAutoTable.finalY + 18;

  const section = (title: string, need = 120) => {
    if (y > pageHeight - FOOTER_RESERVED - need) {
      doc.addPage();
      y = CONTINUATION_CONTENT_TOP;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(title, margin, y);
    y += 6;
  };

  // Rows
  section("Rows");
  autoTable(doc, {
    startY: y,
    head: [["Row", fmt.blockLabel, "Status", "Tank", "Source"]],
    body: payload.rows.map((r) => [
      String(r.rowNumber),
      txt(r.blockName),
      r.status,
      r.tank == null ? NR : String(r.tank),
      rowSourceLabel(r.source),
    ]),
    theme: "striped",
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [60, 90, 60], textColor: 255 },
    margin: { left: margin, right: margin, top: CONTINUATION_CONTENT_TOP, bottom: FOOTER_RESERVED },
  });
  y = (doc as any).lastAutoTable.finalY + 18;

  // Tanks and chemistry — one readable table per tank, water first, then a
  // canonical totals table. Amounts are converted from the frozen base units
  // exactly once, here, for display only.
  payload.tanks.forEach((t) => {
    section(`Tank ${t.tankNumber}`, 120);
    const body: string[][] = [
      ["Water", formatWaterLitres(t.plannedWaterLitres), formatWaterLitres(t.actualWaterLitres), ""],
      ...t.chemicals.map((c) => [
        c.name,
        formatPlanned(c),
        formatActual(c),
        matchSourceLabel(c.matchSource),
      ]),
    ];
    if (!t.chemicals.length) body.push(["No chemicals recorded", NR, NR, ""]);
    autoTable(doc, {
      startY: y,
      head: [[
        "Item",
        "Planned",
        isManualEntryReport(payload) ? MANUAL_ACTUAL_USE_LABEL : "Actual",
        "Match",
      ]],
      body,
      theme: "striped",
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [60, 90, 60], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 170 },
        1: { cellWidth: 90, halign: "right" },
        2: { cellWidth: 90, halign: "right" },
        3: { cellWidth: "auto" },
      },
      margin: { left: margin, right: margin, top: CONTINUATION_CONTENT_TOP, bottom: FOOTER_RESERVED },
    });
    y = (doc as any).lastAutoTable.finalY + 14;
  });

  if (payload.tanks.length) {
    section("Totals for this application", 120);
    const water = waterTotals(payload.tanks);
    const totalsBody: string[][] = [
      [
        "Water",
        formatWaterLitres(water.planned),
        water.actual == null
          ? NR
          : `${formatWaterLitres(water.actual)}${water.actualIncomplete ? " (partial)" : ""}`,
      ],
      ...chemicalTotals(payload.tanks).map((t) => [
        t.name,
        formatTotalPlanned(t),
        formatTotalActual(t),
      ]),
    ];
    autoTable(doc, {
      startY: y,
      head: [["Item", "Planned total", "Actual total"]],
      body: totalsBody,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [60, 90, 60], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 200, fontStyle: "bold" },
        1: { halign: "right" },
        2: { halign: "right" },
      },
      margin: { left: margin, right: margin, top: CONTINUATION_CONTENT_TOP, bottom: FOOTER_RESERVED },
    });
    y = (doc as any).lastAutoTable.finalY + 18;
  }


  // Hourly weather (append-only, ordered by sampleSlot)
  section("Hourly weather");
  autoTable(doc, {
    startY: y,
    head: [
      [
        "Hour",
        "Source",
        `Temp (${fmt.temperatureUnitLabel})`,
        "Humidity",
        `Wind (${fmt.windUnitLabel})`,
        "Gust",
        "Dir",
        `Rain (${fmt.rainfallUnitLabel})`,
      ],
    ],
    body: payload.weather.length
      ? payload.weather.map((w) => weatherRow(w, fmt, tz))
      : [["No hourly weather recorded", "", "", "", "", "", "", ""]],
    theme: "striped",
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [60, 90, 60], textColor: 255 },
    margin: { left: margin, right: margin, top: CONTINUATION_CONTENT_TOP, bottom: FOOTER_RESERVED },
  });
  y = (doc as any).lastAutoTable.finalY + 18;

  // Route image. A warning is always shown when present, even if a fallback
  // image was embedded, so persistence problems are never hidden.
  if (ctx.routeImage?.dataUrl) {
    const maxW = pageWidth - margin * 2;
    const ratio = ctx.routeImage.height / Math.max(ctx.routeImage.width, 1);
    const w = maxW;
    const h = Math.min(maxW * ratio, 320);
    section("Route", h + 60);
    try {
      doc.addImage(ctx.routeImage.dataUrl, "PNG", margin, y + 6, w, h);
      y += h + 14;
    } catch {
      y += 6;
    }
  }
  // A manual application has no route or row record. That absence is stated
  // explicitly rather than left looking like missing or lost data.
  if (isManualEntryReport(payload)) {
    section("Recording", 74);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(
      [
        `Source: ${sprayReportSourceLabel(payload)}`,
        `Route: ${payload.recordingEvidence?.route ?? MANUAL_NOT_RECORDED_LABEL}`,
        `Rows: ${payload.recordingEvidence?.rows ?? MANUAL_NOT_RECORDED_LABEL}`,
      ],
      margin,
      y + 12,
    );
    doc.setTextColor(0);
    y += 54;
  }

  if (ctx.routeWarning) {
    if (!ctx.routeImage?.dataUrl) section("Route", 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    const lines = doc.splitTextToSize(ctx.routeWarning, pageWidth - margin * 2);
    doc.text(lines, margin, y + 12);
    doc.setTextColor(0);
    y += 12 + lines.length * 12 + 10;
  }



  // Completeness warnings (including an honest branding failure).
  const allWarnings = branding.warning
    ? [...payload.warnings, branding.warning]
    : payload.warnings;
  if (allWarnings.length) {
    section("Completeness warnings", 100);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    const lines = doc.splitTextToSize(
      allWarnings.map((w) => `• ${w}`).join("\n"),
      pageWidth - margin * 2,

    );
    doc.text(lines, margin, y + 12);
    y += lines.length * 11 + 20;
    doc.setTextColor(0);
  }

  // Cost is optional and only returned by the backend to owners and managers.
  if (payload.cost && typeof payload.cost === "object") {
    section("Estimated trip cost", 140);
    const body = Object.entries(payload.cost).map(([k, v]) => {
      if (v == null) return [costFieldLabel(k), NR];
      if (typeof v !== "number") return [costFieldLabel(k), String(v)];
      switch (costValueKind(k)) {
        case "currency":
          return [costFieldLabel(k), fmt.currency(v)];
        case "hours":
          return [costFieldLabel(k), `${v.toFixed(2)} h`];
        case "litres":
          return [costFieldLabel(k), `${v.toFixed(1)} L`];
        case "area":
          return [costFieldLabel(k), fmt.area(v)];
        default:
          return [costFieldLabel(k), String(v)];
      }
    });

    autoTable(doc, {
      startY: y,
      head: [["Field", "Value"]],
      body,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [60, 90, 60], textColor: 255 },
      columnStyles: { 0: { cellWidth: 170, fontStyle: "bold" } },
      margin: { left: margin, right: margin, top: CONTINUATION_CONTENT_TOP, bottom: FOOTER_RESERVED },
    });
    y = (doc as any).lastAutoTable.finalY + 16;
  }

  // Amendment history — who corrected a recorded actual, when, and from what
  // to what. Only present once corrections exist; the original entry is never
  // erased by a later one.
  if (amendments.length) {
    section("Amendment history", 140);
    autoTable(doc, {
      startY: y,
      head: [["When", "Who", "Tank", "Item", "Was", "Now"]],
      body: amendments.map((a) => [
        formatAmendmentTime(a.changedAtUtc, tz),
        a.editorName || NR,
        a.tankNumber == null ? NR : String(a.tankNumber),
        a.chemicalName || "Water",
        amendmentValueLabel(a.previousValue, a.previousUnit),
        amendmentValueLabel(a.newValue, a.newUnit),
      ]),
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [60, 90, 60], textColor: 255 },
      margin: { left: margin, right: margin, top: CONTINUATION_CONTENT_TOP, bottom: FOOTER_RESERVED },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(`Times shown in the vineyard timezone (${tz}).`, margin, y + 8);
    doc.setTextColor(0);
    y += 20;
  }

  // Per-page branding: compact vineyard header on continuation pages, and the
  // official VineTrack mark bottom left with the footer text clear of it.
  const mark = branding.vineTrackMark;
  const markBox = { w: 78, h: 20 };
  const markSize = mark ? fitWithin(mark.size, markBox.w, markBox.h) : null;
  const footerTextLeft = markSize ? margin + markSize.width + 12 : margin;
  const pageCount = (doc as any).internal.getNumberOfPages();
  const manualEntry = isManualEntryReport(payload);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);

    // A manual application is watermarked on EVERY page, so no printed page
    // can be mistaken for a tracked, GPS-recorded application.
    if (manualEntry) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(46);
      doc.setTextColor(155, 125, 200);
      try {
        (doc as any).saveGraphicsState?.();
        (doc as any).setGState?.(new (doc as any).GState({ opacity: 0.14 }));
      } catch { /* opacity is cosmetic only */ }
      doc.text("MANUAL ENTRY", pageWidth / 2, pageHeight / 2, { align: "center", angle: 32 });
      try { (doc as any).restoreGraphicsState?.(); } catch { /* ignore */ }
      doc.setTextColor(0);
    }


    if (i > 1) {
      const w = drawVineyardLogo(20, { w: 60, h: 26 });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(
        `${txt(payload.identity.vineyardName)} · Spray Report`,
        w ? margin + w + 10 : margin,
        38,
      );
      doc.setDrawColor(230);
      doc.line(margin, 52, pageWidth - margin, 52);
      doc.setTextColor(0);
    }

    doc.setDrawColor(220);
    doc.line(margin, pageHeight - 50, pageWidth - margin, pageHeight - 50);

    if (mark && markSize) {
      try {
        doc.addImage(
          mark.dataUrl,
          dataUrlImageFormat(mark.dataUrl),
          margin,
          pageHeight - 42,
          markSize.width,
          markSize.height,
        );
      } catch {
        /* branding is never allowed to break an export */
      }
    }

    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(
      doc.splitTextToSize(
        `Spray Report · trip ${payload.identity.tripId} · record ${payload.identity.sprayRecordId}. Review against local compliance requirements before submission.`,
        pageWidth - footerTextLeft - margin - 70,
      ),
      footerTextLeft,
      pageHeight - 36,
    );
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 20, {
      align: "right",
    });
    doc.setTextColor(0);
  }


  return doc;
}

export function saveSprayReportPdf(
  payload: SprayReportPayloadV1,
  ctx: SprayReportPdfContext = {},
): string {
  const doc = buildSprayReportPdf(payload, ctx);
  const filename = sprayReportFilename(payload, "portal");
  doc.save(filename);
  return filename;
}
