import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { SprayRecord } from "./sprayRecordsQuery";
import type { TripCostBreakdown } from "./tripCosting";
import { fmtCurrency, fmtHa, fmtHours, fmtTonnes } from "./tripCosting";

const NR = "Not recorded";

const fmtVal = (v: any): string => {
  if (v == null || v === "") return NR;
  return String(v);
};

const fmtDate = (v?: string | null) => {
  if (!v) return NR;
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};

const fmtDateTime = (v?: string | null) => {
  if (!v) return NR;
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString();
};

const fmtTime = (v?: string | null) => {
  if (!v) return NR;
  if (/^\d{2}:\d{2}/.test(v)) return v.slice(0, 5);
  const d = new Date(v);
  if (!isNaN(d.getTime())) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return v;
};

function chemicalSummary(tanks: any): { product: string; rate: string; water: string } {
  const arr = Array.isArray(tanks) ? tanks : tanks ? [tanks] : [];
  if (arr.length === 0) return { product: NR, rate: NR, water: NR };

  const products: string[] = [];
  const rates: string[] = [];
  const waters: string[] = [];

  arr.forEach((t: any, i: number) => {
    const w = t?.water_volume;
    if (w != null) waters.push(`Tank ${i + 1}: ${w} L`);
    const chems = Array.isArray(t?.chemicals) ? t.chemicals : [];
    chems.forEach((c: any) => {
      const name = c?.name ?? c?.chemical_name ?? c?.product ?? null;
      if (name) products.push(String(name));
      const rate = c?.dose ?? c?.rate ?? c?.amount ?? null;
      const unit = c?.unit ?? "";
      if (rate != null) rates.push(`${name ?? "Chem"}: ${rate}${unit ? " " + unit : ""}`);
    });
  });

  return {
    product: products.length ? products.join(", ") : NR,
    rate: rates.length ? rates.join("; ") : NR,
    water: waters.length ? waters.join("; ") : NR,
  };
}

export interface SprayRecordPdfContext {
  paddockName?: string | null;
  operatorName?: string | null;
  /** Owner/manager-only trip cost breakdown for the linked trip. Caller MUST gate. */
  cost?: TripCostBreakdown | null;
}

export function exportSprayRecordPdf(
  record: SprayRecord,
  vineyardName?: string | null,
  context?: SprayRecordPdfContext,
) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Spray Record", margin, 50);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`Vineyard: ${fmtVal(vineyardName)}`, margin, 68);
  doc.text(
    `Generated: ${new Date().toLocaleString()}`,
    pageWidth - margin,
    68,
    { align: "right" },
  );
  doc.setDrawColor(200);
  doc.line(margin, 78, pageWidth - margin, 78);
  doc.setTextColor(0);

  const { product, rate, water } = chemicalSummary(record.tanks);

  const rows: [string, string][] = [
    ["Date", fmtDate(record.date)],
    ["Start time", fmtTime(record.start_time)],
    ["End time", fmtTime(record.end_time)],
    ["Operation type", fmtVal(record.operation_type)],
    ["Reference", fmtVal(record.spray_reference)],
    ["Block / Paddock", fmtVal(context?.paddockName)],
    ["Operator", fmtVal(context?.operatorName)],
    ["Tractor", fmtVal(record.tractor)],
    ["Tractor gear", fmtVal(record.tractor_gear)],
    ["Equipment", fmtVal(record.equipment_type)],
    ["Fans / Jets", fmtVal(record.number_of_fans_jets)],
    ["Average speed", fmtVal(record.average_speed)],
    ["Chemical / Product", product],
    ["Rate", rate],
    ["Water volume", water],
    ["Temperature (°C)", fmtVal(record.temperature)],
    ["Wind speed", fmtVal(record.wind_speed)],
    ["Wind direction", fmtVal(record.wind_direction)],
    ["Humidity (%)", fmtVal(record.humidity)],
  ];

  autoTable(doc, {
    startY: 90,
    head: [["Field", "Value"]],
    body: rows,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 5, valign: "top" },
    headStyles: { fillColor: [60, 90, 60], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 150, fontStyle: "bold" },
      1: { cellWidth: "auto" },
    },
    margin: { left: margin, right: margin },
  });

  let y = (doc as any).lastAutoTable.finalY + 16;

  // Notes section
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Notes", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const notesText = record.notes && record.notes.trim() ? record.notes : NR;
  const notesLines = doc.splitTextToSize(notesText, pageWidth - margin * 2);
  if (y + notesLines.length * 12 > pageHeight - 80) {
    doc.addPage();
    y = 50;
  }
  doc.text(notesLines, margin, y + 12);
  y += notesLines.length * 12 + 20;

  // Tank breakdown if multiple tanks
  const tanksArr = Array.isArray(record.tanks)
    ? record.tanks
    : record.tanks
      ? [record.tanks]
      : [];
  if (tanksArr.length > 0) {
    if (y > pageHeight - 160) {
      doc.addPage();
      y = 50;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Tank breakdown", margin, y);
    const tankRows: string[][] = [];
    tanksArr.forEach((t: any, i: number) => {
      const chems = Array.isArray(t?.chemicals) ? t.chemicals : [];
      if (chems.length === 0) {
        tankRows.push([
          `Tank ${i + 1}${t?.tank_number ? ` (#${t.tank_number})` : ""}`,
          t?.water_volume != null ? `${t.water_volume} L` : NR,
          NR,
          NR,
        ]);
      } else {
        chems.forEach((c: any, ci: number) => {
          tankRows.push([
            ci === 0
              ? `Tank ${i + 1}${t?.tank_number ? ` (#${t.tank_number})` : ""}`
              : "",
            ci === 0 && t?.water_volume != null ? `${t.water_volume} L` : "",
            String(c?.name ?? c?.chemical_name ?? "Chemical"),
            `${c?.dose ?? c?.rate ?? c?.amount ?? ""} ${c?.unit ?? ""}`.trim() || NR,
          ]);
        });
      }
    });
    autoTable(doc, {
      startY: y + 6,
      head: [["Tank", "Water", "Chemical", "Rate"]],
      body: tankRows,
      theme: "striped",
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [60, 90, 60], textColor: 255 },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 16;
  }

  // Estimated trip cost — owner/manager only (caller gates).
  if (context?.cost) {
    const c = context.cost;
    if (y > pageHeight - 200) {
      doc.addPage();
      y = 50;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Estimated trip cost", margin, y);
    const labourLabel = `Labour${c.labour.categoryName ? ` (${c.labour.categoryName})` : ""}`;
    const labourValue =
      c.labour.cost != null
        ? `${fmtCurrency(c.labour.cost)}${c.labour.ratePerHour != null ? ` · ${fmtCurrency(c.labour.ratePerHour)}/h` : ""}`
        : NR;
    const fuelValue =
      c.fuel.cost != null
        ? `${fmtCurrency(c.fuel.cost)}${c.fuel.litres != null ? ` · ${c.fuel.litres.toFixed(1)} L` : ""}${c.fuel.costPerLitre != null ? ` @ ${fmtCurrency(c.fuel.costPerLitre)}/L` : ""}`
        : NR;
    const chemLabel = `Chemicals${c.chemicals.lineCount ? ` (${c.chemicals.lineCount} line${c.chemicals.lineCount === 1 ? "" : "s"})` : ""}`;
    const body: any[][] = [
      ["Active hours", fmtHours(c.activeHours)],
      [labourLabel, labourValue],
      ["Fuel", fuelValue],
      [chemLabel, c.chemicals.cost != null ? fmtCurrency(c.chemicals.cost) : NR],
    ];
    if (c.inputs.lineCount > 0) {
      body.push([
        `Seed / inputs (${c.inputs.lineCount} line${c.inputs.lineCount === 1 ? "" : "s"})`,
        c.inputs.cost != null ? fmtCurrency(c.inputs.cost) : NR,
      ]);
    }
    body.push(["Estimated total", c.total != null ? fmtCurrency(c.total) : NR]);
    autoTable(doc, {
      startY: y + 6,
      head: [["Field", "Value"]],
      body,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 5, valign: "top" },
      headStyles: { fillColor: [60, 90, 60], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 150, fontStyle: "bold" },
        1: { cellWidth: "auto" },
      },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
    if (c.warnings.length > 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(110);
      const warnLines = doc.splitTextToSize(
        `Costing completeness: ${c.warnings.join(" ")}`,
        pageWidth - margin * 2,
      );
      if (y + warnLines.length * 11 > pageHeight - 80) {
        doc.addPage();
        y = 50;
      }
      doc.text(warnLines, margin, y);
      y += warnLines.length * 11 + 6;
      doc.setTextColor(0);
    }
  }

  // Meta
  if (y > pageHeight - 120) {
    doc.addPage();
    y = 50;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Record metadata", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80);
  y += 14;
  doc.text(`Created:  ${fmtDateTime(record.created_at)}`, margin, y);
  y += 12;
  doc.text(`Updated:  ${fmtDateTime(record.updated_at)}`, margin, y);
  y += 12;
  doc.text(`Record ID: ${record.id}`, margin, y);
  doc.setTextColor(0);

  // Footer on every page
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(220);
    doc.line(margin, pageHeight - 50, pageWidth - margin, pageHeight - 50);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(110);
    const footer =
      "Generated from VineTrack portal records. Review against local compliance requirements before submission.";
    const lines = doc.splitTextToSize(footer, pageWidth - margin * 2);
    doc.text(lines, margin, pageHeight - 36);
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth - margin,
      pageHeight - 20,
      { align: "right" },
    );
    doc.setTextColor(0);
  }

  const safeDate = (record.date ?? "undated").replace(/[^0-9-]/g, "");
  const safeRef = (record.spray_reference ?? record.id.slice(0, 8))
    .toString()
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  doc.save(`spray-record-${safeDate}-${safeRef}.pdf`);
}
