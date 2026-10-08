import { Fragment, forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
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
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
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
  buildBlockBreakdown,
  UNASSIGNED_BLOCK_KEY,
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
  /** Estimated tonnes keyed `${paddockId lower}|${varietyKey}`; unknown omitted. */
  estimatedByBlockVariety?: Map<string, number>;
  blocks: { id: string; name: string; varieties?: string[] }[];
  /** Canonical vineyard varieties for the allocation picker. */
  varieties?: string[];
  /** When false, only the dialogs stay mounted — the summary cards, tables
   *  and notices render only on the Grape Allocation tab. Defaults to true. */
  active?: boolean;
}

export interface GrapeAllocationPanelRef {
  openNewAllocation: () => void;
}

const t = (v: number | null | undefined, dp = 2) =>
  v == null ? "—" : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: dp })} t`;

const GrapeAllocationPanel = forwardRef<GrapeAllocationPanelRef, GrapeAllocationPanelProps>(function GrapeAllocationPanel(
  {
    vineyardId,
    vintage,
    role,
    estimatedByVariety,
    estimatedByBlockVariety,
    blocks,
    varieties: canonicalVarieties,
    active = true,
  }: GrapeAllocationPanelProps,
  ref,
) {
  const rf = useRegionFormatters();
  const canSeeFinancials = canSeeCosts(role);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GrapeAllocation | null>(null);

  useImperativeHandle(ref, () => ({
    openNewAllocation: () => {
      setEditing(null);
      setOpen(true);
    },
  }));
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
  const breakdown = useMemo(
    () => buildBlockBreakdown({ allocations, estimatedByBlockVariety }),
    [allocations, estimatedByBlockVariety],
  );
  const blockName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of blocks) m.set(b.id.toLowerCase(), b.name);
    return m;
  }, [blocks]);
  // Expanded by default; users collapse what they don't need.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const allocById = useMemo(() => new Map(allocations.map((a) => [a.id, a])), [allocations]);

  const varieties = useMemo(() => {
    const s = new Set<string>(canonicalVarieties ?? []);
    rows.forEach((r) => {
      if (r.variety && r.variety !== "Unspecified variety") s.add(r.variety);
    });
    return Array.from(s).sort();
  }, [rows, canonicalVarieties]);

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
      {active && (
      <>
      <p className="text-sm text-muted-foreground">
        Allocate the {vintage ?? "selected"} vintage estimate to your own use and to
        external commitments, and track what is still available.
      </p>

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
              const children = (breakdown.get(r.varietyKey) ?? [])
                .map((c) => ({
                  ...c,
                  ...blockChildLabel(c.blockKey, r.varietyKey, blockName),
                }))
                .sort((a, b) =>
                  a.blockKey === UNASSIGNED_BLOCK_KEY
                    ? 1
                    : b.blockKey === UNASSIGNED_BLOCK_KEY
                    ? -1
                    : a.label.localeCompare(b.label, undefined, { numeric: true }),
                );
              const isOpen = !collapsed.has(r.varietyKey);
              const avail = (v: number | null) =>
                v == null ? "—" : v < 0 ? `${t(Math.abs(v))} over` : t(v);
              return (
                <Fragment key={r.varietyKey}>
                <TableRow>
                  <TableCell className="font-medium">
                    {children.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggle(r.varietyKey)}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Collapse" : "Expand"} ${r.variety} blocks`}
                        className="inline-flex items-center gap-1 text-left hover:text-primary"
                      >
                        <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        {r.variety}
                      </button>
                    ) : (
                      <span className="pl-5">{r.variety}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{t(r.estimatedTonnes)}</TableCell>
                  <TableCell className="text-right">{t(r.ownUseTonnes)}</TableCell>
                  <TableCell className="text-right">{t(r.externalTonnes)}</TableCell>
                  <TableCell className="text-right">{t(r.allocatedTonnes)}</TableCell>
                  <TableCell className={`text-right ${short ? "text-destructive font-medium" : ""}`}>
                    {avail(r.availableTonnes)}
                  </TableCell>
                  {canSeeFinancials && (
                    <TableCell className="text-right">{money(r.contractedIncome)}</TableCell>
                  )}
                </TableRow>
                {isOpen &&
                  children.map((c) => {
                    const cShort = c.availableTonnes != null && c.availableTonnes < 0;
                    const editable = c.allocationIds
                      .map((id) => allocById.get(id))
                      .filter(Boolean) as GrapeAllocation[];
                    return (
                      <TableRow key={`${r.varietyKey}:${c.blockKey}`} className="bg-muted/30 text-sm">
                        <TableCell className="pl-10 text-muted-foreground">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-foreground">{c.label}</span>
                            <span className="flex">
                              {editable.map((a, i) => (
                                <Button
                                  key={a.id}
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  aria-label={`Edit ${r.variety} allocation for ${c.label}${editable.length > 1 ? ` (${i + 1} of ${editable.length})` : ""}`}
                                  onClick={() => {
                                    setEditing(a);
                                    setOpen(true);
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  {editable.length > 1 && <span className="ml-1 text-xs">{i + 1}</span>}
                                </Button>
                              ))}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{t(c.estimatedTonnes)}</TableCell>
                        <TableCell className="text-right">{t(c.ownUseTonnes)}</TableCell>
                        <TableCell className="text-right">{t(c.externalTonnes)}</TableCell>
                        <TableCell className="text-right">{t(c.allocatedTonnes)}</TableCell>
                        <TableCell className={`text-right ${cShort ? "text-destructive font-medium" : ""}`}>
                          {avail(c.availableTonnes)}
                        </TableCell>
                        {canSeeFinancials && <TableCell />}
                      </TableRow>
                    );
                  })}
                </Fragment>
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
      </>
      )}

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
});

export default GrapeAllocationPanel;
