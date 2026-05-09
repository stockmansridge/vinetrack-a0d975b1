// Spray Jobs export helpers — single-job PDF and yearly program PDF/CSV.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/ios-supabase/client";
import type { SprayJob, SprayJobChemicalLine } from "./sprayJobsQuery";
import {
  fetchLinkedSprayRecords, recordTotalWaterLitres, recordChemicalNames,
} from "./sprayJobsQuery";

const NR = "Not recorded";

const fmtVal = (v: any): string => (v == null || v === "" ? NR : String(v));
const fmtDate = (v?: string | null) => {
  if (!v) return NR;
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString();
};

const isFoliar = (op?: string | null) => (op ?? "").toLowerCase() === "foliar spray";

const opLabel = (v?: string | null) => {
  if (!v) return NR;
  const t = v.toLowerCase();
  if (t === "foliar spray") return "Foliar Spray";
  if (t === "banded spray") return "Banded Spray";
  if (t === "spreader") return "Spreader";
  return v;
};

export interface JobLookups {
  paddockNameById: Map<string, string>;
  tractorNameById: Map<string, string>;
  equipmentNameById: Map<string, string>;
  memberNameById: Map<string, string>;
}

const safeFile = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);

function chemLineRow(l: SprayJobChemicalLine): string[] {
  const name = l.name ?? "Unnamed";
  const rate = l.rate != null ? `${l.rate}${l.unit ? ` ${l.unit}` : ""}` : NR;
  const water = l.water_rate != null ? `${l.water_rate}` : "";
  return [name, rate, water || "—", l.notes ?? ""];
}

/** Fetch paddock id mapping for multiple spray jobs in one query. */
export async function fetchJobPaddockMap(jobIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!jobIds.length) return out;
  const { data, error } = await supabase
    .from("spray_job_paddocks")
    .select("spray_job_id, paddock_id")
    .in("spray_job_id", jobIds);
  if (error) throw error;
  (data ?? []).forEach((r: any) => {
    const arr = out.get(r.spray_job_id) ?? [];
    arr.push(r.paddock_id);
    out.set(r.spray_job_id, arr);
  });
  return out;
}

function paddockNamesFor(ids: string[] | undefined, lookups: JobLookups): string {
  if (!ids || !ids.length) return NR;
  return ids.map((id) => lookups.paddockNameById.get(id) ?? "—").join(", ");
}

// ============================================================
// Individual Spray Job PDF
// ============================================================

export async function exportSprayJobPdf(
  job: SprayJob,
  paddockIds: string[],
  lookups: JobLookups,
  vineyardName?: string | null,
) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Spray Job", margin, 50);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`Vineyard: ${fmtVal(vineyardName)}`, margin, 68);
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - margin, 68, { align: "right" });
  doc.setDrawColor(200);
  doc.line(margin, 78, pageWidth - margin, 78);
  doc.setTextColor(0);

  const overview: [string, string][] = [
    ["Spray job name", fmtVal(job.name)],
    ["Planned date", fmtDate(job.planned_date)],
    ["Status", fmtVal(job.status)],
    ["Operation type", opLabel(job.operation_type)],
    ["Target", fmtVal(job.target)],
    ["Growth stage", fmtVal(job.growth_stage_code)],
    ["Paddocks/blocks", paddockNamesFor(paddockIds, lookups)],
    ["Equipment", job.equipment_id ? fmtVal(lookups.equipmentNameById.get(job.equipment_id)) : NR],
    ["Tractor", job.tractor_id ? fmtVal(lookups.tractorNameById.get(job.tractor_id)) : NR],
    ["Operator", job.operator_user_id ? fmtVal(lookups.memberNameById.get(job.operator_user_id)) : NR],
  ];

  autoTable(doc, {
    startY: 90,
    head: [["Field", "Value"]],
    body: overview,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 5, valign: "top" },
    headStyles: { fillColor: [60, 90, 60], textColor: 255 },
    columnStyles: { 0: { cellWidth: 150, fontStyle: "bold" }, 1: { cellWidth: "auto" } },
    margin: { left: margin, right: margin },
  });

  let y = (doc as any).lastAutoTable.finalY + 16;

  // Chemical lines
  if (y > pageHeight - 120) { doc.addPage(); y = 50; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Chemicals", margin, y);

  const lines = job.chemical_lines ?? [];
  const chemBody = lines.length ? lines.map(chemLineRow) : [[NR, "", "", ""]];
  autoTable(doc, {
    startY: y + 6,
    head: [["Product", "Rate", "Water (L)", "Notes"]],
    body: chemBody,
    theme: "striped",
    styles: { fontSize: 9, cellPadding: 4, valign: "top" },
    headStyles: { fillColor: [60, 90, 60], textColor: 255 },
    margin: { left: margin, right: margin },
  });
  y = (doc as any).lastAutoTable.finalY + 16;

  // VSP / water rate (Foliar Spray only)
  if (isFoliar(job.operation_type)) {
    if (y > pageHeight - 160) { doc.addPage(); y = 50; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("VSP / water rate", margin, y);

    const vsp: [string, string][] = [
      ["VSP canopy size", fmtVal(job.vsp_canopy_size)],
      ["VSP canopy density", fmtVal(job.vsp_canopy_density)],
      ["Row spacing (m)", job.row_spacing_metres != null ? String(job.row_spacing_metres) : NR],
      ["Calculated water rate (L/ha)", job.water_volume != null ? String(job.water_volume) : NR],
      ["Selected spray rate (L/ha)", job.spray_rate_per_ha != null ? String(job.spray_rate_per_ha) : NR],
      ["Concentration factor", job.concentration_factor != null ? Number(job.concentration_factor).toFixed(2) : NR],
    ];
    autoTable(doc, {
      startY: y + 6,
      head: [["Field", "Value"]],
      body: vsp,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 5, valign: "top" },
      headStyles: { fillColor: [60, 90, 60], textColor: 255 },
      columnStyles: { 0: { cellWidth: 200, fontStyle: "bold" }, 1: { cellWidth: "auto" } },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 16;
  } else {
    // For Banded Spray / Spreader: only show rate/water if present.
    const hasAny = job.water_volume != null || job.spray_rate_per_ha != null;
    if (hasAny) {
      if (y > pageHeight - 120) { doc.addPage(); y = 50; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Application", margin, y);
      const ap: [string, string][] = [];
      if (job.water_volume != null) ap.push(["Water volume (L/ha)", String(job.water_volume)]);
      if (job.spray_rate_per_ha != null) ap.push(["Spray rate (L/ha)", String(job.spray_rate_per_ha)]);
      autoTable(doc, {
        startY: y + 6,
        head: [["Field", "Value"]],
        body: ap,
        theme: "grid",
        styles: { fontSize: 9, cellPadding: 5, valign: "top" },
        headStyles: { fillColor: [60, 90, 60], textColor: 255 },
        columnStyles: { 0: { cellWidth: 200, fontStyle: "bold" }, 1: { cellWidth: "auto" } },
        margin: { left: margin, right: margin },
      });
      y = (doc as any).lastAutoTable.finalY + 16;
    }
  }

  // Notes
  if (job.notes && job.notes.trim()) {
    if (y > pageHeight - 120) { doc.addPage(); y = 50; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Notes", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const notesLines = doc.splitTextToSize(job.notes, pageWidth - margin * 2);
    doc.text(notesLines, margin, y + 12);
    y += notesLines.length * 12 + 12;
  }

  // Linked actual records (best-effort; non-fatal on error)
  try {
    const linked = await fetchLinkedSprayRecords(job.id);
    if (linked.length) {
      if (y > pageHeight - 140) { doc.addPage(); y = 50; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Linked spray records (actual)", margin, y);
      const rows = linked.map((r) => [
        r.date ?? NR,
        r.spray_reference ?? r.id.slice(0, 8),
        r.operation_type ?? NR,
        r.tractor ?? NR,
        recordChemicalNames(r).join(", ") || NR,
        recordTotalWaterLitres(r) != null ? `${recordTotalWaterLitres(r)} L` : NR,
      ]);
      autoTable(doc, {
        startY: y + 6,
        head: [["Date", "Reference", "Operation", "Tractor", "Chemicals", "Water"]],
        body: rows,
        theme: "striped",
        styles: { fontSize: 8, cellPadding: 4, valign: "top" },
        headStyles: { fillColor: [60, 90, 60], textColor: 255 },
        margin: { left: margin, right: margin },
      });
      y = (doc as any).lastAutoTable.finalY + 16;
    }
  } catch {
    // ignore — linked records are auxiliary
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
      "Generated from VineTrack portal. Review against local compliance requirements before submission.",
      margin,
      pageHeight - 36,
    );
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 20, { align: "right" });
    doc.setTextColor(0);
  }

  const safeName = safeFile(job.name ?? "spray-job");
  const safeDate = (job.planned_date ?? "undated").replace(/[^0-9-]/g, "");
  doc.save(`spray-job-${safeDate}-${safeName}.pdf`);
}

// ============================================================
// Yearly Spray Program — PDF
// ============================================================

export function exportYearlySprayProgramPdf(
  jobs: SprayJob[],
  paddockMap: Map<string, string[]>,
  lookups: JobLookups,
  vineyardName: string | null,
  year: number,
) {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 32;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`Spray Program ${year}`, margin, 44);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`Vineyard: ${fmtVal(vineyardName)}`, margin, 62);
  doc.text(`Total spray jobs: ${jobs.length}`, margin, 76);
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - margin, 62, { align: "right" });
  doc.setDrawColor(200);
  doc.line(margin, 86, pageWidth - margin, 86);
  doc.setTextColor(0);

  const sorted = [...jobs].sort((a, b) => {
    const da = a.planned_date ? new Date(a.planned_date).getTime() : Number.MAX_SAFE_INTEGER;
    const db = b.planned_date ? new Date(b.planned_date).getTime() : Number.MAX_SAFE_INTEGER;
    return da - db;
  });

  const body = sorted.map((j) => {
    const chems = (j.chemical_lines ?? [])
      .map((l) => {
        const r = l.rate != null ? ` (${l.rate}${l.unit ? " " + l.unit : ""})` : "";
        return `${l.name ?? "Unnamed"}${r}`;
      })
      .join(", ");
    return [
      fmtDate(j.planned_date),
      fmtVal(j.status),
      fmtVal(j.name),
      opLabel(j.operation_type),
      fmtVal(j.target),
      fmtVal(j.growth_stage_code),
      paddockNamesFor(paddockMap.get(j.id), lookups),
      chems || NR,
      j.water_volume != null ? String(j.water_volume) : NR,
      j.spray_rate_per_ha != null ? String(j.spray_rate_per_ha) : NR,
      j.concentration_factor != null ? Number(j.concentration_factor).toFixed(2) : NR,
      j.equipment_id ? fmtVal(lookups.equipmentNameById.get(j.equipment_id)) : NR,
      j.tractor_id ? fmtVal(lookups.tractorNameById.get(j.tractor_id)) : NR,
      j.operator_user_id ? fmtVal(lookups.memberNameById.get(j.operator_user_id)) : NR,
    ];
  });

  autoTable(doc, {
    startY: 96,
    head: [[
      "Planned date", "Status", "Job", "Operation", "Target", "Growth", "Paddocks",
      "Chemicals", "Water L/ha", "Rate L/ha", "CF", "Equipment", "Tractor", "Operator",
    ]],
    body: body.length ? body : [["", "", "No spray jobs for this year.", "", "", "", "", "", "", "", "", "", "", ""]],
    theme: "striped",
    styles: { fontSize: 8, cellPadding: 3, valign: "top", overflow: "linebreak" },
    headStyles: { fillColor: [60, 90, 60], textColor: 255, fontSize: 8 },
    margin: { left: margin, right: margin },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 55 },
      2: { cellWidth: 90 },
      3: { cellWidth: 60 },
      6: { cellWidth: 90 },
      7: { cellWidth: 130 },
    },
  });

  // Footer
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(220);
    doc.line(margin, pageHeight - 36, pageWidth - margin, pageHeight - 36);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text("Generated from VineTrack portal.", margin, pageHeight - 22);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 22, { align: "right" });
    doc.setTextColor(0);
  }

  doc.save(`spray-program-${year}-${safeFile(vineyardName ?? "vineyard")}.pdf`);
}

// ============================================================
// Yearly Spray Program — CSV
// ============================================================

const csvCell = (v: any): string => {
  const s = v == null ? "" : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

export function exportYearlySprayProgramCsv(
  jobs: SprayJob[],
  paddockMap: Map<string, string[]>,
  lookups: JobLookups,
  vineyardName: string | null,
  year: number,
) {
  const sorted = [...jobs].sort((a, b) => {
    const da = a.planned_date ? new Date(a.planned_date).getTime() : Number.MAX_SAFE_INTEGER;
    const db = b.planned_date ? new Date(b.planned_date).getTime() : Number.MAX_SAFE_INTEGER;
    return da - db;
  });

  const headers = [
    "planned_date", "status", "spray_job_name", "operation_type", "target",
    "growth_stage", "paddocks", "chemicals", "water_volume", "spray_rate_per_ha",
    "concentration_factor", "equipment", "tractor", "operator", "notes",
  ];

  const rows = sorted.map((j) => {
    const chems = (j.chemical_lines ?? [])
      .map((l) => {
        const r = l.rate != null ? ` (${l.rate}${l.unit ? " " + l.unit : ""})` : "";
        return `${l.name ?? "Unnamed"}${r}`;
      })
      .join("; ");
    return [
      j.planned_date ?? "",
      j.status ?? "",
      j.name ?? "",
      opLabel(j.operation_type) === NR ? "" : opLabel(j.operation_type),
      j.target ?? "",
      j.growth_stage_code ?? "",
      (paddockMap.get(j.id) ?? []).map((id) => lookups.paddockNameById.get(id) ?? "").filter(Boolean).join("; "),
      chems,
      j.water_volume ?? "",
      j.spray_rate_per_ha ?? "",
      j.concentration_factor ?? "",
      j.equipment_id ? (lookups.equipmentNameById.get(j.equipment_id) ?? "") : "",
      j.tractor_id ? (lookups.tractorNameById.get(j.tractor_id) ?? "") : "",
      j.operator_user_id ? (lookups.memberNameById.get(j.operator_user_id) ?? "") : "",
      j.notes ?? "",
    ];
  });

  const lines = [
    `# Spray Program ${year} — ${vineyardName ?? ""}`.trim(),
    `# Total spray jobs: ${jobs.length}`,
    headers.join(","),
    ...rows.map((r) => r.map(csvCell).join(",")),
  ];

  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `spray-program-${year}-${safeFile(vineyardName ?? "vineyard")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function jobYear(j: SprayJob): number | null {
  if (!j.planned_date) return null;
  const d = new Date(j.planned_date);
  return isNaN(d.getTime()) ? null : d.getFullYear();
}
