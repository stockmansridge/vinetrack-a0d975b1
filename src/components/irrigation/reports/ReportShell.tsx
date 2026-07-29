import type { ReactNode } from "react";
import { AlertTriangle, Download, FileText, Info, OctagonAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  IrrigationReportFilters,
  ReportEnvelopeBase,
  ReportWarning,
} from "@/lib/irrigationReportsQuery";
import {
  exportReportCsv,
  exportReportPdf,
  type ExportColumn,
} from "@/lib/irrigationReportExport";
import { CANONICAL_UNITS } from "@/lib/irrigationUnits";

// ---------------------------------------------------------------------------
// Warnings — rendered verbatim from the backend, never invented client-side.
// ---------------------------------------------------------------------------

export function ReportWarnings({
  warnings,
  className,
}: {
  warnings: ReportWarning[] | null | undefined;
  className?: string;
}) {
  if (!warnings?.length) return null;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...warnings].sort(
    (a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3),
  );
  return (
    <div className={cn("space-y-2", className)}>
      {sorted.map((w, i) => (
        <PortalNotice
          key={`${w.code}-${i}`}
          variant={w.severity === "error" ? "error" : w.severity === "info" ? "info" : "warning"}
          compact
          title={w.message}
          description={
            w.affected_count != null
              ? `${w.affected_count} record${w.affected_count === 1 ? "" : "s"} affected · ${w.code}`
              : w.code
          }
        />
      ))}
    </div>
  );
}

export function WarningIcon({ warnings }: { warnings: ReportWarning[] | null | undefined }) {
  if (!warnings?.length) return null;
  const worst = warnings.some((w) => w.severity === "error")
    ? "error"
    : warnings.some((w) => w.severity === "warning")
      ? "warning"
      : "info";
  const Icon = worst === "error" ? OctagonAlert : worst === "warning" ? AlertTriangle : Info;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="ml-1.5 inline-flex align-middle text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <ul className="space-y-1 text-xs">
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Generic report section
// ---------------------------------------------------------------------------

export interface ReportColumn<Row> {
  key: string;
  header: string;
  hint?: string;
  align?: "left" | "right";
  cell: (row: Row) => ReactNode;
  /** Canonical (unconverted) value written to CSV/PDF exports. */
  exportValue?: (row: Row) => string | number | null;
}

interface ReportSectionProps<Row> {
  title: string;
  description?: string;
  fileSlug: string;
  vineyardName: string;
  filters: IrrigationReportFilters;
  envelope: ReportEnvelopeBase | null | undefined;
  rows: Row[] | null | undefined;
  columns: ReportColumn<Row>[];
  rowKey: (row: Row, index: number) => string;
  rowWarnings?: (row: Row) => ReportWarning[] | null | undefined;
  onRowClick?: (row: Row) => void;
  isLoading: boolean;
  error: unknown;
  emptyLabel?: string;
  chart?: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
}

export function ReportSection<Row>({
  title,
  description,
  fileSlug,
  vineyardName,
  filters,
  envelope,
  rows,
  columns,
  rowKey,
  rowWarnings,
  onRowClick,
  isLoading,
  error,
  emptyLabel = "No irrigation matched these filters.",
  chart,
  footer,
  actions,
}: ReportSectionProps<Row>) {
  const data = rows ?? [];

  const exportColumns: ExportColumn<Row>[] = columns.map((c) => ({
    header: c.header,
    value: (row) =>
      c.exportValue
        ? c.exportValue(row)
        : typeof c.cell(row) === "string" || typeof c.cell(row) === "number"
          ? (c.cell(row) as string | number)
          : null,
  }));

  const meta = {
    reportTitle: title,
    vineyardName,
    envelope,
    filters,
    unitNote: CANONICAL_UNITS,
  };
  const stamp = envelope?.vintage_year ?? filters.vintage_year ?? "";

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Button
            size="sm"
            variant="outline"
            disabled={!data.length}
            onClick={() =>
              exportReportCsv(`${fileSlug}-${stamp}.csv`, data, exportColumns, meta)
            }
          >
            <Download className="mr-1.5 h-4 w-4" /> CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!data.length}
            onClick={() =>
              exportReportPdf(`${fileSlug}-${stamp}.pdf`, data, exportColumns, meta)
            }
          >
            <FileText className="mr-1.5 h-4 w-4" /> PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {error ? (
          <PortalNotice
            variant="error"
            title={`Couldn't load ${title.toLowerCase()}`}
            description={(error as Error).message}
          />
        ) : isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <>
            <ReportWarnings warnings={envelope?.warnings} />
            {chart}
            {data.length === 0 ? (
              <div className="px-1 py-6 text-sm text-muted-foreground">{emptyLabel}</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columns.map((c) => (
                        <TableHead
                          key={c.key}
                          className={c.align === "right" ? "text-right" : undefined}
                          title={c.hint}
                        >
                          {c.header}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((row, i) => (
                      <TableRow
                        key={rowKey(row, i)}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                        className={onRowClick ? "cursor-pointer" : undefined}
                      >
                        {columns.map((c, ci) => (
                          <TableCell
                            key={c.key}
                            className={cn(
                              c.align === "right" && "text-right tabular-nums",
                              ci === 0 && "font-medium",
                            )}
                          >
                            {c.cell(row)}
                            {ci === 0 && rowWarnings && (
                              <WarningIcon warnings={rowWarnings(row)} />
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {footer}
            {envelope?.generated_at && (
              <p className="pt-1 text-xs text-muted-foreground">
                Server generated {new Date(envelope.generated_at).toLocaleString()}
                {envelope.timezone ? ` · ${envelope.timezone}` : ""}
                {onRowClick ? " · select a row to view the sessions behind it" : ""}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
