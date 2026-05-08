// Rainfall Reports — PDF & CSV export helpers.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import logoUrl from "@/assets/vinetrack-leaf.png";
import { sourceLabel, summarizeRainfall, type RainfallDay } from "./rainfallQuery";

const SOURCE_PRIORITY_NOTE =
  "Source priority: Manual → Davis WeatherLink → Weather Underground → Open-Meteo";

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

function safeName(s: string): string {
  return s.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "Vineyard";
}

function fmtDateFile(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function rainfallFileBase(vineyardName: string, from: Date, to: Date): string {
  return `RainfallReport_${safeName(vineyardName)}_${fmtDateFile(from)}_to_${fmtDateFile(to)}`;
}

// ---------- CSV ----------

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildRainfallCsv(rows: RainfallDay[]): string {
  const header = [
    "date",
    "rainfall_mm",
    "source",
    "source_label",
    "station_name",
    "is_manual",
    "is_fallback",
    "notes",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const isManual = r.source === "manual";
    const isFallback = r.source === "open_meteo";
    lines.push(
      [
        csvEscape(r.date || ""),
        r.rainfall_mm == null ? "" : csvEscape(r.rainfall_mm),
        csvEscape(r.source ?? ""),
        csvEscape(r.source ? sourceLabel(r.source) : ""),
        csvEscape(r.station_name ?? ""),
        r.source == null ? "" : csvEscape(isManual ? "true" : "false"),
        r.source == null ? "" : csvEscape(isFallback ? "true" : "false"),
        csvEscape(r.notes ?? ""),
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function downloadRainfallCsv(
  rows: RainfallDay[],
  vineyardName: string,
  from: Date,
  to: Date,
) {
  const csv = buildRainfallCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${rainfallFileBase(vineyardName, from, to)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- PDF ----------

export interface RainfallPdfContext {
  vineyardName: string;
  from: Date;
  to: Date;
  rows: RainfallDay[];
  logoDataUrl?: string | null;
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return isNaN(date.getTime()) ? "—" : format(date, "PP");
}

function tz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export function buildRainfallPdf(ctx: RainfallPdfContext): jsPDF {
  const { vineyardName, from, to, rows, logoDataUrl } = ctx;
  const summary = summarizeRainfall(rows);
  const nullDays = rows.filter((r) => r.rainfall_mm == null).length;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 50;

  // Header: logo + title
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", margin, y - 24, 32, 32);
    } catch {
      /* ignore */
    }
  }
  const titleX = margin + (logoDataUrl ? 44 : 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Rainfall Report", titleX, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(vineyardName, titleX, y);
  y += 14;

  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`Date range: ${fmtDate(from)} – ${fmtDate(to)}`, titleX, y);
  y += 12;
  doc.text(
    `Generated: ${format(new Date(), "PP p")}${tz() ? ` (${tz()})` : ""}`,
    titleX,
    y,
  );
  y += 12;
  doc.text(SOURCE_PRIORITY_NOTE, titleX, y);
  y += 18;
  doc.setTextColor(0);

  // Summary
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Summary", margin, y);
  y += 6;

  autoTable(doc, {
    startY: y + 4,
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 3 },
    body: [
      ["Total rainfall", `${summary.totalMm} mm`],
      ["Rain days", String(summary.rainDays)],
      [
        "Highest daily rainfall",
        summary.wettest ? `${summary.wettest.mm} mm (${fmtDate(summary.wettest.date)})` : "—",
      ],
      [
        "Average per rain day",
        summary.avgPerRainDay != null ? `${summary.avgPerRainDay} mm` : "—",
      ],
      ["Days with no data", String(nullDays)],
      ["Source mix", summary.sourceLabel],
    ],
    columnStyles: {
      0: { cellWidth: 180, fontStyle: "bold", textColor: 60 },
      1: { cellWidth: pageW - margin * 2 - 180 },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 16;

  // Daily table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Daily Rainfall", margin, y);
  y += 4;

  autoTable(doc, {
    startY: y + 4,
    margin: { left: margin, right: margin },
    head: [["Date", "Rainfall (mm)", "Source", "Station", "Notes"]],
    body: rows.map((r) => [
      r.date ? fmtDate(r.date) : "—",
      r.rainfall_mm == null ? "—" : r.rainfall_mm.toFixed(1),
      sourceLabel(r.source),
      r.station_name ?? "—",
      r.notes ?? "—",
    ]),
    headStyles: { fillColor: [60, 90, 60], textColor: 255, fontSize: 10 },
    styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
    columnStyles: {
      1: { halign: "right" },
    },
    didDrawPage: () => {
      const ph = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(120);
      const footer = `Generated ${format(new Date(), "PP p")}${tz() ? ` (${tz()})` : ""} • VineTrack`;
      doc.text(footer, margin, ph - 20);
      doc.setTextColor(0);
    },
  });

  return doc;
}

export async function downloadRainfallPdf(
  rows: RainfallDay[],
  vineyardName: string,
  from: Date,
  to: Date,
) {
  const logoDataUrl = await loadLogoDataUrl();
  const doc = buildRainfallPdf({ vineyardName, from, to, rows, logoDataUrl });
  doc.save(`${rainfallFileBase(vineyardName, from, to)}.pdf`);
}
