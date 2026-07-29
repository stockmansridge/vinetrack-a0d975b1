import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  useReportSessions,
  type DrillDown,
  type IrrigationReportFilters,
} from "@/lib/irrigationReportsQuery";
import { ReportWarnings } from "./ReportShell";
import { useIrrigationUnits, EMPTY } from "@/lib/irrigationUnits";

const PAGE = 50;

export function SessionDrillDownDialog({
  vineyardId,
  filters,
  drill,
  onClose,
}: {
  vineyardId: string | null;
  filters: IrrigationReportFilters;
  drill: DrillDown | null;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const u = useIrrigationUnits();
  const q = useReportSessions(vineyardId, filters, drill, PAGE, page * PAGE);
  const sessions = q.data?.sessions ?? [];
  const total = q.data?.total_count ?? 0;

  return (
    <Dialog
      open={!!drill}
      onOpenChange={(open) => {
        if (!open) {
          setPage(0);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{drill?.title ?? "Sessions"}</DialogTitle>
          <DialogDescription>
            Individual irrigation sessions behind this figure, filtered exactly as the report.
          </DialogDescription>
        </DialogHeader>

        {q.error ? (
          <PortalNotice
            variant="error"
            title="Couldn't load sessions"
            description={(q.error as Error).message}
          />
        ) : q.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <ReportWarnings warnings={q.data?.warnings} />
            <div className="max-h-[55vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Valve</TableHead>
                    <TableHead>System</TableHead>
                    <TableHead className="text-right">Water</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Calculation</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{u.date(s.session_date)}</TableCell>
                      <TableCell>{s.valve_name ?? EMPTY}</TableCell>
                      <TableCell>{s.system_name ?? EMPTY}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {u.volume(s.total_volume_litres)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {u.duration(s.duration_minutes)}
                      </TableCell>
                      <TableCell>{s.calculation_label ?? s.calculation_method ?? EMPTY}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal">
                          {s.source_label ?? s.source_type ?? EMPTY}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {sessions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-sm text-muted-foreground">
                        No sessions matched this selection.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Showing {sessions.length ? page * PAGE + 1 : 0}–{page * PAGE + sessions.length} of{" "}
                {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(page + 1) * PAGE >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/irrigation/history">
                    Full history <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
