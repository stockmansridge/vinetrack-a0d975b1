import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { PortalNotice } from "@/components/ui/PortalNotice";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { canSeeCosts } from "@/lib/permissions";
import {
  ALLOCATION_TYPE_LABEL,
  fetchAllocationFinancials,
  fetchGrapeAllocations,
  saveGrapeAllocation,
  softDeleteGrapeAllocation,
  type GrapeAllocation,
  type SaveAllocationInput,
} from "@/lib/grapeAllocationsQuery";
import {
  buildAllocationRows,
  totalsFromRows,
  varietyKeyOf,
} from "@/lib/grapeAllocationModel";
import AllocationDialog from "@/components/yield/AllocationDialog";

export interface GrapeAllocationPanelProps {
  vineyardId: string | null;
  vintage: number | null;
  role: string | null;
  /** Authoritative estimated tonnes for the vintage, keyed by variety key. */
  estimatedByVariety: Map<string, number>;
  blocks: { id: string; name: string }[];
}

const t = (v: number | null | undefined, dp = 2) =>
  v == null ? "—" : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: dp })} t`;

export default function GrapeAllocationPanel({
  vineyardId,
  vintage,
  role,
  estimatedByVariety,
  blocks,
}: GrapeAllocationPanelProps) {
  const rf = useRegionFormatters();
  const canSeeFinancials = canSeeCosts(role);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GrapeAllocation | null>(null);
  const [deleting, setDeleting] = useState<GrapeAllocation | null>(null);

  const allocQ = useQuery({
    queryKey: ["grape_allocations", vineyardId, vintage],
    enabled: !!vineyardId && vintage != null,
    queryFn: () => fetchGrapeAllocations(vineyardId!, vintage),
  });

  // Financial data is requested only for owners and managers.
  const finQ = useQuery({
    queryKey: ["grape_allocation_financials", vineyardId],
    enabled: !!vineyardId && canSeeFinancials,
    queryFn: () => fetchAllocationFinancials(vineyardId!),
  });

  const allocations = allocQ.data ?? [];
  const financials = canSeeFinancials ? finQ.data ?? new Map() : null;

  const rows = useMemo(
    () => buildAllocationRows({ allocations, estimatedByVariety, financials }),
    [allocations, estimatedByVariety, financials],
  );
  const totals = useMemo(() => totalsFromRows(rows), [rows]);

  const varieties = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      if (r.variety && r.variety !== "Unspecified variety") s.add(r.variety);
    });
    return Array.from(s).sort();
  }, [rows]);

  const save = useMutation({
    mutationFn: (input: SaveAllocationInput) => saveGrapeAllocation(input),
    onSuccess: () => {
      toast({ title: "Allocation saved" });
      setOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["grape_allocations"] });
      qc.invalidateQueries({ queryKey: ["grape_allocation_financials"] });
    },
    onError: (e: any) =>
      toast({
        title: "Could not save allocation",
        description: e?.message ?? String(e),
        variant: "destructive",
      }),
  });

  const del = useMutation({
    mutationFn: (id: string) => softDeleteGrapeAllocation(id),
    onSuccess: () => {
      toast({ title: "Allocation removed" });
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["grape_allocations"] });
    },
    onError: (e: any) =>
      toast({
        title: "Could not remove allocation",
        description: e?.message ?? String(e),
        variant: "destructive",
      }),
  });

  const money = (v: number | null) => (v == null ? "—" : rf.currency(v, 0));

  const summary = [
    { label: "Estimated yield", value: t(totals.estimatedTonnes) },
    { label: "Own use", value: t(totals.ownUseTonnes) },
    { label: "External commitments", value: t(totals.externalTonnes) },
    {
      label: totals.availableTonnes != null && totals.availableTonnes < 0 ? "Shortfall" : "Available",
      value:
        totals.availableTonnes == null
          ? "—"
          : t(Math.abs(totals.availableTonnes)),
      warn: (totals.availableTonnes ?? 0) < 0,
    },
  ];

  const priceOf = (id: string) =>
    canSeeFinancials ? financials?.get(id)?.pricePerTonne ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Allocate the {vintage ?? "selected"} vintage estimate to your own use and to
          external commitments, and track what is still available.
        </p>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          disabled={!vineyardId || vintage == null}
        >
          <Plus className="h-4 w-4 mr-1.5" /> Add allocation
        </Button>
      </div>

      {vintage == null && (
        <PortalNotice
          variant="info"
          compact
          title="Select a vintage"
          description="Grape allocations are tracked per vintage. Choose a single vintage to view and record allocations."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div
              className={`text-2xl font-semibold ${s.warn ? "text-destructive" : ""}`}
            >
              {s.value}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variety</TableHead>
              <TableHead className="text-right">Estimated</TableHead>
              <TableHead className="text-right">Own use</TableHead>
              <TableHead className="text-right">External</TableHead>
              <TableHead className="text-right">Total allocated</TableHead>
              <TableHead className="text-right">Available / shortfall</TableHead>
              {canSeeFinancials && <TableHead className="text-right">Contracted income</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {allocQ.isLoading && (
              <TableRow>
                <TableCell colSpan={canSeeFinancials ? 7 : 6} className="text-center py-6 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {allocQ.error && (
              <TableRow>
                <TableCell colSpan={canSeeFinancials ? 7 : 6} className="text-center py-6 text-destructive">
                  {(allocQ.error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!allocQ.isLoading && !allocQ.error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={canSeeFinancials ? 7 : 6} className="text-center py-8 text-muted-foreground">
                  No estimate or allocations for this vintage yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const short = r.availableTonnes != null && r.availableTonnes < 0;
              return (
                <TableRow key={r.varietyKey}>
                  <TableCell className="font-medium">{r.variety}</TableCell>
                  <TableCell className="text-right">{t(r.estimatedTonnes)}</TableCell>
                  <TableCell className="text-right">{t(r.ownUseTonnes)}</TableCell>
                  <TableCell className="text-right">{t(r.externalTonnes)}</TableCell>
                  <TableCell className="text-right">{t(r.allocatedTonnes)}</TableCell>
                  <TableCell className={`text-right ${short ? "text-destructive font-medium" : ""}`}>
                    {r.availableTonnes == null
                      ? "—"
                      : short
                      ? `${t(Math.abs(r.availableTonnes))} over`
                      : t(r.availableTonnes)}
                  </TableCell>
                  {canSeeFinancials && (
                    <TableCell className="text-right">{money(r.contractedIncome)}</TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <div className="px-4 pt-4 text-sm font-medium">Allocations</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Variety</TableHead>
              <TableHead>Destination / purchaser</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">Tonnes</TableHead>
              {canSeeFinancials && <TableHead className="text-right">Price / t</TableHead>}
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {allocations.length === 0 && (
              <TableRow>
                <TableCell colSpan={canSeeFinancials ? 7 : 6} className="text-center py-8 text-muted-foreground">
                  No allocations recorded for this vintage.
                </TableCell>
              </TableRow>
            )}
            {allocations.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Badge variant={a.allocation_type === "own_use" ? "secondary" : "outline"}>
                    {ALLOCATION_TYPE_LABEL[a.allocation_type]}
                  </Badge>
                </TableCell>
                <TableCell>{a.variety_name ?? "—"}</TableCell>
                <TableCell>
                  {a.allocation_type === "own_use"
                    ? a.destination_name ?? "—"
                    : a.purchaser_name ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {a.allocation_type === "own_use"
                    ? "—"
                    : [a.contact_name, a.contact_email, a.contact_phone]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                </TableCell>
                <TableCell className="text-right">{t(a.quantity_tonnes)}</TableCell>
                {canSeeFinancials && (
                  <TableCell className="text-right">{money(priceOf(a.id))}</TableCell>
                )}
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit allocation"
                    onClick={() => {
                      setEditing(a);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove allocation"
                    onClick={() => setDeleting(a)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {vineyardId && vintage != null && (
        <AllocationDialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setEditing(null);
          }}
          vineyardId={vineyardId}
          vintage={vintage}
          canSeeFinancials={canSeeFinancials}
          currencySymbol={rf.currencySymbol}
          varieties={varieties.length ? varieties : Array.from(estimatedByVariety.keys()).map(varietyKeyOf)}
          blocks={blocks}
          existing={editing ? { ...editing, pricePerTonne: priceOf(editing.id) } : null}
          saving={save.isPending}
          onSave={(input) => save.mutate(input)}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this allocation?</AlertDialogTitle>
            <AlertDialogDescription>
              The allocation is archived, not permanently deleted. It will no longer count
              towards committed or available tonnes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && del.mutate(deleting.id)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
