import { useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { toast } from "sonner";
import {
  litresToCubicLabel,
  useImportRows,
  useSetRowOverride,
  type DuplicateStatus,
  type ImportRow,
  type RowValidationStatus,
  type VolumeComparison,
  COMPARISON_LABEL,
} from "@/lib/irrigationImportQuery";

const STATUS_FILTERS: Array<{ value: RowValidationStatus | "all"; label: string }> = [
  { value: "all", label: "All events" },
  { value: "eligible", label: "Eligible" },
  { value: "excluded", label: "Excluded" },
  { value: "needs_review", label: "Needs review" },
  { value: "error", label: "Parse errors" },
];

const DUPLICATE_LABEL: Record<DuplicateStatus, string> = {
  new: "New",
  duplicate_imported: "Already imported",
  duplicate_ignored: "Duplicate (ignored)",
  duplicate_reviewed: "Duplicate (reviewed)",
  possible_duplicate_changed_values: "Possible duplicate — values changed",
};

const humanise = (value: string) =>
  value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const statusVariant = (status: RowValidationStatus) =>
  status === "eligible" ? "default" : status === "error" ? "destructive" : "secondary";

/** Contract copy for threshold/Test exclusions — values come from the server. */
function exclusionExplanation(
  row: ImportRow,
  thresholdLitres: number | null | undefined,
  comparison: VolumeComparison | null | undefined,
  fallback?: string | null,
  providerLabel?: string,
): string | null {
  const water = row.parsed_water_litres;
  if (row.classification === "at_volume_threshold") {
    return `This event was not selected because the rule requires ${
      COMPARISON_LABEL[comparison ?? "greater_than"]
    } ${litresToCubicLabel(thresholdLitres)}.`;
  }
  if (row.classification === "below_volume_threshold") {
    return `This event was not selected because its reported water quantity is ${litresToCubicLabel(
      water,
    )}. The ${providerLabel ?? "import"} minimum is ${
      COMPARISON_LABEL[comparison ?? "greater_than"]
    } ${litresToCubicLabel(thresholdLitres)}, which helps exclude controller tests and very short runs.`;
  }
  if (row.classification === "test") {
    return "This event belongs to a Test program. Test programs are excluded by default for this controller.";
  }
  return fallback ?? null;
}

export function ImportRowReview({
  batchId,
  thresholdLitres,
  volumeComparison,
  thresholdExplanation,
  providerLabel,
}: {
  batchId: string;
  providerLabel?: string;
  thresholdLitres?: number | null;
  volumeComparison?: VolumeComparison | null;
  thresholdExplanation?: string | null;
}) {
  const [filter, setFilter] = useState<RowValidationStatus | "all">("all");
  const [page, setPage] = useState(0);
  const limit = 50;
  const rowsQ = useImportRows(batchId, {
    validationStatus: filter === "all" ? null : filter,
    limit,
    offset: page * limit,
  });
  const [overrideRow, setOverrideRow] = useState<{ row: ImportRow; explanation: string | null } | null>(null);

  const rows = rowsQ.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">Review events</CardTitle>
        <Select
          value={filter}
          onValueChange={(v) => {
            setFilter(v as RowValidationStatus | "all");
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-3">
        {rowsQ.isLoading && <p className="text-sm text-muted-foreground">Loading events…</p>}
        {rowsQ.error && (
          <PortalNotice variant="error" title="Couldn't load events">
            {(rowsQ.error as Error).message}
          </PortalNotice>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Valve</TableHead>
                <TableHead>Program</TableHead>
                <TableHead className="text-right">Water</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duplicate</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const reasons = [row.primary_exclusion_reason, ...(row.additional_reason_codes ?? [])]
                  .filter(Boolean)
                  .map((r) => humanise(String(r)));
                const explanation = exclusionExplanation(row, thresholdLitres, volumeComparison, thresholdExplanation, providerLabel);
                const canOverride =
                  row.validation_status === "excluded" &&
                  ["below_volume_threshold", "at_volume_threshold", "test"].includes(row.classification);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{row.parsed_date ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {row.parsed_start_time ?? "—"}
                      {row.parsed_end_time ? `–${row.parsed_end_time}` : ""}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate">
                      {row.vinetrack_valve_name ?? row.external_valve_name ?? "—"}
                      {!row.matched_valve_id && (
                        <span className="ml-2 text-xs text-destructive">unmapped</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[140px] truncate text-muted-foreground">
                      {row.program_name ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {litresToCubicLabel(row.parsed_water_litres)}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{humanise(row.classification)}</span>
                      {reasons.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Excluded: {reasons.map((r) => `• ${r}`).join(" ")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={statusVariant(row.validation_status)} className="rounded-md">
                          {humanise(row.validation_status)}
                        </Badge>
                        {explanation && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" aria-label="Why was this excluded?">
                                <Info className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              {explanation}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.duplicate_status ? DUPLICATE_LABEL[row.duplicate_status] : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canOverride && (
                        <Button size="sm" variant="ghost" onClick={() => setOverrideRow({ row, explanation })}>
                          Include
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rowsQ.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                    No events for this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Showing {rows.length} event{rows.length === 1 ? "" : "s"} · page {page + 1}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={rows.length < limit}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>

      <OverrideDialog
        row={overrideRow?.row ?? null}
        explanation={overrideRow?.explanation ?? null}
        providerLabel={providerLabel}
        onClose={() => setOverrideRow(null)}
      />
    </Card>
  );
}

function OverrideDialog({
  row,
  explanation,
  providerLabel,
  onClose,
}: {
  row: ImportRow | null;
  explanation: string | null;
  providerLabel?: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const override = useSetRowOverride();
  const isTest = row?.classification === "test";

  const submit = async () => {
    if (!row) return;
    try {
      await override.mutateAsync({
        rowId: row.id,
        overrideThreshold: !isTest,
        overrideTest: isTest,
        reason: reason.trim() || "Included after review",
      });
      toast.success("Event included in this import.");
      setReason("");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Include this event anyway?</DialogTitle>
          <DialogDescription>
            {isTest
              ? "This event belongs to a Test program and is excluded by default."
              : `This event is below the ${providerLabel ?? "import"} minimum-volume threshold and may represent a test or short diagnostic run.`}
          </DialogDescription>
        </DialogHeader>
        {explanation && (
          <PortalNotice variant="info" compact>
            {explanation}
          </PortalNotice>
        )}
        <div className="space-y-2">
          <Label htmlFor="override-reason">Reason (recorded in the audit log)</Label>
          <Input
            id="override-reason"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why should this event be imported?"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={override.isPending}>
            {override.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Include event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImportRowReview;
