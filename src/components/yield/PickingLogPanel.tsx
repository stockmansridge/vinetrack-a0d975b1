import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EditPickingRecordDialog } from "@/components/yield/RecordActualYieldDialog";
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
  canEdit = canDelete,
}: {
  vineyardId: string | null;
  /** Active vintage filter, or null for all vintages. */
  vintage: number | null;
  canDelete: boolean;
  /** Same permission as recording picks; RLS remains authoritative. */
  canEdit?: boolean;
}) {
  const rf = useRegionFormatters();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<PickingRecord | null>(null);
  const [editing, setEditing] = useState<PickingRecord | null>(null);

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

  // Vintage totals grouped by Block + Variety (client-side view of the same
  // rows shown below — the backend aggregation view stays the source of truth
  // for yield precedence).
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        block: string;
        variety: string;
        picks: number;
        kg: number;
        soldKg: number;
        unsoldKg: number;
      }
    >();
    for (const r of rows) {
      const block = r.paddock_name || "—";
      const variety = r.variety_name || "—";
      const k = `${block.toLowerCase()}|${variety.toLowerCase()}`;
      const kg = Number(r.weight_kg) || 0;
      const g =
        map.get(k) ?? { block, variety, picks: 0, kg: 0, soldKg: 0, unsoldKg: 0 };
      g.picks += 1;
      g.kg += kg;
      if (r.sold) g.soldKg += kg;
      else g.unsoldKg += kg;
      map.set(k, g);
    }
    return Array.from(map.values()).sort(
      (a, b) => a.block.localeCompare(b.block) || a.variety.localeCompare(b.variety),
    );
  }, [rows]);

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

      {groups.length > 0 && (
        <Card className="p-4 space-y-2">
          <div className="text-sm font-medium">
            {vintage != null ? `Vintage ${vintage} totals` : "Totals (all vintages)"} — by block and
            variety
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Block</TableHead>
                <TableHead>Variety</TableHead>
                <TableHead className="text-right">Picks</TableHead>
                <TableHead className="text-right">Total kg</TableHead>
                <TableHead className="text-right">Tonnes</TableHead>
                <TableHead className="text-right">Sold t</TableHead>
                <TableHead className="text-right">Unsold t</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={`${g.block}|${g.variety}`}>
                  <TableCell className="font-medium">{g.block}</TableCell>
                  <TableCell>{g.variety}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.picks}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(g.kg, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(g.kg / 1000)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(g.soldKg / 1000)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(g.unsoldKg / 1000)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40">
                <TableCell colSpan={2} className="font-semibold">
                  All blocks
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {rows.length}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmt(totalTonnes * 1000, 0)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmt(totalTonnes)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmt(groups.reduce((a, g) => a + g.soldKg, 0) / 1000)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmt(groups.reduce((a, g) => a + g.unsoldKg, 0) / 1000)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      )}

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
              {(canEdit || canDelete) && <TableHead className="w-20 text-right">Actions</TableHead>}
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
                {(canEdit || canDelete) && (
                  <TableCell className="text-right whitespace-nowrap">
                    <TooltipProvider>
                      {canEdit && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit picking record ${r.paddock_name ?? ""}`}
                              onClick={() => setEditing(r)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit picking record</TooltipContent>
                        </Tooltip>
                      )}
                      {canDelete && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove pick ${r.paddock_name ?? ""}`}
                              onClick={() => setPending(r)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete picking record</TooltipContent>
                        </Tooltip>
                      )}
                    </TooltipProvider>
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
                <TableCell colSpan={canEdit || canDelete ? 6 : 5} />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <EditPickingRecordDialog
        vineyardId={vineyardId}
        record={editing}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
      />

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
