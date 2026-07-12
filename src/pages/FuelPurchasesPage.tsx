import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Download, AlertTriangle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
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
import {
  fetchFuelPurchasesForVineyard,
  createFuelPurchase,
  updateFuelPurchase,
  softDeleteFuelPurchase,
  describeFuelWriteError,
  type FuelPurchase,
} from "@/lib/fuelPurchasesQuery";
import { useCanSeeCosts } from "@/lib/permissions";
import { Fragment } from "react";
import { ReorderableHead } from "@/components/table/ReorderableHead";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import type { RegionFormatters } from "@/lib/regionFormatters";

const WRITE_ROLES = new Set(["owner", "manager", "supervisor"]);

const L_PER_US_GAL = 3.785411784;
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const mkFuelFmt = (rf: RegionFormatters) => {
  const fuelImperial = rf.fuelUnitLabel === "gal";
  return {
    date: (v?: string | null) => (v ? rf.date(v) || "—" : "—"),
    cost: (v?: number | null) => (v == null ? "—" : rf.currency(v)),
    fuelQty: (litres?: number | null) => (litres == null ? "—" : rf.fuel(litres, 2)),
    cpl: (cost?: number | null, litres?: number | null) => {
      if (cost == null || litres == null || litres <= 0) return "—";
      // cost per stored-litre → cost per fuel-unit
      const perUnit = fuelImperial ? (cost / litres) * L_PER_US_GAL : cost / litres;
      try {
        return (
          new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: rf.settings.currency_code,
            currencyDisplay: "narrowSymbol",
            minimumFractionDigits: 3,
            maximumFractionDigits: 4,
          }).format(perUnit) + `/${rf.fuelUnitLabel}`
        );
      } catch {
        return `${rf.settings.currency_code} ${perUnit.toFixed(3)}/${rf.fuelUnitLabel}`;
      }
    },
  };
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const numOrNaN = (s: string): number => (s.trim() === "" ? NaN : Number(s));

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// A record is suspicious if a plausible volume has a very low stored total,
// indicating a unit price was likely entered in the total_cost field.
function isSuspiciousPurchase(r: FuelPurchase): boolean {
  const v = r.volume_litres;
  const c = r.total_cost;
  if (v == null || c == null) return false;
  if (v <= 5) return false; // small containers can legitimately be cheap
  if (c <= 0) return false;
  return c / v < 0.2; // derived < $0.20 per litre is implausible
}

export default function FuelPurchasesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canWrite = !!currentRole && WRITE_ROLES.has(currentRole);
  const canSeeCosts = useCanSeeCosts();
  const { resolve } = useTeamLookup(selectedVineyardId);
  const rf = useRegionFormatters();
  const ff = useMemo(() => mkFuelFmt(rf), [rf]);
  const { date: fmtDate, fuelQty: fmtLitres, cost: fmtCost, cpl: fmtCpl } = ff;

  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<FuelPurchase | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FuelPurchase | null>(null);

  const FUEL_COLS = ["date", "volume", ...(canSeeCosts ? ["cpl", "total"] : []), "by", "updated"] as const;
  type FuelCol = "date" | "volume" | "total" | "cpl" | "by" | "updated";
  const { order: fOrder, moveColumn: fMove, reset: fReset } = useColumnOrder(
    "fuel_purchases_table_v2",
    FUEL_COLS as unknown as string[],
    { vineyardId: selectedVineyardId },
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["fuel_purchases", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchFuelPurchasesForVineyard(selectedVineyardId!),
  });

  const records = data ?? [];

  const rows = useMemo(() => {
    let list = records.slice();
    list.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    if (from) list = list.filter((l) => (l.date ?? "") >= from);
    if (to) list = list.filter((l) => (l.date ?? "") <= to);
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((l) =>
        [l.date, l.volume_litres, l.total_cost, resolve(l.created_by)]
          .some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
  }, [records, filter, from, to, resolve]);

  const summary = useMemo(() => {
    const totalLitres = rows.reduce((a, r) => a + (r.volume_litres ?? 0), 0);
    const totalCost = rows.reduce((a, r) => a + (r.total_cost ?? 0), 0);
    const flagged = rows.filter(isSuspiciousPurchase).length;
    return {
      count: rows.length,
      totalLitres,
      totalCost,
      avgCpl: totalLitres > 0 ? totalCost / totalLitres : null,
      flagged,
    };
  }, [rows]);

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (r: FuelPurchase) => {
    setEditing(r);
    setSelected(null);
    setEditorOpen(true);
  };

  const exportCsv = () => {
    const header = canSeeCosts
      ? ["date", "volume_litres", "total_cost", "cost_per_litre", "created_by"]
      : ["date", "volume_litres", "created_by"];
    const lines = [header.join(",")];
    for (const r of rows) {
      const cpl = r.total_cost != null && r.volume_litres && r.volume_litres > 0
        ? (r.total_cost / r.volume_litres).toFixed(4)
        : "";
      const row = canSeeCosts
        ? [r.date ?? "", r.volume_litres ?? "", r.total_cost ?? "", cpl, resolve(r.created_by) ?? ""]
        : [r.date ?? "", r.volume_litres ?? "", resolve(r.created_by) ?? ""];
      lines.push(row.map(csvEscape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuel-purchases-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        {embedded ? (
          <p className="text-sm text-muted-foreground max-w-2xl">
            {canWrite
              ? "Add, edit and archive fuel purchase records used to calculate the weighted average price per litre for cost allocation."
              : "Read-only view of fuel purchase records used to calculate the weighted average price per litre."}
          </p>
        ) : (
          <div>
            <h1 className="text-2xl font-semibold">Fuel Purchases</h1>
            <p className="text-sm text-muted-foreground">
              {canWrite
                ? "Add, edit and archive fuel purchase records for the selected vineyard."
                : "Read-only. Soft-deleted records are excluded."}
            </p>
          </div>
        )}
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          {canWrite && (
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-1" /> New Fuel Purchase
            </Button>
          )}
        </div>
      </div>

      <div className={`grid gap-3 sm:grid-cols-2 ${canSeeCosts ? "lg:grid-cols-4" : "lg:grid-cols-2"}`}>
        <SummaryCard label="Purchases" value={String(summary.count)} />
        <SummaryCard label={`Total ${rf.fuelUnitLabel === "gal" ? "gallons" : "litres"}`} value={fmtLitres(summary.totalLitres)} />
        {canSeeCosts && (
          <>
            <SummaryCard label="Total Purchase Cost" value={fmtCost(summary.totalCost)} />
            <SummaryCard
              label={`Average Price / ${rf.fuelUnitLabel}`}
              value={summary.avgCpl == null ? "—" : fmtCpl(summary.totalCost, summary.totalLitres)}
            />
          </>
        )}
      </div>

      {canSeeCosts && summary.flagged > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <div className="font-medium">
              {summary.flagged === 1
                ? "One fuel purchase may contain an incorrect total cost"
                : `${summary.flagged} fuel purchases may contain an incorrect total cost`}
              {" "}and are affecting the average price per litre.
            </div>
            <div className="text-muted-foreground">
              Rows flagged below with a warning icon likely have a unit price stored where the full
              purchase amount is expected. Open the record to review and correct it.
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">From</div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">To</div>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1 ml-auto">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            placeholder="Date, litres, cost, person…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-72"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <ColumnSettingsMenu onReset={fReset} />
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {(fOrder as FuelCol[]).map((id) => {
                if ((id === "total" || id === "cpl") && !canSeeCosts) return null;
                const labels: Record<FuelCol, string> = {
                  date: "Date",
                  volume: `Volume (${rf.fuelUnitLabel})`,
                  total: "Total Purchase Cost",
                  cpl: `Price / ${rf.fuelUnitLabel}`,
                  by: "Entered By",
                  updated: "Updated",
                };
                const rightAlign = id === "volume" || id === "total" || id === "cpl";
                return (
                  <ReorderableHead key={id} columnId={id} onDropColumn={fMove} align={rightAlign ? "right" : "left"}>
                    {labels[id]}
                  </ReorderableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={canSeeCosts ? 6 : 4} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={canSeeCosts ? 6 : 4} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={canSeeCosts ? 6 : 4} className="text-center text-muted-foreground py-8">
                  No fuel purchases found for this vineyard.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const suspicious = isSuspiciousPurchase(r);
              const dateCell = (
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {suspicious && canSeeCosts && (
                      <span title="This record may contain a unit price in the Total Purchase Cost field. Review and correct it.">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      </span>
                    )}
                    <span>{fmtDate(r.date)}</span>
                  </div>
                </TableCell>
              );
              const cellMap: Record<FuelCol, React.ReactNode> = {
                date: dateCell,
                volume: <TableCell className="text-right">{fmtLitres(r.volume_litres)}</TableCell>,
                total: (
                  <TableCell className={`text-right ${suspicious ? "text-amber-700" : ""}`}>
                    {r.total_cost == null ? "Not specified" : fmtCost(r.total_cost)}
                  </TableCell>
                ),
                cpl: (
                  <TableCell className={`text-right ${suspicious ? "text-amber-700" : ""}`}>
                    {r.total_cost == null || !r.volume_litres || r.volume_litres <= 0
                      ? "Not specified"
                      : fmtCpl(r.total_cost, r.volume_litres)}
                  </TableCell>
                ),
                by: <TableCell>{fmt(resolve(r.created_by))}</TableCell>,
                updated: <TableCell>{fmtDate(r.updated_at)}</TableCell>,
              };
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                  {(fOrder as FuelCol[]).map((id) => {
                    if ((id === "total" || id === "cpl") && !canSeeCosts) return null;
                    return <Fragment key={id}>{cellMap[id]}</Fragment>;
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>



      <FuelSheet
        record={selected}
        open={!!selected}
        canWrite={canWrite}
        canSeeCosts={canSeeCosts}
        onOpenChange={(o) => !o && setSelected(null)}
        onEdit={openEdit}
        resolveUser={resolve}
      />

      <FuelEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        canSeeCosts={canSeeCosts}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Card>
  );
}

function FuelSheet({
  record,
  open,
  canWrite,
  canSeeCosts,
  onOpenChange,
  onEdit,
  resolveUser,
}: {
  record: FuelPurchase | null;
  open: boolean;
  canWrite: boolean;
  canSeeCosts: boolean;
  onOpenChange: (o: boolean) => void;
  onEdit: (r: FuelPurchase) => void;
  resolveUser: (id: string | null | undefined) => string | null;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rf = useRegionFormatters();
  const { date: fmtDate, fuelQty: fmtLitres, cost: fmtCost, cpl: fmtCpl } = useMemo(() => mkFuelFmt(rf), [rf]);

  const delMut = useMutation({
    mutationFn: async () => {
      if (!record) return;
      await softDeleteFuelPurchase(record.id, user?.id ?? null, record.sync_version ?? 0);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fuel_purchases"] });
      toast({ title: "Fuel purchase archived" });
      setConfirmDelete(false);
      onOpenChange(false);
    },
    onError: (err) => {
      toast({ title: "Could not archive record", description: describeFuelWriteError(err), variant: "destructive" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Fuel purchase — {fmtDate(record?.date)}</SheetTitle>
        </SheetHeader>
        {record && (
          <div className="mt-4 space-y-4 text-sm">
            <Section title="Record">
              <Field label="Date" value={fmtDate(record.date)} />
              <Field label="Volume" value={fmtLitres(record.volume_litres)} />
              {canSeeCosts && <Field label={`Price / ${rf.fuelUnitLabel}`} value={fmtCpl(record.total_cost, record.volume_litres)} />}
              {canSeeCosts && <Field label="Total Purchase Cost" value={record.total_cost == null ? "Not specified" : fmtCost(record.total_cost)} />}
            </Section>
            <Section title="Meta">
              <Field label="Entered by" value={fmt(resolveUser(record.created_by))} />
              <Field label="Updated by" value={fmt(resolveUser(record.updated_by))} />
              <Field label="Created" value={fmtDate(record.created_at)} />
              <Field label="Updated" value={fmtDate(record.updated_at)} />
              <Field label="Sync version" value={fmt(record.sync_version)} />
              <Field label="Record ID" value={record.id} mono />
            </Section>

            {canWrite && (
              <SheetFooter className="flex sm:justify-between gap-2 pt-2">
                <Button
                  variant="destructive"
                  onClick={() => setConfirmDelete(true)}
                  disabled={delMut.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Archive
                </Button>
                <Button onClick={() => onEdit(record)}>
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Button>
              </SheetFooter>
            )}
          </div>
        )}
      </SheetContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this fuel purchase?</AlertDialogTitle>
            <AlertDialogDescription>
              The record will be hidden from active lists. iOS will sync the change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => delMut.mutate()} disabled={delMut.isPending}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function FuelEditor({
  open,
  onOpenChange,
  editing,
  canSeeCosts,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: FuelPurchase | null;
  canSeeCosts: boolean;
}) {
  const { selectedVineyardId } = useVineyard();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const rf = useRegionFormatters();
  const { cpl: fmtCpl } = useMemo(() => mkFuelFmt(rf), [rf]);

  const [date, setDate] = useState<string>(todayIso());
  const [litres, setLitres] = useState<string>("");
  const [cost, setCost] = useState<string>("");
  const [ppl, setPpl] = useState<string>("");
  // Which cost field the user last edited — drives recomputation on volume change.
  const [lastEdited, setLastEdited] = useState<"unitPrice" | "totalCost">("totalCost");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDate(editing.date ?? todayIso());
      const v = editing.volume_litres;
      const c = editing.total_cost;
      setLitres(v == null ? "" : String(v));
      setCost(c == null ? "" : String(c));
      setPpl(c != null && v != null && v > 0 ? String(+(c / v).toFixed(4)) : "");
      setLastEdited("totalCost");
    } else {
      setDate(todayIso());
      setLitres("");
      setCost("");
      setPpl("");
      setLastEdited("totalCost");
    }
  }, [open, editing]);

  const litresNum = numOrNaN(litres);
  const costNum = numOrNaN(cost);
  const pplNum = numOrNaN(ppl);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round4 = (n: number) => Math.round(n * 10000) / 10000;

  const onVolumeChange = (v: string) => {
    setLitres(v);
    const vn = numOrNaN(v);
    if (!Number.isFinite(vn) || vn <= 0) return;
    if (lastEdited === "unitPrice" && Number.isFinite(pplNum) && pplNum > 0) {
      setCost(String(round2(vn * pplNum)));
    } else if (lastEdited === "totalCost" && Number.isFinite(costNum) && costNum > 0) {
      setPpl(String(round4(costNum / vn)));
    }
  };

  const onPplChange = (v: string) => {
    setPpl(v);
    setLastEdited("unitPrice");
    const pn = numOrNaN(v);
    if (Number.isFinite(pn) && pn > 0 && Number.isFinite(litresNum) && litresNum > 0) {
      setCost(String(round2(litresNum * pn)));
    }
  };

  const onCostChange = (v: string) => {
    setCost(v);
    setLastEdited("totalCost");
    const cn = numOrNaN(v);
    if (Number.isFinite(cn) && cn >= 0 && Number.isFinite(litresNum) && litresNum > 0) {
      setPpl(String(round4(cn / litresNum)));
    }
  };

  const validate = (): string | null => {
    if (!date) return "Date is required";
    if (!Number.isFinite(litresNum) || litresNum <= 0) return "Volume must be greater than 0";
    if (canSeeCosts) {
      if (!Number.isFinite(costNum) || costNum < 0) return "Total Purchase Cost must be 0 or greater";
    }
    return null;
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!selectedVineyardId) throw new Error("No vineyard selected");
      const err = validate();
      if (err) throw new Error(err);
      return createFuelPurchase({
        vineyard_id: selectedVineyardId,
        date,
        volume_litres: litresNum,
        // Supervisors don't enter cost — preserve null/0 default.
        total_cost: canSeeCosts ? costNum : (Number.isFinite(costNum) ? costNum : 0),
        user_id: user?.id ?? null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fuel_purchases"] });
      toast({ title: "Fuel purchase created" });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({ title: "Could not create record", description: describeFuelWriteError(err), variant: "destructive" });
    },
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("No record selected");
      const err = validate();
      if (err) throw new Error(err);
      return updateFuelPurchase({
        id: editing.id,
        date,
        volume_litres: litresNum,
        // Don't overwrite existing cost when supervisors edit.
        total_cost: canSeeCosts ? costNum : (editing.total_cost ?? 0),
        user_id: user?.id ?? null,
        current_sync_version: editing.sync_version ?? 0,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fuel_purchases"] });
      toast({ title: "Fuel purchase updated" });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({ title: "Could not update record", description: describeFuelWriteError(err), variant: "destructive" });
    },
  });

  const submit = () => (editing ? updateMut.mutate() : createMut.mutate());
  const pending = createMut.isPending || updateMut.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit fuel purchase" : "New fuel purchase"}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label>Date *</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className={`grid ${canSeeCosts ? "grid-cols-2" : "grid-cols-1"} gap-3`}>
            <div className="space-y-1.5">
              <Label>Volume (litres) *</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={litres}
                onChange={(e) => setLitres(e.target.value)}
                placeholder="0.00"
              />
            </div>
            {canSeeCosts && (
              <div className="space-y-1.5">
                <Label>Total cost *</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            )}
          </div>

          {canSeeCosts && (
            <div className="rounded-md border bg-muted/30 p-3 flex items-center justify-between">
              <span className="text-muted-foreground">Cost per litre</span>
              <span className="font-medium">{previewCpl}</span>
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create record"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      <div className="rounded-md border bg-card/50 p-3 space-y-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs break-all text-right" : "text-right"}>{value}</span>
    </div>
  );
}
