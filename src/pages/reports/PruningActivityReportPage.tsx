// Pruning Activity Report — one row per recorded pruning entry.
//
// Read-only. All figures come from the canonical pruning tables via
// usePruningActivity(); nothing is recalculated or written back. Cost
// columns are gated by useCanSeeCosts() (owner/manager only) and are
// sourced from the linked Work Task's labour lines.
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { AlertTriangle, Columns3, Download, Scissors, Search, ExternalLink, Pencil } from "lucide-react";
import ReportEditPruningDialog from "@/components/pruning/ReportEditPruningDialog";
import PruningActivityDialog from "@/components/pruning/PruningActivityDialog";


import { useVineyard } from "@/context/VineyardContext";
import { useToast } from "@/hooks/use-toast";
import { useCanSeeCosts } from "@/lib/permissions";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { formatDate } from "@/lib/dateFormat";
import { ReportDateCell, reportDateText } from "@/components/reports/ReportDateCell";

import { usePruningActivity, type PruningActivityRow } from "@/lib/pruningActivityQuery";
import { useSortableTable } from "@/lib/useSortableTable";
import { useDiagnosticPanel } from "@/lib/systemAdmin";
import { useTeamLookup } from "@/hooks/useTeamLookup";

import { PageHead } from "@/components/PageHead";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import NewPruningActivityButton from "@/components/pruning/NewPruningActivityButton";

import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";

const ANY = "__any__";
const UNASSIGNED = "__unassigned__";


type SortKey =
  | "date" | "activity" | "season" | "vintage" | "block" | "variety" | "worker" | "method"
  | "rows" | "quarters" | "rowEq" | "vines" | "share" | "hours" | "start" | "finish"
  | "duration" | "vinesPerHour" | "rate" | "cost" | "activityHours" | "activityCost"
  | "task" | "taskStatus"
  | "createdBy" | "created" | "updated" | "status";

/** Column registry — order here is the display order of the table. */
const COLUMN_DEFS: { key: SortKey; label: string; align?: "right"; cost?: boolean }[] = [
  { key: "date", label: "Date" },
  { key: "activity", label: "Activity" },
  { key: "season", label: "Season", align: "right" },
  { key: "vintage", label: "Vintage", align: "right" },
  { key: "block", label: "Block" },
  { key: "variety", label: "Variety" },
  { key: "worker", label: "Worker / crew" },
  { key: "method", label: "Method" },
  { key: "rows", label: "Rows" },
  { key: "quarters", label: "Qtrs", align: "right" },
  { key: "rowEq", label: "Row eq.", align: "right" },
  { key: "vines", label: "Vines", align: "right" },
  { key: "share", label: "Share", align: "right" },
  { key: "hours", label: "Allocated hrs", align: "right" },
  { key: "start", label: "Start" },
  { key: "finish", label: "Finish" },
  { key: "duration", label: "Duration", align: "right" },
  { key: "vinesPerHour", label: "Vines / hr", align: "right" },
  { key: "rate", label: "Rate / hr", align: "right", cost: true },
  { key: "cost", label: "Allocated labour cost", align: "right", cost: true },
  { key: "activityHours", label: "Activity total hrs", align: "right" },
  { key: "activityCost", label: "Activity total cost", align: "right", cost: true },
  { key: "task", label: "Work task" },
  { key: "taskStatus", label: "Task status" },
  { key: "createdBy", label: "Created by" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
  { key: "status", label: "Status" },
];

/** Columns hidden until the user turns them on. */
const DEFAULT_HIDDEN: SortKey[] = [
  "created", "updated", "status", "start", "finish", "duration", "task", "taskStatus",
];

const COLUMN_PREFS_KEY = "vinetrack.pruningActivity.columns.v2";




/** Render "8:30 am" from a time or timestamp column, tolerating both shapes. */
function formatTime(value: string | null): string {
  if (!value) return "—";
  const raw = value.trim();
  const hm = /^(\d{1,2}):(\d{2})/.exec(raw);
  let d: Date | null = null;
  if (raw.includes("T") || raw.includes(" ") && raw.length > 10) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  if (!d && hm) {
    d = new Date();
    d.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
  }
  if (!d) return raw;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

/** "3h 15m" from minutes. */
function formatDuration(mins: number | null): string {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Minutes-from-midnight for sorting time-of-day values. */
function timeSortValue(value: string | null): number | null {
  if (!value) return null;
  const raw = value.trim();
  if (raw.includes("T") || (raw.includes(" ") && raw.length > 10)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
  }
  const hm = /^(\d{1,2}):(\d{2})/.exec(raw);
  return hm ? Number(hm[1]) * 60 + Number(hm[2]) : null;
}

export default function PruningActivityReportPage() {
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;
  const { toast } = useToast();
  const canSeeCosts = useCanSeeCosts();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const fmt = useRegionFormatters();
  const { resolve: resolveUser } = useTeamLookup(selectedVineyardId);
  const money = (n: number | null) => (n == null ? "—" : fmt.currency(n));

  const [editRow, setEditRow] = useState<PruningActivityRow | null>(null);

  // -------------------- Column visibility --------------------
  const [hidden, setHidden] = useState<Set<SortKey>>(() => {
    try {
      const raw = localStorage.getItem(COLUMN_PREFS_KEY);
      if (raw) return new Set(JSON.parse(raw) as SortKey[]);
    } catch { /* ignore */ }
    return new Set(DEFAULT_HIDDEN);
  });
  useEffect(() => {
    try { localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(Array.from(hidden))); } catch { /* ignore */ }
  }, [hidden]);
  const toggleColumn = (k: SortKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  const availableColumns = useMemo(
    () => COLUMN_DEFS.filter((c) => !c.cost || canSeeCosts)
      .map((c) => (c.key === "block" ? { ...c, label: fmt.blockLabel } : c)),
    [canSeeCosts, fmt.blockLabel],
  );
  const visibleColumns = useMemo(
    () => availableColumns.filter((c) => !hidden.has(c.key)),
    [availableColumns, hidden],
  );
  const isVisible = (k: SortKey) => !hidden.has(k);


  const { data: rows = [], isLoading, error } = usePruningActivity(selectedVineyardId);


  // -------------------- Filters --------------------
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [season, setSeason] = useState<string>(ANY);
  const [blockId, setBlockId] = useState<string>(ANY);
  const [worker, setWorker] = useState<string>(ANY);
  const [method, setMethod] = useState<string>(ANY);
  const [linked, setLinked] = useState<string>(ANY);
  const [includeReversed, setIncludeReversed] = useState(false);

  // Season options come from the canonical linked pruning season only.
  const seasonOptions = useMemo(() => {
    const s = new Set<number>();
    rows.forEach((r) => { if (r.hasSeasonLink && r.seasonYear != null) s.add(r.seasonYear); });
    return Array.from(s).sort((a, b) => b - a);
  }, [rows]);

  const hasUnassigned = useMemo(() => rows.some((r) => !r.hasSeasonLink), [rows]);

  // Default to the current pruning season (calendar year of the work) when it
  // exists, matching the other season-scoped reports. Applied once per load.
  const seasonDefaulted = useRef(false);
  useEffect(() => {
    if (seasonDefaulted.current || !rows.length) return;
    seasonDefaulted.current = true;
    const currentYear = new Date().getFullYear();
    if (seasonOptions.includes(currentYear)) setSeason(String(currentYear));
  }, [rows, seasonOptions]);


  const blockOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => map.set(r.paddockId, r.blockName));
    return Array.from(map, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const workerOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { if (r.worker && r.worker !== "—") s.add(r.worker); });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const methodOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { if (r.method && r.method !== "—") s.add(r.method); });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const fromTs = from ? new Date(from).getTime() : null;
    const toTs = to ? new Date(to).getTime() + 86_399_999 : null;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!includeReversed && r.isReversed) return false;
      if (fromTs != null || toTs != null) {
        const ts = r.date ? new Date(r.date).getTime() : NaN;
        if (Number.isNaN(ts)) return false;
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
      }
      if (season === UNASSIGNED) {
        if (r.hasSeasonLink) return false;
      } else if (season !== ANY) {
        if (!r.hasSeasonLink || String(r.seasonYear ?? "") !== season) return false;
      }

      if (blockId !== ANY && r.paddockId !== blockId) return false;
      if (worker !== ANY && r.worker !== worker) return false;
      if (method !== ANY && r.method !== method) return false;
      if (linked === "yes" && !r.workTaskId) return false;
      if (linked === "no" && r.workTaskId) return false;
      if (q) {
        const hay = [
          r.blockName, r.variety, r.worker, r.method, r.rowsLabel, r.notes,
          r.activityLabel, r.workTaskLabel ?? "",
        ]

          .join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const d = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (d !== 0) return d;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return cb - ca;
    });
  }, [rows, search, from, to, season, blockId, worker, method, linked, includeReversed]);

  // -------------------- Sorting --------------------
  const accessors = useMemo(
    () => ({
      date: (r: PruningActivityRow) => (r.date ? new Date(r.date).getTime() : null),
      activity: (r: PruningActivityRow) => r.activityLabel,
      season: (r: PruningActivityRow) => r.seasonYear,
      vintage: (r: PruningActivityRow) => r.vintageYear,
      block: (r: PruningActivityRow) => r.blockName,
      variety: (r: PruningActivityRow) => r.variety,
      worker: (r: PruningActivityRow) => r.worker,
      method: (r: PruningActivityRow) => r.method,
      rows: (r: PruningActivityRow) => (r.rowNumbers.length ? r.rowNumbers[0] : null),
      quarters: (r: PruningActivityRow) => r.quarters,
      rowEq: (r: PruningActivityRow) => r.rowEquivalents,
      vines: (r: PruningActivityRow) => r.vines,
      share: (r: PruningActivityRow) => r.allocationShare,
      hours: (r: PruningActivityRow) => r.allocatedHours,
      start: (r: PruningActivityRow) => timeSortValue(r.startTime),
      finish: (r: PruningActivityRow) => timeSortValue(r.finishTime),
      duration: (r: PruningActivityRow) => r.durationMinutes,
      vinesPerHour: (r: PruningActivityRow) => r.vinesPerHour,
      rate: (r: PruningActivityRow) => r.hourlyRate,
      cost: (r: PruningActivityRow) => r.allocatedCost,
      activityHours: (r: PruningActivityRow) => r.activityHours,
      activityCost: (r: PruningActivityRow) => r.activityCost,
      task: (r: PruningActivityRow) => r.workTaskLabel,
      taskStatus: (r: PruningActivityRow) => r.workTaskStatus,
      createdBy: (r: PruningActivityRow) => resolveUser(r.createdById) ?? "",
      created: (r: PruningActivityRow) => (r.createdAt ? new Date(r.createdAt).getTime() : null),
      updated: (r: PruningActivityRow) => (r.updatedAt ? new Date(r.updatedAt).getTime() : null),
      status: (r: PruningActivityRow) => (r.isReversed ? 1 : 0),
    }),
    [resolveUser],
  );

  const { sorted, toggleSort, getSortDirection } =
    useSortableTable<PruningActivityRow, SortKey>(filtered, { accessors });

  // -------------------- Totals --------------------
  const activeRows = useMemo(() => filtered.filter((r) => !r.isReversed), [filtered]);
  const reversedCount = filtered.length - activeRows.length;

  // Allocated figures sum per block (safe to add up — they are a split of the
  // parent activity). Activity totals are counted once per parent activity so
  // a two-block activity never double-counts its labour or cost.
  const totals = useMemo(() => {
    const seen = new Set<string>();
    return activeRows.reduce(
      (acc, r) => {
        const first = !seen.has(r.groupKey);
        if (first) seen.add(r.groupKey);
        return {
          quarters: acc.quarters + r.quarters,
          rowEq: acc.rowEq + r.rowEquivalents,
          vines: acc.vines + r.vines,
          hours: acc.hours + r.allocatedHours,
          cost: acc.cost + (r.allocatedCost ?? 0),
          activityHours: acc.activityHours + (first ? r.activityHours ?? 0 : 0),
          activityCost: acc.activityCost + (first ? r.activityCost ?? 0 : 0),
          activities: acc.activities + (first ? 1 : 0),
        };
      },
      { quarters: 0, rowEq: 0, vines: 0, hours: 0, cost: 0, activityHours: 0, activityCost: 0, activities: 0 },
    );
  }, [activeRows]);

  const avgVinesPerHour = totals.hours > 0 ? totals.vines / totals.hours : null;


  // -------------------- Season integrity diagnostic (read-only) --------------------
  // System admins only, and only when the shared feature flag is switched on in
  // Feature Flags & Diagnostics. Customers never see this panel.
  const showSeasonDiagnostics = useDiagnosticPanel("show_pruning_season_diagnostics");
  // Audits every entry for this vineyard, ignoring the current filters, so a
  // data problem can never be hidden by a filter selection.
  const integrityRows = useMemo(
    () => rows.filter((r) => r.seasonMismatch || !r.hasSeasonLink),
    [rows],
  );

  const integrityGroups = useMemo(() => {
    const map = new Map<string, PruningActivityRow[]>();
    integrityRows.forEach((r) => {
      const key = r.sourcePlatform ?? "Unknown platform (no metadata recorded)";
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    });
    return Array.from(map, ([platform, items]) => ({ platform, items }))
      .sort((a, b) => a.platform.localeCompare(b.platform));
  }, [integrityRows]);


  // -------------------- Exports --------------------
  const csvSafe = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const baseHeader = [
    "Activity", "Allocation index", "Blocks in activity",
    "Date", "Pruning season", "Season link", "Season integrity", "Vintage", fmt.blockLabel, "Variety", "Worker / crew",
    "Method", "Rows", "Row count", "Quarters", "Row equivalents", "Vines",
    "Allocation share", "Allocated labour hours", "Activity labour hours",
    "Start", "Finish", "Duration (minutes)", "Vines / hour",
    "Work task", "Work task status", "Created by", "Created at", "Updated at", "Status", "Notes",
  ];
  const costHeader = [
    "Allocated labour cost", "Activity labour cost", "Effective rate / hour", "currency",
  ];

  const rowToCells = (r: PruningActivityRow) => {
    const base: (string | number)[] = [
      r.activityLabel,
      `${r.allocationIndex} of ${r.activityBlockCount}`,
      r.activityBlockCount,

      r.date,
      r.hasSeasonLink ? r.seasonYear ?? "" : "Unassigned",
      r.hasSeasonLink ? "Linked" : "Unassigned",

      r.seasonMismatch ? r.seasonIssues.join(" ") : "OK",

      r.vintageYear ?? "",
      r.blockName,
      r.variety,
      r.worker,
      r.method,
      r.rowsLabel,
      r.rowCount,
      r.quarters,
      r.rowEquivalents.toFixed(2),
      r.vines,
      (r.allocationShare * 100).toFixed(1) + "%",
      r.allocatedHours.toFixed(2),
      // Parent totals appear on the primary allocation only, so a sum of the
      // export never double-counts a multi-block activity.
      r.isPrimaryAllocation && r.activityHours != null ? r.activityHours.toFixed(2) : "",
      formatTime(r.startTime),
      formatTime(r.finishTime),
      r.durationMinutes ?? "",
      r.vinesPerHour == null ? "" : r.vinesPerHour.toFixed(1),
      r.workTaskLabel ?? "",
      r.workTaskStatus ?? "",
      resolveUser(r.createdById) ?? "",
      r.createdAt ?? "",
      r.updatedAt ?? "",
      r.isReversed ? "Reversed" : "Recorded",
      r.notes,
    ];
    if (!canSeeCosts) return base;
    return [
      ...base,
      r.allocatedCost == null ? "" : r.allocatedCost.toFixed(2),
      r.isPrimaryAllocation && r.activityCost != null ? r.activityCost.toFixed(2) : "",
      r.hourlyRate == null ? "" : r.hourlyRate.toFixed(2),
      fmt.settings.currency_code,
    ];
  };


  const downloadCsv = () => {
    const header = canSeeCosts ? [...baseHeader, ...costHeader] : baseHeader;
    const lines = [header.map(csvSafe).join(",")];
    sorted.forEach((r) => lines.push(rowToCells(r).map(csvSafe).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pruning-activity-${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "CSV exported", description: `${sorted.length} entr${sorted.length === 1 ? "y" : "ies"} exported.` });
  };

  const filterSummary = () => {
    const parts: string[] = [];
    if (from || to) parts.push(`Date: ${from || "…"} → ${to || "…"}`);
    if (season !== ANY) parts.push(`Pruning season: ${season}`);
    if (blockId !== ANY) {
      parts.push(`${fmt.blockLabel}: ${blockOptions.find((b) => b.id === blockId)?.name ?? blockId}`);
    }
    if (worker !== ANY) parts.push(`Worker: ${worker}`);
    if (method !== ANY) parts.push(`Method: ${method}`);
    if (linked !== ANY) parts.push(`Work Task: ${linked === "yes" ? "linked" : "not linked"}`);
    if (includeReversed) parts.push("Includes reversed entries");
    return parts.length ? parts.join("  •  ") : "No filters applied";
  };

  const downloadPdf = async () => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 32;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Pruning Activity Report", margin, 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(
      `Vineyard: ${vineyardName ?? "—"}  •  Pruning season: ${season === ANY ? "All" : season}`,
      margin, 58,
    );
    doc.text(`Generated: ${fmt.dateTime(new Date())}`, pageWidth - margin, 58, { align: "right" });
    doc.setDrawColor(200);
    doc.line(margin, 66, pageWidth - margin, 66);
    doc.setFontSize(8);
    doc.setTextColor(100);
    const wrapped = doc.splitTextToSize(`Filters: ${filterSummary()}`, pageWidth - margin * 2);
    doc.text(wrapped, margin, 80);
    doc.setTextColor(0);

    // PDF mirrors exactly what is on screen — only the visible columns.
    const head = visibleColumns.map((c) => c.label);

    const pdfCell = (k: SortKey, r: PruningActivityRow): string => {
      switch (k) {
        case "date": return reportDateText(r.date);
        case "activity":
          return r.activityBlockCount > 1
            ? `${r.activityLabel} (${fmt.blockLabel.toLowerCase()} ${r.allocationIndex} of ${r.activityBlockCount})`
            : r.activityLabel;

        case "season": return r.hasSeasonLink ? String(r.seasonYear ?? "—") : "Unassigned";
        case "vintage": return r.vintageYear == null ? "—" : String(r.vintageYear);
        case "block": return r.blockName;
        case "variety": return r.variety;
        case "worker": return r.worker;
        case "method": return r.method;
        case "rows": return r.rowsLabel;
        case "quarters": return String(r.quarters);
        case "rowEq": return r.rowEquivalents.toFixed(2);
        case "vines": return r.vines.toLocaleString();
        case "share": return `${(r.allocationShare * 100).toFixed(1)}%`;
        case "hours": return r.allocatedHours.toFixed(2);
        case "start": return formatTime(r.startTime);
        case "finish": return formatTime(r.finishTime);
        case "duration": return formatDuration(r.durationMinutes);
        case "vinesPerHour": return r.vinesPerHour == null ? "—" : r.vinesPerHour.toFixed(0);
        case "rate": return money(r.hourlyRate);
        case "cost": return money(r.allocatedCost);
        case "activityHours":
          return r.isPrimaryAllocation && r.activityHours != null
            ? `${r.activityHours.toFixed(2)} (activity total)` : "";
        case "activityCost":
          return r.isPrimaryAllocation && r.activityCost != null
            ? `${money(r.activityCost)} (activity total)` : "";
        case "task": return r.workTaskLabel ?? "—";
        case "taskStatus": return r.workTaskStatus ?? "—";
        case "createdBy": return resolveUser(r.createdById) ?? "—";
        case "created": return r.createdAt ? formatDate(r.createdAt.slice(0, 10)) : "—";
        case "updated": return r.updatedAt ? formatDate(r.updatedAt.slice(0, 10)) : "—";
        case "status": return r.isReversed ? "Reversed" : "Recorded";
        default: return "";
      }
    };

    const body = sorted.map((r) => visibleColumns.map((c) => pdfCell(c.key, r)));

    const pdfTotal = (k: SortKey): string => {
      switch (k) {
        case "quarters": return String(totals.quarters);
        case "rowEq": return totals.rowEq.toFixed(2);
        case "vines": return totals.vines.toLocaleString();
        case "hours": return totals.hours.toFixed(2);
        case "vinesPerHour": return avgVinesPerHour == null ? "—" : avgVinesPerHour.toFixed(0);
        case "cost": return money(totals.cost);
        case "activityHours": return totals.activityHours.toFixed(2);
        case "activityCost": return money(totals.activityCost);
        default: return "";
      }
    };

    const totalsRow = visibleColumns.map((c, i) =>
      i === 0 ? "Totals (active only)" : pdfTotal(c.key),
    );


    autoTable(doc, {
      head: [head],
      body: [...body, totalsRow],
      startY: 80 + wrapped.length * 10 + 8,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.5, cellPadding: 3 },
      headStyles: { fillColor: [40, 62, 44], textColor: 255 },
    });

    doc.save(`pruning-activity-${format(new Date(), "yyyy-MM-dd")}.pdf`);
    toast({ title: "PDF exported", description: `${sorted.length} entr${sorted.length === 1 ? "y" : "ies"} included.` });
  };

  const colSpan = visibleColumns.length + (canEdit ? 1 : 0);

  /** Short, stable badge text so allocations of one activity read as a group. */
  const activityCode = (r: PruningActivityRow) =>
    r.activityId ? r.activityId.replace(/-/g, "").slice(0, 5).toUpperCase() : "—";



  const cellClass = (k: SortKey): string => {
    const def = availableColumns.find((c) => c.key === k);
    const right = def?.align === "right" ? "text-right tabular-nums" : "";
    switch (k) {
      case "date":
      case "start":
      case "finish":
        return `whitespace-nowrap ${right}`.trim();
      case "block":
        return "font-medium";
      case "variety":
      case "rows":
        return "max-w-[180px] truncate";
      case "method":
        return "capitalize";
      case "cost":
        return "text-right tabular-nums font-medium";
      case "taskStatus":
      case "createdBy":
      case "created":
      case "updated":
        return "text-xs whitespace-nowrap";
      default:
        return right;
    }
  };

  const renderCell = (k: SortKey, r: PruningActivityRow): React.ReactNode => {
    switch (k) {
      case "date":
        return (
          <>
            <div>{formatDate(r.date)}</div>
            {(r.startTime || r.finishTime) && (
              <div className="text-[11px] text-muted-foreground">
                {formatTime(r.startTime)}–{formatTime(r.finishTime)}
              </div>
            )}
          </>
        );
      case "activity":
        return r.activityId ? (
          <div className="flex flex-col gap-0.5">
            <Badge variant="outline" className="font-mono text-[10px] w-fit">{activityCode(r)}</Badge>
            {r.activityBlockCount > 1 && (
              <span className="text-[11px] text-muted-foreground">
                {fmt.blockLabel.toLowerCase()} {r.allocationIndex} of {r.activityBlockCount}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">Single entry</span>
        );
      case "season":
        if (!r.hasSeasonLink) return <span className="text-muted-foreground">Unassigned</span>;
        if (!r.seasonMismatch) return r.seasonYear;
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 cursor-help">
                  {r.seasonYear} <AlertTriangle className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[280px]">
                This entry's season information does not match the linked pruning season.
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {r.seasonIssues.map((i) => <li key={i}>{i}</li>)}
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case "vintage": return r.vintageYear ?? "—";
      case "block": return r.blockName;
      case "variety": return <span title={r.variety}>{r.variety}</span>;
      case "worker": return r.worker;
      case "method": return r.method;
      case "rows":
        return (
          <span title={r.rowsLabel}>
            {r.rowsLabel}
            {r.rowCount > 0 && <span className="text-[11px] text-muted-foreground"> ({r.rowCount})</span>}
          </span>
        );
      case "quarters": return r.quarters;
      case "rowEq": return r.rowEquivalents.toFixed(2);
      case "vines": return r.vines.toLocaleString();
      case "share":
        return (
          <span title="Share of this activity's total row equivalents">
            {(r.allocationShare * 100).toFixed(1)}%
          </span>
        );
      case "hours": return r.allocatedHours.toFixed(2);
      case "start": return formatTime(r.startTime);
      case "finish": return formatTime(r.finishTime);
      case "duration": return formatDuration(r.durationMinutes);
      case "vinesPerHour": return r.vinesPerHour == null ? "—" : r.vinesPerHour.toFixed(0);
      case "rate": return money(r.hourlyRate);
      case "cost": return money(r.allocatedCost);
      case "activityHours":
        return r.isPrimaryAllocation && r.activityHours != null ? (
          <span>
            {r.activityHours.toFixed(2)}
            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
              Activity total
            </span>
          </span>
        ) : <span className="text-muted-foreground text-xs">—</span>;
      case "activityCost":
        return r.isPrimaryAllocation && r.activityCost != null ? (
          <span className="font-medium">
            {money(r.activityCost)}
            <span className="block text-[10px] uppercase tracking-wide font-normal text-muted-foreground">
              Activity total
            </span>
          </span>
        ) : <span className="text-muted-foreground text-xs">—</span>;

      case "task":
        return r.workTaskId ? (
          <Link
            to={`/work-tasks?highlight=${r.workTaskId}`}
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            {r.workTaskLabel} <ExternalLink className="h-3 w-3" />
          </Link>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        );
      case "taskStatus":
        return r.workTaskStatus
          ? <span className="capitalize">{r.workTaskStatus}</span>
          : <span className="text-muted-foreground">—</span>;
      case "createdBy": return resolveUser(r.createdById) ?? "—";
      case "created": return r.createdAt ? formatDate(r.createdAt.slice(0, 10)) : "—";
      case "updated": return r.updatedAt ? formatDate(r.updatedAt.slice(0, 10)) : "—";
      case "status":
        return r.isReversed
          ? <Badge variant="destructive">Reversed</Badge>
          : <span className="text-xs text-muted-foreground">Recorded</span>;
      default: return null;
    }
  };

  const totalsCell = (k: SortKey): React.ReactNode => {
    switch (k) {
      case "quarters": return <span className="font-medium">{totals.quarters}</span>;
      case "rowEq": return <span className="font-medium">{totals.rowEq.toFixed(2)}</span>;
      case "vines": return <span className="font-medium">{totals.vines.toLocaleString()}</span>;
      case "hours": return <span className="font-medium">{totals.hours.toFixed(2)}</span>;
      case "vinesPerHour":
        return <span className="font-medium">{avgVinesPerHour == null ? "—" : avgVinesPerHour.toFixed(0)}</span>;
      case "cost": return <span className="font-semibold">{money(totals.cost)}</span>;
      case "activityHours": return <span className="font-medium">{totals.activityHours.toFixed(2)}</span>;
      case "activityCost": return <span className="font-semibold">{money(totals.activityCost)}</span>;
      default: return null;
    }
  };


  return (
    <div className="p-4 sm:p-6 space-y-4 w-full">

      <PageHead
        title="Pruning Activity Report | VineTrack"
        description="Per-entry pruning activity report with rows worked, vines, labour hours, productivity and linked work tasks."
        path="/reports/pruning-activity"
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Scissors className="h-5 w-5" /> Pruning Activity Report
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every recorded pruning entry, with rows worked, vines, labour hours and
            productivity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NewPruningActivityButton seasonYear={new Date().getFullYear()} />
          <Button asChild variant="outline" size="sm">
            <Link to="/tools/pruning-tracker">
              Open Pruning Tracker <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </div>

      </div>

      {error && (
        <Card className="p-4 text-sm text-destructive">
          Couldn't load pruning activity: {(error as any)?.message ?? String(error)}
        </Card>
      )}

      {/* -------------------- Summary -------------------- */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Matching allocations",
            value: filtered.length.toLocaleString(),
            hint: `${totals.activities.toLocaleString()} activit${totals.activities === 1 ? "y" : "ies"} • ${reversedCount.toLocaleString()} reversed`,
          },
          { label: "Vines pruned", value: totals.vines.toLocaleString(), hint: "Across the filtered blocks" },
          {
            label: blockId === ANY ? "Allocated labour hours" : "Allocated labour hours (filtered blocks)",
            value: totals.hours.toFixed(2),
            hint: "Share of activity hours by row equivalents",
          },
          {
            label: "Total activity labour hours",
            value: totals.activityHours.toFixed(2),
            hint: "Each activity counted once",
          },
          { label: "Avg vines / hour", value: avgVinesPerHour == null ? "—" : avgVinesPerHour.toFixed(0), hint: "Vines ÷ allocated hours" },
          ...(canSeeCosts ? [
            {
              label: blockId === ANY ? "Allocated labour cost" : "Allocated labour cost (filtered blocks)",
              value: money(totals.cost),
              hint: "Activity cost split by row equivalents",
            },
            {
              label: "Total activity labour cost",
              value: money(totals.activityCost),
              hint: "Each activity counted once",
            },
          ] : []),
        ].map((s) => (
          <Card key={s.label} className="p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
            <div className="text-xl font-semibold tabular-nums mt-1">{s.value}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{s.hint}</div>
          </Card>
        ))}
      </div>


      {/* -------------------- Filters -------------------- */}
      <Card className="p-3 space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search block, worker, rows, notes…"
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span className="text-xs text-muted-foreground">→</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>
          <Select value={season} onValueChange={setSeason}>
            <SelectTrigger><SelectValue placeholder="Pruning season" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All pruning seasons</SelectItem>
              {hasUnassigned && <SelectItem value={UNASSIGNED}>Unassigned season</SelectItem>}

              {seasonOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>{y} pruning season</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={blockId} onValueChange={setBlockId}>
            <SelectTrigger><SelectValue placeholder={fmt.blockLabel} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All {fmt.blocksLabel.toLowerCase()}</SelectItem>
              {blockOptions.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={worker} onValueChange={setWorker}>
            <SelectTrigger><SelectValue placeholder="Worker / crew" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All workers / crews</SelectItem>
              {workerOptions.map((w) => (
                <SelectItem key={w} value={w}>{w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger><SelectValue placeholder="Method" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All methods</SelectItem>
              {methodOptions.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={linked} onValueChange={setLinked}>
            <SelectTrigger><SelectValue placeholder="Work Task link" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Linked and unlinked</SelectItem>
              <SelectItem value="yes">With linked Work Task</SelectItem>
              <SelectItem value="no">Without linked Work Task</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeReversed}
              onCheckedChange={(v) => setIncludeReversed(v === true)}
            />
            Include reversed entries
          </label>
        </div>
        <div className="text-xs text-muted-foreground">
          {isLoading ? "Loading…" : `${filtered.length} of ${rows.length} entr${rows.length === 1 ? "y" : "ies"}`}
        </div>
      </Card>

      {/* -------------- Season integrity diagnostic (temporary) -------------- */}
      {showSeasonDiagnostics && integrityRows.length > 0 && (
        <Collapsible>
          <Card className="p-3 border-amber-500/40 bg-amber-500/5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div>
                  <div className="font-medium">
                    {integrityRows.length} entr{integrityRows.length === 1 ? "y has" : "ies have"} inconsistent pruning-season data
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Displayed seasons still come from the linked pruning season record —
                    nothing is corrected or guessed here. Read-only diagnostic pending the
                    historical data fix.
                  </div>
                </div>
              </div>
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="outline">View diagnostic</Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="mt-3 space-y-4">
              {integrityGroups.map((g) => (
                <div key={g.platform} className="space-y-1">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {g.platform} — {g.items.length} entr{g.items.length === 1 ? "y" : "ies"}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="p-1">Entry ID</th>
                          <th className="p-1">Entry date</th>
                          <th className="p-1">Vineyard</th>
                          <th className="p-1">{fmt.blockLabel}</th>
                          <th className="p-1">Stored season ID</th>
                          <th className="p-1">Linked season year</th>
                          <th className="p-1">Expected season year</th>
                          <th className="p-1">Stored vintage</th>
                          <th className="p-1">Created</th>
                          <th className="p-1">Updated</th>
                          <th className="p-1">Reversed</th>
                          <th className="p-1">Issue</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {g.items.map((r) => (
                          <tr key={r.id} className="border-t border-border/50 align-top">
                            <td className="p-1">{r.id}</td>
                            <td className="p-1">{r.date}</td>
                            <td className="p-1 font-sans">{vineyardName ?? "—"}</td>
                            <td className="p-1 font-sans">{r.blockName}</td>
                            <td className="p-1">{r.pruningSeasonId ?? "—"}</td>
                            <td className="p-1">{r.hasSeasonLink ? r.seasonYear ?? "—" : "not found"}</td>
                            <td className="p-1">{r.expectedSeasonYear ?? "—"}</td>
                            <td className="p-1">{r.vintageYear ?? "—"}</td>
                            <td className="p-1">{r.createdAt ?? "—"}</td>
                            <td className="p-1">{r.updatedAt ?? "—"}</td>
                            <td className="p-1">{r.isReversed ? "yes" : "no"}</td>
                            <td className="p-1 font-sans">
                              {r.hasSeasonLink ? r.seasonIssues.join(" ") : "No linked pruning season record."}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const header = [
                    "entry_id", "entry_date", "vineyard", "block", "source_platform",
                    "stored_pruning_season_id", "linked_season_year", "expected_season_year",
                    "stored_vintage_year", "created_at", "updated_at", "reversed", "issue",
                  ];
                  const lines = [header.join(",")];
                  integrityRows.forEach((r) => lines.push([
                    r.id, r.date, vineyardName ?? "", r.blockName, r.sourcePlatform ?? "",
                    r.pruningSeasonId ?? "", r.hasSeasonLink ? r.seasonYear ?? "" : "not_found",
                    r.expectedSeasonYear ?? "", r.vintageYear ?? "", r.createdAt ?? "",
                    r.updatedAt ?? "", r.isReversed ? "yes" : "no",
                    r.hasSeasonLink ? r.seasonIssues.join(" ") : "No linked pruning season record.",
                  ].map(csvSafe).join(",")));

                  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `pruning-season-integrity-${format(new Date(), "yyyy-MM-dd")}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> Export diagnostic CSV
              </Button>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      <div className="flex items-center justify-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <Columns3 className="h-3.5 w-3.5 mr-1" />
              Columns ({visibleColumns.length}/{availableColumns.length})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 max-h-[70vh] overflow-y-auto">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {availableColumns.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={isVisible(c.key)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => toggleColumn(c.key)}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setHidden(new Set())}>Show all</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setHidden(new Set(DEFAULT_HIDDEN))}>Reset to default</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" variant="outline" onClick={downloadPdf} disabled={!sorted.length}>
          <Download className="h-3.5 w-3.5 mr-1" /> Export PDF
        </Button>
        <Button size="sm" onClick={downloadCsv} disabled={!sorted.length}>
          <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
        </Button>
      </div>


      {/* -------------------- Table -------------------- */}
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {visibleColumns.map((c) => (
                <SortableTableHead
                  key={c.key}
                  align={c.align}
                  active={getSortDirection(c.key)}
                  onSort={() => toggleSort(c.key)}
                >
                  {c.label}
                </SortableTableHead>
              ))}
              {canEdit && <th className="h-10 px-2 text-right align-middle text-xs font-medium text-muted-foreground sticky right-0 bg-background border-l shadow-[-6px_0_8px_-8px_hsl(var(--foreground)/0.3)]">Edit</th>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center text-sm text-muted-foreground py-8">
                  {isLoading ? "Loading…" : "No pruning entries match the current filters."}
                </TableCell>
              </TableRow>
            ) : sorted.map((r) => (
              <TableRow
                key={r.id}
                className={[
                  r.isReversed ? "bg-muted/20" : "",
                  // Grouping treatment: allocations of one activity share a left rule.
                  r.activityBlockCount > 1 ? "border-l-2 border-l-primary/50" : "",
                  r.activityBlockCount > 1 && !r.isPrimaryAllocation ? "bg-muted/10" : "",
                ].filter(Boolean).join(" ") || undefined}
              >
                {visibleColumns.map((c) => (
                  <TableCell key={c.key} className={cellClass(c.key)}>{renderCell(c.key, r)}</TableCell>
                ))}
                {canEdit && (
                  <TableCell className="text-right sticky right-0 bg-background border-l shadow-[-6px_0_8px_-8px_hsl(var(--foreground)/0.3)]">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={r.isReversed}
                      onClick={() => setEditRow(r)}
                      aria-label={`Edit pruning entry from ${formatDate(r.date)}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
          {sorted.length > 0 && (
            <TableBody>
              <TableRow className="bg-muted/30">
                {visibleColumns.map((c, i) => (
                  <TableCell key={c.key} className={cellClass(c.key)}>
                    {i === 0 ? <span className="font-medium">Totals (active only)</span> : totalsCell(c.key)}
                  </TableCell>
                ))}
                {canEdit && <TableCell />}
              </TableRow>
            </TableBody>
          )}
        </Table>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Rows sharing an activity code belong to one pruning activity. Labour hours and
        labour cost are recorded once on the activity; the <em>allocated</em> columns split
        them across blocks by each block's share of the activity's row equivalents
        (rounding differences are applied to the largest allocation so the allocated
        figures always add back to the activity total). Activity totals are shown once,
        on the first allocation, and are counted once in the report totals. Labour cost
        and effective rate come from the labour lines of the linked Work Task; activities
        without one show no cost. Reversed entries stay visible for audit but are excluded
        from all totals and averages (average vines / hour = active vines ÷ allocated hours).
      </p>


      {editRow && selectedVineyardId && (() => {
        const editable = sorted.filter((r) => !r.isReversed);
        const idx = editable.findIndex((r) => r.id === editRow.id);
        const onPrev = idx > 0 ? () => setEditRow(editable[idx - 1]) : undefined;
        const onNext = idx >= 0 && idx < editable.length - 1
          ? () => setEditRow(editable[idx + 1]) : undefined;
        const navLabel = idx >= 0 ? `${idx + 1} / ${editable.length}` : undefined;

        // SQL 166: entries that belong to a parent activity open in the
        // multi-block editor. Legacy entries without a parent keep the
        // single-block editor.
        if (editRow.activityId) {
          return (
            <PruningActivityDialog
              key={editRow.activityId}
              open={!!editRow}
              onOpenChange={(o) => { if (!o) setEditRow(null); }}
              vineyardId={selectedVineyardId}
              seasonYear={editRow.seasonYear ?? new Date().getFullYear()}
              activityId={editRow.activityId}
              onPrev={onPrev}
              onNext={onNext}
              navLabel={navLabel}
            />
          );
        }

        return (
          <ReportEditPruningDialog
            key={editRow.id}
            open={!!editRow}
            onOpenChange={(o) => { if (!o) setEditRow(null); }}
            entry={editRow.entry}
            vineyardId={selectedVineyardId}
            paddockName={editRow.blockName}
            onPrev={onPrev}
            onNext={onNext}
            navLabel={navLabel}
          />
        );
      })()}

    </div>
  );
}
