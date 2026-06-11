import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import {
  runDataCoverage,
  dataCoverageCsv,
  type Issue,
  type IssueDetail,
  type IssueGroup,
  type Severity,
} from "@/lib/dataCoverageQuery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, Copy, Download, ExternalLink, RefreshCw } from "lucide-react";

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: "bg-red-600 text-white hover:bg-red-600",
  warning: "bg-amber-500 text-white hover:bg-amber-500",
  info: "bg-slate-500 text-white hover:bg-slate-500",
};

const GROUPS: IssueGroup[] = [
  "Work Tasks",
  "Trips",
  "Spray",
  "Maintenance",
  "Fuel",
  "Pins",
  "Blocks",
  "Equipment",
];

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Resolve a navigation target for an affected record. We deliberately do NOT
 * invent new edit forms; we only navigate to existing list/detail surfaces.
 * Most list pages have a local filter, so a "Copy ID" affordance is offered
 * alongside "Open" so the user can paste the id into the filter box.
 *
 * Returns null when no safe surface exists (composite keys, equipment
 * cross-table issues).
 */
function resolveOpenHref(issue: Issue, detail: IssueDetail): string | null {
  switch (issue.key) {
    case "block_no_area":
    case "block_no_rows":
    case "block_no_variety":
    case "block_bad_variety_sum":
      return `/setup/paddocks/${detail.id}`;
    case "pin_no_block":
    case "pin_no_row":
    case "pin_deleted_block":
      return "/pins";
    case "pin_dup_risk": {
      const pid = detail.id.split("|")[0];
      return pid ? `/setup/paddocks/${pid}` : "/pins";
    }
    case "trip_no_block":
    case "trip_no_machine":
    case "trip_no_operator":
    case "trip_deleted_task":
    case "trip_bad_duration":
      return "/trips";
    case "wt_no_block":
    case "wt_no_area":
    case "wt_machine_no_stable_id":
    case "wt_trips_with_corrections":
    case "wt_labour_missing_category":
      return "/work-tasks";
    case "spray_no_machine":
    case "spray_no_equipment":
    case "spray_orphan_trip":
    case "spray_no_weather":
    case "spray_legacy_free_text":
      return "/spray-records";
    case "maint_free_text":
    case "maint_missing_ref":
    case "maint_dangling_ref":
    case "maint_missing_date_cost":
      return "/maintenance";
    case "fuel_no_equip":
    case "fuel_legacy_tractor_only":
      return "/tractor-fuel-logs";
    case "fuel_purchase_missing":
      return "/fuel-purchases";
    case "equip_legacy_tractor_machine":
      return "/setup/vineyard-machines";
    case "equip_dup_name":
    case "equip_missing_ref":
    default:
      return null;
  }
}

function IssueRow({
  issue,
  onOpen,
}: {
  issue: Issue;
  onOpen: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const canExpand = issue.details.length > 0;
  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast({ title: "Copied", description: "Record ID copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: id, variant: "destructive" });
    }
  };
  return (
    <>
      <TableRow>
        <TableCell className="w-8 align-top">
          {canExpand ? (
            <button
              onClick={() => setOpen((v) => !v)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={open ? "Collapse" : "Expand"}
            >
              {open ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : null}
        </TableCell>
        <TableCell className="align-top">
          <div className="font-medium text-foreground">{issue.name}</div>
          <div className="text-xs text-muted-foreground mt-1">{issue.explanation}</div>
          <div className="text-xs text-foreground/80 mt-1">
            <span className="font-medium">Suggested:</span> {issue.suggestedAction}
          </div>
        </TableCell>
        <TableCell className="align-top">
          <Badge className={SEVERITY_BADGE[issue.severity]} variant="secondary">
            {issue.severity}
          </Badge>
        </TableCell>
        <TableCell className="align-top text-right tabular-nums font-semibold">
          {issue.count}
        </TableCell>
      </TableRow>
      {open && canExpand && (
        <TableRow>
          <TableCell />
          <TableCell colSpan={3} className="bg-muted/30">
            <div className="text-xs text-muted-foreground mb-2">
              Showing {issue.details.length} of {issue.count} affected record(s).
              Use <span className="font-medium">Open</span> to jump to the related
              page, or <span className="font-medium">Copy ID</span> to paste into a
              filter.
            </div>
            <ul className="text-sm divide-y divide-border/60">
              {issue.details.map((d) => {
                const href = resolveOpenHref(issue, d);
                return (
                  <li key={d.id} className="flex items-center gap-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        <span className="font-medium">{d.label}</span>
                        {d.context && (
                          <span className="text-muted-foreground text-xs ml-2">
                            — {d.context}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground/80 font-mono truncate">
                        {d.id}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => copyId(d.id)}
                        title="Copy ID"
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Copy ID
                      </Button>
                      {href ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => onOpen(href)}
                          title={`Open ${href}`}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Open
                        </Button>
                      ) : (
                        <span
                          className="text-[10px] text-muted-foreground px-2"
                          title="No direct edit surface — review manually using the ID above."
                        >
                          Review manually
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "total" | "critical" | "warning" | "info";
}) {
  const colour =
    tone === "critical"
      ? "text-red-600"
      : tone === "warning"
        ? "text-amber-600"
        : tone === "info"
          ? "text-slate-600"
          : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className={`text-2xl font-semibold mt-1 ${colour}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default function DataCoveragePage() {
  const { selectedVineyardId } = useVineyard();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["data-coverage", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => runDataCoverage(selectedVineyardId!),
    staleTime: 60_000,
  });

  const grouped = useMemo(() => {
    const map = new Map<IssueGroup, Issue[]>();
    GROUPS.forEach((g) => map.set(g, []));
    (query.data?.issues ?? []).forEach((i) => {
      map.get(i.group)?.push(i);
    });
    map.forEach((arr) =>
      arr.sort((a, b) => {
        const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        return s !== 0 ? s : b.count - a.count;
      }),
    );
    return map;
  }, [query.data]);

  const totalCriticalCount = useMemo(
    () =>
      (query.data?.issues ?? [])
        .filter((i) => i.severity === "critical")
        .reduce((sum, i) => sum + i.count, 0),
    [query.data],
  );
  const totalWarningCount = useMemo(
    () =>
      (query.data?.issues ?? [])
        .filter((i) => i.severity === "warning")
        .reduce((sum, i) => sum + i.count, 0),
    [query.data],
  );
  const totalInfoCount = useMemo(
    () =>
      (query.data?.issues ?? [])
        .filter((i) => i.severity === "info")
        .reduce((sum, i) => sum + i.count, 0),
    [query.data],
  );
  const totalAll = totalCriticalCount + totalWarningCount + totalInfoCount;

  const handleCsv = () => {
    if (!query.data) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`data-coverage-${stamp}.csv`, dataCoverageCsv(query.data));
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Data Coverage</h1>
          <p className="text-sm text-muted-foreground">
            Read-only diagnostics for the currently selected vineyard. No fixes are
            applied — review the items below and edit affected records on iOS or in
            the relevant portal page.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${query.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleCsv}
            disabled={!query.data || query.data.issues.length === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </div>
      </div>

      {query.isLoading && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Running data quality checks…
          </CardContent>
        </Card>
      )}

      {query.error && (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            Failed to load data coverage: {(query.error as Error).message}
          </CardContent>
        </Card>
      )}

      {query.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Total affected records" value={totalAll} tone="total" />
            <SummaryCard label="Critical" value={totalCriticalCount} tone="critical" />
            <SummaryCard label="Warnings" value={totalWarningCount} tone="warning" />
            <SummaryCard label="Info" value={totalInfoCount} tone="info" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vineyard totals</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5 text-sm">
              {Object.entries(query.data.totals).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between border-b py-1">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-semibold tabular-nums">{v}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {GROUPS.map((group) => {
            const issues = grouped.get(group) ?? [];
            const groupTotal = issues.reduce((s, i) => s + i.count, 0);
            return (
              <Card key={group}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">{group}</CardTitle>
                  <div className="text-xs text-muted-foreground">
                    {issues.length === 0
                      ? "No issues detected."
                      : `${issues.length} issue type(s) · ${groupTotal} record(s)`}
                  </div>
                </CardHeader>
                {issues.length > 0 && (
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8" />
                          <TableHead>Issue</TableHead>
                          <TableHead className="w-28">Severity</TableHead>
                          <TableHead className="w-24 text-right">Count</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {issues.map((i) => (
                          <IssueRow key={i.key} issue={i} />
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                )}
              </Card>
            );
          })}

          <p className="text-xs text-muted-foreground">
            Generated at {new Date(query.data.generatedAt).toLocaleString()}.
            Detail lists are capped at 50 rows per issue.
          </p>
        </>
      )}
    </div>
  );
}
