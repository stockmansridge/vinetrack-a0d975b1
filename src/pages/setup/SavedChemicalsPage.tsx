import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useSortableTable } from "@/lib/useSortableTable";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  fetchSavedChemicalsForVineyard,
  createSavedChemical, updateSavedChemical, archiveSavedChemical, restoreSavedChemical,
  type SavedChemical, type SavedChemicalInput,
} from "@/lib/savedChemicalsQuery";
import { PRODUCT_CATEGORIES, matchCategory, parseRestrictions, composeRestrictions } from "@/lib/chemicalCategories";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Pencil, Archive, RotateCcw } from "lucide-react";
import { ChemicalAILookup, type AppliedSuggestion } from "@/components/spray/ChemicalAILookup";

const ANY = "__any__";
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));

const EMPTY: SavedChemicalInput = {
  name: "", active_ingredient: "", chemical_group: "", use: "",
  manufacturer: "", crop: "", problem: "", rate_per_ha: null, unit: "",
  restrictions: "", notes: "",
};

export default function SavedChemicalsPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const qc = useQueryClient();
  const { toast } = useToast();

  const [filter, setFilter] = useState("");
  const [group, setGroup] = useState<string>(ANY);
  const [use, setUse] = useState<string>(ANY);
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [editing, setEditing] = useState<SavedChemical | "new" | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<SavedChemical | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<SavedChemical | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["saved_chemicals", selectedVineyardId, "active"],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchSavedChemicalsForVineyard(selectedVineyardId!),
  });
  const chemicals = data?.chemicals ?? [];

  const archivedQuery = useQuery({
    queryKey: ["saved_chemicals", selectedVineyardId, "archived"],
    enabled: !!selectedVineyardId && tab === "archived",
    queryFn: () => fetchSavedChemicalsForVineyard(selectedVineyardId!, { archived: true }),
  });
  const archived = archivedQuery.data?.chemicals ?? [];

  const groups = useMemo(() => {
    const s = new Set<string>();
    chemicals.forEach((c) => c.chemical_group && s.add(c.chemical_group));
    return Array.from(s).sort();
  }, [chemicals]);
  const uses = useMemo(() => {
    const s = new Set<string>();
    chemicals.forEach((c) => c.use && s.add(c.use));
    return Array.from(s).sort();
  }, [chemicals]);

  const rows = useMemo(() => {
    let list = chemicals.slice().sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    if (group !== ANY) list = list.filter((c) => c.chemical_group === group);
    if (use !== ANY) list = list.filter((c) => c.use === use);
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((c) =>
        [c.name, c.active_ingredient, c.manufacturer, c.chemical_group, c.use, c.crop, c.problem, c.notes, c.restrictions]
          .some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
  }, [chemicals, filter, group, use]);

  type ChemSortKey = "name" | "active_ingredient" | "group" | "use" | "rate" | "manufacturer";
  const { sorted: sortedRows, getSortDirection: chemSortDir, toggleSort: chemToggle } = useSortableTable<typeof rows[number], ChemSortKey>(rows, {
    accessors: {
      name: (c) => c.name ?? "",
      active_ingredient: (c) => c.active_ingredient ?? "",
      group: (c) => c.chemical_group ?? "",
      use: (c) => c.use ?? "",
      rate: (c) => (c.rate_per_ha == null ? null : Number(c.rate_per_ha)),
      manufacturer: (c) => c.manufacturer ?? "",
    },
    initial: { key: "name", direction: "asc" },
  });

  const archivedRows = useMemo(() => {
    let list = archived.slice().sort((a, b) => (b.deleted_at ?? "").localeCompare(a.deleted_at ?? ""));
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((c) =>
        [c.name, c.active_ingredient, c.manufacturer, c.use].some((v) =>
          String(v ?? "").toLowerCase().includes(f),
        ),
      );
    }
    return list;
  }, [archived, filter]);

  type ArcSortKey = "name" | "category" | "active_ingredient" | "manufacturer" | "archived";
  const { sorted: sortedArchived, getSortDirection: arcSortDir, toggleSort: arcToggle } = useSortableTable<typeof archivedRows[number], ArcSortKey>(archivedRows, {
    accessors: {
      name: (c) => c.name ?? "",
      category: (c) => c.use ?? "",
      active_ingredient: (c) => c.active_ingredient ?? "",
      manufacturer: (c) => c.manufacturer ?? "",
      archived: (c) => (c.deleted_at ? new Date(c.deleted_at) : null),
    },
    initial: { key: "archived", direction: "desc" },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["saved_chemicals", selectedVineyardId] });
    // Spray Job pickers and any chemical consumers should refresh too.
    qc.invalidateQueries({ queryKey: ["saved_chemicals"] });
  };

  const archiveMut = useMutation({
    mutationFn: (id: string) => archiveSavedChemical(id),
    onSuccess: () => {
      invalidate();
      toast({ title: "Chemical archived" });
      setConfirmArchive(null);
    },
    onError: (e: any) => toast({ title: "Archive failed", description: e?.message ?? String(e), variant: "destructive" }),
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => restoreSavedChemical(id),
    onSuccess: () => {
      invalidate();
      toast({ title: "Chemical restored" });
      setConfirmRestore(null);
    },
    onError: (e: any) => toast({ title: "Restore failed", description: e?.message ?? String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Chemicals</h1>
          <p className="text-sm text-muted-foreground">
            {canEdit ? "Owner/Manager can add, edit and archive vineyard chemicals." : "Read-only view."}
            {" "}Soft-deleted records are excluded.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4 mr-1" /> New chemical
          </Button>
        )}
      </div>

      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        Production data — changes save immediately to the live vineyard database.
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "archived")}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="archived">
            Archived{archived.length ? ` (${archived.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Group</div>
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any group</SelectItem>
                  {groups.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Use</div>
              <Select value={use} onValueChange={setUse}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any use</SelectItem>
                  {uses.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 ml-auto">
              <div className="text-xs text-muted-foreground">Search</div>
              <Input
                placeholder="Name, ingredient, target…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-72"
              />
            </div>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead active={chemSortDir("name")} onSort={() => chemToggle("name")}>Name</SortableTableHead>
                  <SortableTableHead active={chemSortDir("active_ingredient")} onSort={() => chemToggle("active_ingredient")}>Active ingredient</SortableTableHead>
                  <SortableTableHead active={chemSortDir("group")} onSort={() => chemToggle("group")}>Group</SortableTableHead>
                  <SortableTableHead active={chemSortDir("use")} onSort={() => chemToggle("use")}>Use</SortableTableHead>
                  <SortableTableHead active={chemSortDir("rate")} onSort={() => chemToggle("rate")}>Rate/ha</SortableTableHead>
                  <SortableTableHead active={chemSortDir("manufacturer")} onSort={() => chemToggle("manufacturer")}>Manufacturer</SortableTableHead>
                  {canEdit && <TableHead className="w-32 text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={canEdit ? 7 : 6} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                )}
                {error && (
                  <TableRow><TableCell colSpan={canEdit ? 7 : 6} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
                )}
                {!isLoading && !error && sortedRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 7 : 6} className="text-center text-muted-foreground py-8">
                      No chemicals found for this vineyard.
                    </TableCell>
                  </TableRow>
                )}
                {sortedRows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{fmt(c.name)}</TableCell>
                    <TableCell>{fmt(c.active_ingredient)}</TableCell>
                    <TableCell>{c.chemical_group ? <Badge variant="secondary">{c.chemical_group}</Badge> : "—"}</TableCell>
                    <TableCell>{fmt(c.use)}</TableCell>
                    <TableCell>
                      {c.rate_per_ha == null ? "—" : `${c.rate_per_ha}${c.unit ? ` ${c.unit}` : ""}`}
                    </TableCell>
                    <TableCell>{fmt(c.manufacturer)}</TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmArchive(c)}>
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="archived" className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1 ml-auto">
              <div className="text-xs text-muted-foreground">Search archived</div>
              <Input
                placeholder="Name, ingredient, manufacturer…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-72"
              />
            </div>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead active={arcSortDir("name")} onSort={() => arcToggle("name")}>Name</SortableTableHead>
                  <SortableTableHead active={arcSortDir("category")} onSort={() => arcToggle("category")}>Category</SortableTableHead>
                  <SortableTableHead active={arcSortDir("active_ingredient")} onSort={() => arcToggle("active_ingredient")}>Active ingredient</SortableTableHead>
                  <SortableTableHead active={arcSortDir("manufacturer")} onSort={() => arcToggle("manufacturer")}>Manufacturer</SortableTableHead>
                  <SortableTableHead active={arcSortDir("archived")} onSort={() => arcToggle("archived")}>Archived</SortableTableHead>
                  {canEdit && <TableHead className="w-32 text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {archivedQuery.isLoading && (
                  <TableRow><TableCell colSpan={canEdit ? 6 : 5} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                )}
                {archivedQuery.error && (
                  <TableRow><TableCell colSpan={canEdit ? 6 : 5} className="text-center text-destructive py-6">{(archivedQuery.error as Error).message}</TableCell></TableRow>
                )}
                {!archivedQuery.isLoading && !archivedQuery.error && sortedArchived.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 6 : 5} className="text-center text-muted-foreground py-8">
                      No archived chemicals.
                    </TableCell>
                  </TableRow>
                )}
                {sortedArchived.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{fmt(c.name)}</TableCell>
                    <TableCell>{fmt(c.use)}</TableCell>
                    <TableCell>{fmt(c.active_ingredient)}</TableCell>
                    <TableCell>{fmt(c.manufacturer)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.deleted_at ? new Date(c.deleted_at).toLocaleDateString() : "—"}
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => setConfirmRestore(c)}>
                          <RotateCcw className="h-3.5 w-3.5" /> Restore
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <ChemicalEditor
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        initial={editing && editing !== "new" ? editing : null}
        vineyardId={selectedVineyardId!}
        onSaved={() => {
          invalidate();
          setEditing(null);
        }}
      />

      <AlertDialog open={!!confirmArchive} onOpenChange={(o) => !o && setConfirmArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{confirmArchive?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The chemical will be soft-deleted and hidden from spray-job pickers. You can restore it later from the Archived tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveMut.isPending}
              onClick={() => confirmArchive && archiveMut.mutate(confirmArchive.id)}
            >
              {archiveMut.isPending ? "Archiving…" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmRestore} onOpenChange={(o) => !o && setConfirmRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore “{confirmRestore?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This chemical will become active again and reappear in spray-job pickers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoreMut.isPending}
              onClick={() => confirmRestore && restoreMut.mutate(confirmRestore.id)}
            >
              {restoreMut.isPending ? "Restoring…" : "Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChemicalEditor({
  open, onOpenChange, initial, vineyardId, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: SavedChemical | null;
  vineyardId: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<SavedChemicalInput>(EMPTY);
  const [rateStr, setRateStr] = useState("");
  const [whp, setWhp] = useState("");
  const [rei, setRei] = useState("");
  const [restNotes, setRestNotes] = useState("");

  // Reset when opening
  useMemo(() => {
    if (open) {
      if (initial) {
        const useVal = matchCategory(initial.use) ?? (initial.use ?? "");
        setForm({
          name: initial.name ?? "",
          active_ingredient: initial.active_ingredient ?? "",
          chemical_group: initial.chemical_group ?? "",
          use: useVal,
          manufacturer: initial.manufacturer ?? "",
          crop: initial.crop ?? "",
          problem: initial.problem ?? "",
          rate_per_ha: initial.rate_per_ha ?? null,
          unit: initial.unit ?? "",
          restrictions: initial.restrictions ?? "",
          notes: initial.notes ?? "",
        });
        setRateStr(initial.rate_per_ha == null ? "" : String(initial.rate_per_ha));
        const p = parseRestrictions(initial.restrictions);
        setWhp(p.whpDays);
        setRei(p.reiHours);
        setRestNotes(p.rest);
      } else {
        setForm(EMPTY);
        setRateStr("");
        setWhp("");
        setRei("");
        setRestNotes("");
      }
    }
  }, [open, initial]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const rateNum = rateStr.trim() === "" ? null : Number(rateStr);
      if (rateNum != null && Number.isNaN(rateNum)) {
        throw new Error("Rate per ha must be a number");
      }
      const restrictions = composeRestrictions({ whpDays: whp, reiHours: rei, rest: restNotes });
      const payload: SavedChemicalInput = { ...form, rate_per_ha: rateNum, restrictions };
      if (!payload.name || !payload.name.trim()) throw new Error("Name is required");
      if (initial) return updateSavedChemical(initial.id, payload);
      return createSavedChemical(vineyardId, payload);
    },
    onSuccess: () => {
      toast({ title: initial ? "Chemical updated" : "Chemical created" });
      onSaved();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message ?? String(e), variant: "destructive" }),
  });

  const set = <K extends keyof SavedChemicalInput>(k: K, v: SavedChemicalInput[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const applySuggestion = (s: AppliedSuggestion) => {
    setForm((p) => ({
      ...p,
      name: s.name ?? p.name ?? "",
      active_ingredient: s.active_ingredient ?? p.active_ingredient ?? "",
      use: s.category ?? p.use ?? "",
      chemical_group: s.chemical_group ?? p.chemical_group ?? "",
      manufacturer: s.manufacturer ?? p.manufacturer ?? "",
      unit: s.rate_unit ?? p.unit ?? "",
      notes: s.notes ?? p.notes ?? "",
    }));
    if (s.rate_per_ha != null) setRateStr(String(s.rate_per_ha));
    if (s.whp_days) setWhp(s.whp_days);
    if (s.rei_hours) setRei(s.rei_hours);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{initial ? "Edit chemical" : "New chemical"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3 text-sm">
          <ChemicalAILookup initialName={form.name ?? ""} onApply={applySuggestion} />
          <Field label="Product name *">
            <Input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Active ingredient">
            <Input value={form.active_ingredient ?? ""} onChange={(e) => set("active_ingredient", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Product type / category">
              <Select value={form.use ?? ""} onValueChange={(v) => set("use", v)}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {PRODUCT_CATEGORIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Chemical group (optional)">
              <Input value={form.chemical_group ?? ""} onChange={(e) => set("chemical_group", e.target.value)} placeholder="e.g. Group 3, DMI" />
            </Field>
          </div>
          <Field label="Supplier / manufacturer">
            <Input value={form.manufacturer ?? ""} onChange={(e) => set("manufacturer", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Crop"><Input value={form.crop ?? ""} onChange={(e) => set("crop", e.target.value)} /></Field>
            <Field label="Target pest / disease / weed"><Input value={form.problem ?? ""} onChange={(e) => set("problem", e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default rate">
              <Input type="number" inputMode="decimal" step="any" value={rateStr} onChange={(e) => setRateStr(e.target.value)} />
            </Field>
            <Field label="Unit (chemical)">
              <Input
                value={chemUnitOnly(form.unit ?? "")}
                placeholder="L, mL, kg, g"
                onChange={(e) => {
                  const cu = e.target.value;
                  const basis = inferRateBasis(form.unit);
                  set("unit", composeUnit(cu, basis));
                }}
              />
            </Field>
          </div>
          <Field label="Rate basis">
            <RadioGroup
              className="flex gap-6"
              value={inferRateBasis(form.unit)}
              onValueChange={(v) => {
                const basis = v as RateBasis;
                const cu = chemUnitOnly(form.unit ?? "") || "L";
                set("unit", composeUnit(cu, basis));
              }}
            >
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <RadioGroupItem value="per_hectare" /> {RATE_BASIS_LABEL.per_hectare}
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <RadioGroupItem value="per_100L" /> {RATE_BASIS_LABEL.per_100L}
              </label>
            </RadioGroup>
            <p className="text-[11px] text-muted-foreground mt-1">
              Choose whether this product rate is applied by area or by spray volume.
            </p>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Withholding period (days)">
              <Input type="number" inputMode="decimal" step="any" value={whp} onChange={(e) => setWhp(e.target.value)} />
            </Field>
            <Field label="Re-entry period (hours)">
              <Input type="number" inputMode="decimal" step="any" value={rei} onChange={(e) => setRei(e.target.value)} />
            </Field>
          </div>
          <Field label="Other restrictions / safety notes">
            <Textarea rows={2} value={restNotes} onChange={(e) => setRestNotes(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
        <SheetFooter className="mt-6 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? "Saving…" : initial ? "Save changes" : "Create"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
