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
  logoDataUrl?: string | null;
}

export function buildSprayReportPdf(
  payload: SprayReportPayloadV1,
  ctx: SprayReportPdfContext = {},
): jsPDF {
  const fmt = ctx.formatters ?? AU_FORMATTERS;
  const tz = payload.identity.vineyardTimeZone;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Spray Report", margin, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(
    `${txt(payload.identity.vineyardName)} · ${txt(payload.identity.reference)}`,
    margin,
    68,
  );
  doc.text(`Generated: ${fmt.dateTime(new Date())}`, pageWidth - margin, 68, {
    align: "right",
  });
  doc.setDrawColor(200);
  doc.line(margin, 78, pageWidth - margin, 78);
  doc.setTextColor(0);

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
    startY: 90,
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
    margin: { left: margin, right: margin },
  });
  let y = (doc as any).lastAutoTable.finalY + 18;

  const section = (title: string, need = 120) => {
    if (y > pageHeight - need) {
      doc.addPage();
      y = 50;
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
    margin: { left: margin, right: margin },
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
      head: [["Item", "Planned", "Actual", "Match"]],
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
      margin: { left: margin, right: margin },
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
      margin: { left: margin, right: margin },
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
    margin: { left: margin, right: margin },
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



  // Completeness warnings
  if (payload.warnings.length) {
    section("Completeness warnings", 100);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    const lines = doc.splitTextToSize(
      payload.warnings.map((w) => `• ${w}`).join("\n"),
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
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 16;
  }

  // Footer
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(220);
    doc.line(margin, pageHeight - 50, pageWidth - margin, pageHeight - 50);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(
      doc.splitTextToSize(
        `Spray Report · trip ${payload.identity.tripId} · record ${payload.identity.sprayRecordId}. Review against local compliance requirements before submission.`,
        pageWidth - margin * 2,
      ),
      margin,
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
