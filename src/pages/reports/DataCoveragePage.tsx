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

function IssueRow({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false);
  const canExpand = issue.details.length > 0;
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
            </div>
            <ul className="text-sm space-y-1">
              {issue.details.map((d) => (
                <li key={d.id} className="flex items-baseline gap-2">
                  <span className="font-medium">{d.label}</span>
                  {d.context && (
                    <span className="text-muted-foreground text-xs">— {d.context}</span>
                  )}
                </li>
              ))}
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
