import { useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  batchId as readBatchId,
  litresToCubicLabel,
  useImportBatches,
  useReverseImportBatch,
  type ImportBatch,
  type ReversalImpact,
} from "@/lib/irrigationImportQuery";
import { useIrrigationCapabilities } from "@/lib/irrigationQuery";

export function ImportBatchHistory({
  vineyardId,
  provider,
}: {
  vineyardId: string | null;
  provider: string | null;
}) {
  const batchesQ = useImportBatches(vineyardId, provider);
  const reverse = useReverseImportBatch();
  // Import reversal is its own capability — never inferred from import access.
  const { capabilities, loading: capsLoading } = useIrrigationCapabilities(vineyardId);
  const canReverseBatch = !capsLoading && capabilities.can_reverse_irrigation_import;
  const [target, setTarget] = useState<ImportBatch | null>(null);
  const [impact, setImpact] = useState<ReversalImpact | null>(null);

  const openReversal = async (batch: ImportBatch) => {
    const id = readBatchId(batch);
    if (!id) return;
    setTarget(batch);
    setImpact(null);
    try {
      setImpact(await reverse.mutateAsync({ batchId: id, dryRun: true }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setTarget(null);
    }
  };

  const confirmReversal = async () => {
    const id = readBatchId(target);
    if (!id) return;
    try {
      await reverse.mutateAsync({ batchId: id, dryRun: false });
      toast.success("Import batch reversed. Its sessions are excluded from all reports.");
      setTarget(null);
      await batchesQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const batches = batchesQ.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Import history</CardTitle>
      </CardHeader>
      <CardContent>
        {batchesQ.isLoading && <p className="text-sm text-muted-foreground">Loading batches…</p>}
        {batchesQ.error && (
          <PortalNotice variant="error" title="Couldn't load import history">
            {(batchesQ.error as Error).message}
          </PortalNotice>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Controller</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => {
                const id = readBatchId(batch);
                const reversed = !!batch.reversed_at;
                const committed = !!batch.committed_at;
                return (
                  <TableRow key={id ?? batch.file_name}>
                    <TableCell className="max-w-[240px] truncate">{batch.file_name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {batch.external_controller_name ?? batch.external_controller_key ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {batch.created_at ? new Date(batch.created_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={reversed ? "outline" : committed ? "default" : "secondary"}
                        className="rounded-md"
                      >
                        {reversed ? "Reversed" : committed ? "Committed" : batch.status ?? "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{batch.imported_sessions ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {committed && !reversed && canReverseBatch && (
                        <Button size="sm" variant="ghost" onClick={() => void openReversal(batch)}>
                          <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Reverse
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!batchesQ.isLoading && batches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No imports yet for this vineyard.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={!!target} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse this import batch?</DialogTitle>
            <DialogDescription>
              Only sessions created by this batch are reversed. Manual sessions are never touched, and
              the batch, its rows and the audit trail are preserved.
            </DialogDescription>
          </DialogHeader>
          {!impact ? (
            <p className="text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Calculating impact…
            </p>
          ) : (
            <div className="space-y-1 text-sm">
              <p>Sessions affected: <strong>{impact.sessions_affected}</strong></p>
              <p>Water removed: <strong>{litresToCubicLabel(impact.total_water_litres_removed)}</strong></p>
              <p>
                Date range: {impact.date_range_from ?? "—"} → {impact.date_range_to ?? "—"}
              </p>
              <p>
                Valves affected:{" "}
                {(impact.valves_affected ?? [])
                  .map((v) => (typeof v === "string" ? v : v.valve_name ?? v.name ?? ""))
                  .filter(Boolean)
                  .join(", ") || "—"}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!impact || reverse.isPending}
              onClick={() => void confirmReversal()}
            >
              {reverse.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reverse batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default ImportBatchHistory;
