// CSV and PDF export for the Phase 2B irrigation reporting centre.
//
// Exports carry the same numbers the screen shows, plus a metadata block that
// records the vineyard, vintage, applied filters, unit context, warnings and
// the server's generated_at timestamp so an exported file is self-describing.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type {
  IrrigationReportFilters,
  ReportEnvelopeBase,
  ReportWarning,
} from "@/lib/irrigationReportsQuery";

export interface ExportColumn<Row> {
  header: string;
  value: (row: Row) => string | number | null;
}

export interface ExportMeta {
  reportTitle: string;
  vineyardName: string;
  envelope: ReportEnvelopeBase | null | undefined;
  filters: IrrigationReportFilters;
  unitNote: string;
}

const FILTER_LABELS: Partial<Record<keyof IrrigationReportFilters, string>> = {
  date_from: "Date from",
  date_to: "Date to",
  system_id: "System",
  water_source: "Water source",
  valve_id: "Valve",
  block_id: "Block",
  variety_id: "Variety",
  source_type: "Record source",
  source_group: "Source group",
  calculation_method: "Calculation method",
  measurement_group: "Measurement group",
  include_estimated: "Include estimated",
  include_imported: "Include imported",
  include_reversed: "Include reversed",
};

function metaLines(meta: ExportMeta): string[] {
  const e = meta.envelope;
  const lines = [
    `Report,${meta.reportTitle}`,
    `Vineyard,${meta.vineyardName}`,
    `Vintage,${e?.vintage_year ?? meta.filters.vintage_year ?? ""}`,
    `Period,${e?.period_start ?? ""} to ${e?.period_end ?? ""}`,
    `Timezone,${e?.timezone ?? ""}`,
    `Generated at,${e?.generated_at ?? new Date().toISOString()}`,
    `Units,${meta.unitNote}`,
  ];
  const applied = Object.entries(FILTER_LABELS)
    .map(([key, label]) => {
      const v = (meta.filters as any)[key];
      if (v == null || v === "") return null;
      if (key === "include_estimated" || key === "include_imported") {
        return v === false ? `${label},No` : null;
      }
      if (key === "include_reversed") return v === true ? `${label},Yes` : null;
      return `${label},${v}`;
    })
    .filter(Boolean) as string[];
  lines.push(applied.length ? `Filters applied,` : `Filters applied,None`);
  lines.push(...applied);
  (e?.warnings ?? []).forEach((w: ReportWarning) =>
    lines.push(`Warning (${w.severity}),"${w.message.replace(/"/g, '""')}"`),
  );
  return lines;
}

function escape(v: string | number | null): string {
  if (v == null) return "";
  return `"${String(v).replace(/"/g, '""')}"`;
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportReportCsv<Row>(
  fileName: string,
  rows: Row[],
  columns: ExportColumn<Row>[],
  meta: ExportMeta,
) {
  const body = [
    columns.map((c) => escape(c.header)).join(","),
    ...rows.map((r) => columns.map((c) => escape(c.value(r))).join(",")),
  ];
  const csv = [...metaLines(meta), "", ...body].join("\n");
  download(fileName, new Blob([csv], { type: "text/csv;charset=utf-8;" }));
}

export function exportReportPdf<Row>(
  fileName: string,
  rows: Row[],
  columns: ExportColumn<Row>[],
  meta: ExportMeta,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const e = meta.envelope;

  doc.setFontSize(14);
  doc.text(meta.reportTitle, 40, 40);
  doc.setFontSize(9);
  const header = [
    `${meta.vineyardName} · Vintage ${e?.vintage_year ?? meta.filters.vintage_year ?? "—"}`,
    `Period ${e?.period_start ?? "—"} to ${e?.period_end ?? "—"}${e?.timezone ? ` (${e.timezone})` : ""}`,
    `Units: ${meta.unitNote}`,
    `Generated ${e?.generated_at ? new Date(e.generated_at).toLocaleString() : new Date().toLocaleString()}`,
  ];
  header.forEach((line, i) => doc.text(line, 40, 58 + i * 12));

  let cursor = 58 + header.length * 12 + 6;
  (e?.warnings ?? []).forEach((w) => {
    doc.text(`• ${w.severity.toUpperCase()}: ${w.message}`, 40, cursor);
    cursor += 12;
  });

  autoTable(doc, {
    startY: cursor + 6,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => (c.value(r) ?? "—") as string)),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [39, 78, 55] },
  });

  doc.save(fileName);
}
