// Manual Issues exports — CSV, Excel and PDF from the shared export view data.
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  categoryLabel,
  locationSummary,
  priorityLabel,
  scopeLabel,
  statusLabel,
  type ManualIssue,
} from "@/lib/manualIssues";

export interface ExportContext {
  vineyardName: string;
  paddockName: (id: string | null) => string;
  memberName: (id: string | null) => string;
  formatDate: (value: string | null) => string;
}

export const MANUAL_ISSUE_EXPORT_COLUMNS = [
  "Title",
  "Status",
  "Priority",
  "Category",
  "Block",
  "Location",
  "Location type",
  "Assigned to",
  "Due date",
  "Created",
  "Completed",
  "Description",
] as const;

export function manualIssueExportRows(issues: ManualIssue[], ctx: ExportContext): string[][] {
  return issues.map((i) => [
    i.title ?? "",
    statusLabel(i.status),
    priorityLabel(i.priority),
    categoryLabel(i.category),
    ctx.paddockName(i.paddock_id),
    locationSummary(i),
    scopeLabel(i.location_scope),
    ctx.memberName(i.assigned_user_id),
    ctx.formatDate(i.due_date),
    ctx.formatDate(i.created_at),
    ctx.formatDate(i.completed_at),
    (i.description ?? "").replace(/\s+/g, " ").trim(),
  ]);
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function manualIssuesCsv(issues: ManualIssue[], ctx: ExportContext): string {
  const rows = manualIssueExportRows(issues, ctx);
  return [
    MANUAL_ISSUE_EXPORT_COLUMNS.join(","),
    ...rows.map((r) => r.map((c) => csvEscape(String(c ?? ""))).join(",")),
  ].join("\n");
}

function fileStem(name: string): string {
  return `manual-issues-${(name || "vineyard").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

export function downloadManualIssuesCsv(issues: ManualIssue[], ctx: ExportContext) {
  const blob = new Blob([manualIssuesCsv(issues, ctx)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileStem(ctx.vineyardName)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadManualIssuesXlsx(issues: ManualIssue[], ctx: ExportContext) {
  const data = [[...MANUAL_ISSUE_EXPORT_COLUMNS], ...manualIssueExportRows(issues, ctx)];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Manual Issues");
  XLSX.writeFile(wb, `${fileStem(ctx.vineyardName)}.xlsx`);
}

export function downloadManualIssuesPdf(issues: ManualIssue[], ctx: ExportContext) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text("Manual Issues", 14, 14);
  doc.setFontSize(10);
  doc.text(`${ctx.vineyardName} · ${issues.length} issue${issues.length === 1 ? "" : "s"}`, 14, 20);
  autoTable(doc, {
    startY: 25,
    head: [[...MANUAL_ISSUE_EXPORT_COLUMNS]],
    body: manualIssueExportRows(issues, ctx),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [40, 60, 45] },
  });
  doc.save(`${fileStem(ctx.vineyardName)}.pdf`);
}
