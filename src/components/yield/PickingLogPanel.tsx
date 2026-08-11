import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { sugarUnitSymbol } from "@/lib/vineyardRegionSettingsQuery";
import {
  fetchPickingRecords,
  softDeletePickingRecord,
  type PickingRecord,
} from "@/lib/pickingRecordsQuery";

const fmt = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp });

/**
 * Picking Log — every individual pick recorded by the portal, iOS or Android.
 * Read + soft delete only; totals are aggregated by the backend view.
 */
export default function PickingLogPanel({
  vineyardId,
  vintage,
  canDelete,
}: {
  vineyardId: string | null;
  /** Active vintage filter, or null for all vintages. */
  vintage: number | null;
  canDelete: boolean;
}) {
  const rf = useRegionFormatters();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<PickingRecord | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["picking_records", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchPickingRecords(vineyardId!),
  });

  const del = useMutation({
    mutationFn: (id: string) => softDeletePickingRecord(id),
    onSuccess: () => {
      toast({ title: "Pick removed" });
      setPending(null);
      qc.invalidateQueries({ queryKey: ["picking_records"] });
      qc.invalidateQueries({ queryKey: ["picking_yield_totals"] });
    },
    onError: (e: any) =>
      toast({ title: "Could not remove", description: e?.message ?? String(e), variant: "destructive" }),
  });

  const rows = useMemo(() => {
    let list = data ?? [];
    if (vintage != null) list = list.filter((r) => Number(r.vintage) === vintage);
    const f = search.trim().toLowerCase();
    if (f) {
      list = list.filter((r) =>
        `${r.paddock_name ?? ""} ${r.variety_name ?? ""} ${r.clone ?? ""} ${r.purpose ?? ""} ${r.sold_to ?? ""}`
          .toLowerCase()
          .includes(f),
      );
    }
    return list;
  }, [data, vintage, search]);

  const totalTonnes = rows.reduce((a, r) => a + (Number(r.weight_kg) || 0) / 1000, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1 ml-auto">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            className="w-72"
            placeholder="Block, variety, clone, buyer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Vintage</TableHead>
              <TableHead>Block</TableHead>
              <TableHead>Variety</TableHead>
              <TableHead>Clone</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Sugar</TableHead>
              <TableHead className="text-right">pH</TableHead>
              <TableHead className="text-right">TA</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Sold</TableHead>
              {canDelete && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={12} className="py-6 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={12} className="py-6 text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
                  No picks recorded for this vintage yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{rf.date(r.picked_at)}</TableCell>
                <TableCell>{r.vintage ?? "—"}</TableCell>
                <TableCell className="font-medium">{r.paddock_name || "—"}</TableCell>
                <TableCell>{r.variety_name || "—"}</TableCell>
                <TableCell>{r.clone || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmt(Number(r.weight_kg) / 1000)} t
                  <div className="text-xs text-muted-foreground">{fmt(r.weight_kg, 0)} kg</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.sugar_value == null ? "—" : `${fmt(r.sugar_value, 1)} ${sugarUnitSymbol(r.sugar_unit)}`}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmt(r.ph, 2)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(r.ta_g_l, 1)}</TableCell>
                <TableCell>{r.purpose || "—"}</TableCell>
                <TableCell>
                  {r.sold ? (
                    <div className="text-sm">
                      <Badge variant="outline">Sold</Badge>
                      {r.sold_to ? (
                        <div className="text-xs text-muted-foreground">{r.sold_to}</div>
                      ) : null}
                      {r.grape_value != null ? (
                        <div className="text-xs text-muted-foreground">
                          {rf.currency(Number(r.grape_value))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
                {canDelete && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove pick ${r.paddock_name ?? ""}`}
                      onClick={() => setPending(r)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {rows.length > 0 && (
              <TableRow className="bg-muted/40">
                <TableCell colSpan={5} className="font-semibold">
                  Total <Badge variant="outline" className="ml-1 font-normal">{rows.length} picks</Badge>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmt(totalTonnes)} t
                </TableCell>
                <TableCell colSpan={canDelete ? 6 : 5} />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this pick?</AlertDialogTitle>
            <AlertDialogDescription>
              The pick is soft deleted and removed from yield totals across the portal and mobile
              apps. Nothing is permanently erased.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pending && del.mutate(pending.id)}
              disabled={del.isPending}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
