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
import { Plus, Pencil, Archive, RotateCcw, Check, ChevronsUpDown, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { ChemicalAILookup, type AppliedSuggestion } from "@/components/spray/ChemicalAILookup";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCanSeeCosts } from "@/lib/permissions";
import {
  inferRateBasis, composeUnit, chemUnitOnly, normaliseUnit,
  inferProductType, defaultUnitFor, unitsFor,
  RATE_BASIS_LABEL, PRODUCT_TYPE_LABEL, displayUnitText,
  type RateBasis, type ProductType, type ChemUnit,
} from "@/lib/rateBasis";
import { normaliseChemicalGroup, buildGroupOptions } from "@/lib/chemicalGroupNormalise";
import { normaliseManufacturerName, buildManufacturerOptions } from "@/lib/manufacturerNormalise";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { DraggableHeaderCell } from "@/components/table/DraggableHeaderCell";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";

type ChemColId = "name" | "active_ingredient" | "group" | "use" | "rate" | "manufacturer" | "label" | "cost";
const CHEM_DEFAULT_COLUMNS: ChemColId[] = [
  "name", "active_ingredient", "group", "use", "rate", "manufacturer", "label", "cost",
];

const ANY = "__any__";
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtMoney = (v?: number | null, currency = "AUD") => {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(v));
  } catch {
    return `$${Number(v).toFixed(2)}`;
  }
};

function purchaseCostPerUnit(purchase: any): number | null {
  const raw = purchase?.costPerBaseUnit ?? purchase?.cost_per_base_unit
    ?? purchase?.costPerUnit ?? purchase?.cost_per_unit;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function displayBaseUnit(unit?: string | null): string {
  const base = normaliseUnit(unit);
  return base || unit || "unit";
}

const EMPTY: SavedChemicalInput = {
  name: "", active_ingredient: "", chemical_group: "", use: "",
  manufacturer: "", crop: "", problem: "", rate_per_ha: null, unit: "",
  restrictions: "", notes: "", label_url: "",
};

export default function SavedChemicalsPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const canSeeCosts = useCanSeeCosts();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [filter, setFilter] = useState("");
  const [group, setGroup] = useState<string>(ANY);
  const [use, setUse] = useState<string>(ANY);
  const [activeIngredient, setActiveIngredient] = useState<string>(ANY);
  const [aiOpen, setAiOpen] = useState(false);
  const [manufacturer, setManufacturer] = useState<string>(ANY);
  const [mfrOpen, setMfrOpen] = useState(false);
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

  const groupOptions = useMemo(
    () => buildGroupOptions(chemicals.map((c) => c.chemical_group)),
    [chemicals],
  );
  const uses = useMemo(() => {
    const s = new Set<string>();
    chemicals.forEach((c) => c.use && s.add(c.use));
    return Array.from(s).sort();
  }, [chemicals]);

  const normaliseAI = (v: unknown) =>
    String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();

  const activeIngredientOptions = useMemo(() => {
    const map = new Map<string, string>(); // key -> display label (first-seen, title-ish)
    for (const c of chemicals) {
      const raw = String(c.active_ingredient ?? "").trim().replace(/\s+/g, " ");
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (!map.has(key)) map.set(key, raw);
    }
    return Array.from(map.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [chemicals]);

  const activeIngredientLabel = useMemo(() => {
    if (activeIngredient === ANY) return "";
    return activeIngredientOptions.find((o) => o.key === activeIngredient)?.label ?? "";
  }, [activeIngredient, activeIngredientOptions]);

  const manufacturerOptions = useMemo(
    () => buildManufacturerOptions(chemicals.map((c) => c.manufacturer)),
    [chemicals],
  );
  const manufacturerLabel = useMemo(() => {
    if (manufacturer === ANY) return "";
    return manufacturerOptions.find((o) => o.key === manufacturer)?.label ?? "";
  }, [manufacturer, manufacturerOptions]);

  const rows = useMemo(() => {
    let list = chemicals.slice().sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    if (group !== ANY) {
      list = list.filter((c) => normaliseChemicalGroup(c.chemical_group) === group);
    }
    if (use !== ANY) list = list.filter((c) => c.use === use);
    if (activeIngredient !== ANY) {
      list = list.filter((c) => normaliseAI(c.active_ingredient) === activeIngredient);
    }
    if (manufacturer !== ANY) {
      list = list.filter((c) => normaliseManufacturerName(c.manufacturer) === manufacturer);
    }
    if (filter.trim()) {
      const f = filter.toLowerCase();
      const fNorm = normaliseChemicalGroup(filter);
      const fMfr = normaliseManufacturerName(filter);
      list = list.filter((c) => {
        const groupNorm = normaliseChemicalGroup(c.chemical_group);
        if (fNorm && groupNorm && groupNorm.includes(fNorm)) return true;
        const mfrNorm = normaliseManufacturerName(c.manufacturer);
        if (fMfr && mfrNorm && mfrNorm.includes(fMfr)) return true;
        return [c.name, c.active_ingredient, c.manufacturer, c.chemical_group, c.use, c.crop, c.problem, c.notes, c.restrictions]
          .some((v) => String(v ?? "").toLowerCase().includes(f));
      });
    }
    return list;
  }, [chemicals, filter, group, use, activeIngredient, manufacturer]);

  type ChemSortKey = "name" | "active_ingredient" | "group" | "use" | "rate" | "manufacturer" | "cost";
  const { sorted: sortedRows, getSortDirection: chemSortDir, toggleSort: chemToggle } = useSortableTable<typeof rows[number], ChemSortKey>(rows, {
    accessors: {
      name: (c) => c.name ?? "",
      active_ingredient: (c) => c.active_ingredient ?? "",
      group: (c) => normaliseChemicalGroup(c.chemical_group),
      use: (c) => c.use ?? "",
      rate: (c) => (c.rate_per_ha == null ? null : Number(c.rate_per_ha)),
      manufacturer: (c) => normaliseManufacturerName(c.manufacturer) || (c.manufacturer ?? ""),
      cost: (c) => purchaseCostPerUnit(c.purchase),
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

  const { order: chemColumnOrder, moveColumn: moveChemColumn, reset: resetChemColumns } =
    useColumnOrder("chemicals_table", CHEM_DEFAULT_COLUMNS, { vineyardId: selectedVineyardId });
  // Filter out cost column when user can't see costs (still allowed in saved order, just skipped on render).
  const visibleChemColumns = useMemo<ChemColId[]>(
    () => (chemColumnOrder as ChemColId[]).filter((id) => id !== "cost" || canSeeCosts),
    [chemColumnOrder, canSeeCosts],
  );

  const renderChemHeader = (id: ChemColId): React.ReactNode => {
    switch (id) {
      case "name": return <SortableTableHead active={chemSortDir("name")} onSort={() => chemToggle("name")}><DraggableHeaderCell columnId="name" onDropColumn={moveChemColumn}>Name</DraggableHeaderCell></SortableTableHead>;
      case "active_ingredient": return <SortableTableHead active={chemSortDir("active_ingredient")} onSort={() => chemToggle("active_ingredient")}><DraggableHeaderCell columnId="active_ingredient" onDropColumn={moveChemColumn}>Active ingredient</DraggableHeaderCell></SortableTableHead>;
      case "group": return <SortableTableHead active={chemSortDir("group")} onSort={() => chemToggle("group")}><DraggableHeaderCell columnId="group" onDropColumn={moveChemColumn}>Group</DraggableHeaderCell></SortableTableHead>;
      case "use": return <SortableTableHead active={chemSortDir("use")} onSort={() => chemToggle("use")}><DraggableHeaderCell columnId="use" onDropColumn={moveChemColumn}>Use</DraggableHeaderCell></SortableTableHead>;
      case "rate": return <SortableTableHead active={chemSortDir("rate")} onSort={() => chemToggle("rate")}><DraggableHeaderCell columnId="rate" onDropColumn={moveChemColumn}>Default rate</DraggableHeaderCell></SortableTableHead>;
      case "manufacturer": return <SortableTableHead active={chemSortDir("manufacturer")} onSort={() => chemToggle("manufacturer")}><DraggableHeaderCell columnId="manufacturer" onDropColumn={moveChemColumn}>Manufacturer</DraggableHeaderCell></SortableTableHead>;
      case "label": return <TableHead className="w-20"><DraggableHeaderCell columnId="label" onDropColumn={moveChemColumn}>Label</DraggableHeaderCell></TableHead>;
      case "cost": return <SortableTableHead active={chemSortDir("cost")} onSort={() => chemToggle("cost")}><DraggableHeaderCell columnId="cost" onDropColumn={moveChemColumn}>Cost / unit</DraggableHeaderCell></SortableTableHead>;
    }
  };

  const renderChemCell = (id: ChemColId, c: typeof rows[number]): React.ReactNode => {
    switch (id) {
      case "name": return <TableCell key="name" className="font-medium">{fmt(c.name)}</TableCell>;
      case "active_ingredient": return <TableCell key="active_ingredient">{fmt(c.active_ingredient)}</TableCell>;
      case "group": return <TableCell key="group">{c.chemical_group ? <Badge variant="secondary">{c.chemical_group}</Badge> : "—"}</TableCell>;
      case "use": return <TableCell key="use">{fmt(c.use)}</TableCell>;
      case "rate": return <TableCell key="rate">{c.rate_per_ha == null ? "—" : `${c.rate_per_ha}${c.unit ? ` ${displayUnitText(c.unit)}` : ""}`}</TableCell>;
      case "manufacturer": return <TableCell key="manufacturer">{fmt(c.manufacturer)}</TableCell>;
      case "label": return (
        <TableCell key="label">
          {c.label_url && /^https?:\/\//i.test(c.label_url) ? (
            <a href={c.label_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline text-xs" title={c.label_url}>
              <ExternalLink className="h-3 w-3" />Label
            </a>
          ) : (<span className="text-muted-foreground">—</span>)}
        </TableCell>
      );
      case "cost": {
        const cost = purchaseCostPerUnit(c.purchase);
        const currency = c.purchase?.currency ?? "AUD";
        return <TableCell key="cost">{cost == null ? "—" : `${fmtMoney(cost, currency)} / ${displayBaseUnit(c.purchase?.unit ?? c.unit)}`}</TableCell>;
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-3">
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
                  {groupOptions.map((o) => (<SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>))}
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
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Active ingredient</div>
              <Popover open={aiOpen} onOpenChange={setAiOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={aiOpen}
                    className="w-64 justify-between font-normal"
                  >
                    <span className={cn("truncate", activeIngredient === ANY && "text-muted-foreground")}>
                      {activeIngredient === ANY ? "Any active ingredient" : activeIngredientLabel}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search active ingredient…" />
                    <CommandList>
                      <CommandEmpty>No matches.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__any__ any active ingredient"
                          onSelect={() => { setActiveIngredient(ANY); setAiOpen(false); }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", activeIngredient === ANY ? "opacity-100" : "opacity-0")} />
                          Any active ingredient
                        </CommandItem>
                        {activeIngredientOptions.map((o) => (
                          <CommandItem
                            key={o.key}
                            value={o.label}
                            onSelect={() => { setActiveIngredient(o.key); setAiOpen(false); }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", activeIngredient === o.key ? "opacity-100" : "opacity-0")} />
                            {o.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Manufacturer</div>
              <Popover open={mfrOpen} onOpenChange={setMfrOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={mfrOpen}
                    className="w-64 justify-between font-normal"
                  >
                    <span className={cn("truncate", manufacturer === ANY && "text-muted-foreground")}>
                      {manufacturer === ANY ? "Any manufacturer" : manufacturerLabel}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search manufacturer…" />
                    <CommandList>
                      <CommandEmpty>No matches.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__any__ any manufacturer"
                          onSelect={() => { setManufacturer(ANY); setMfrOpen(false); }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", manufacturer === ANY ? "opacity-100" : "opacity-0")} />
                          Any manufacturer
                        </CommandItem>
                        {manufacturerOptions.map((o) => (
                          <CommandItem
                            key={o.key}
                            value={o.label}
                            onSelect={() => { setManufacturer(o.key); setMfrOpen(false); }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", manufacturer === o.key ? "opacity-100" : "opacity-0")} />
                            {o.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
            <div className="space-y-1">

              <div className="text-xs text-muted-foreground opacity-0 select-none">.</div>
              <ColumnSettingsMenu onReset={resetChemColumns} />
            </div>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  {visibleChemColumns.map((id) => (
                    <React.Fragment key={id}>{renderChemHeader(id)}</React.Fragment>
                  ))}
                  {canEdit && <TableHead className="w-32 text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={visibleChemColumns.length + (canEdit ? 1 : 0)} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                )}
                {error && (
                  <TableRow><TableCell colSpan={visibleChemColumns.length + (canEdit ? 1 : 0)} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
                )}
                {!isLoading && !error && sortedRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={visibleChemColumns.length + (canEdit ? 1 : 0)} className="text-center text-muted-foreground py-8">
                      No chemicals found for this vineyard.
                    </TableCell>
                  </TableRow>
                )}
                {sortedRows.map((c) => (
                  <TableRow key={c.id}>
                    {visibleChemColumns.map((id) => (
                      <React.Fragment key={id}>{renderChemCell(id, c)}</React.Fragment>
                    ))}
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
        existingLibrary={chemicals}
        canSeeCosts={canSeeCosts}
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
  open, onOpenChange, initial, vineyardId, existingLibrary, canSeeCosts, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: SavedChemical | null;
  vineyardId: string;
  existingLibrary: SavedChemical[];
  canSeeCosts: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { currentCountry } = useVineyard();
  const [form, setForm] = useState<SavedChemicalInput>(EMPTY);
  const [rateStr, setRateStr] = useState("");
  const [packSizeStr, setPackSizeStr] = useState("");
  const [packPriceStr, setPackPriceStr] = useState("");
  const [packUnit, setPackUnit] = useState<string>("Litres");
  const [existingCost, setExistingCost] = useState<number | null>(null);
  const [currency, setCurrency] = useState("AUD");
  const [whp, setWhp] = useState("");
  const [rei, setRei] = useState("");
  const [restNotes, setRestNotes] = useState("");

  // Computed cost per base unit from pack size + pack price.
  const computedCost = useMemo(() => {
    const size = Number(packSizeStr);
    const price = Number(packPriceStr);
    if (!Number.isFinite(size) || !Number.isFinite(price)) return null;
    if (size <= 0 || price < 0) return null;
    return price / size;
  }, [packSizeStr, packPriceStr]);

  // Cost we'll actually save: prefer freshly computed, fall back to existing.
  const effectiveCost = computedCost ?? existingCost;

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
          label_url: initial.label_url ?? "",
          purchase: initial.purchase ?? null,
        });
        setRateStr(initial.rate_per_ha == null ? "" : String(initial.rate_per_ha));
        setExistingCost(purchaseCostPerUnit(initial.purchase));
        setPackSizeStr("");
        setPackPriceStr("");
        setPackUnit(displayBaseUnit(initial.purchase?.unit ?? initial.unit) || "Litres");
        setCurrency(initial.purchase?.currency ?? "AUD");
        const p = parseRestrictions(initial.restrictions);
        setWhp(p.whpDays);
        setRei(p.reiHours);
        setRestNotes(p.rest);
      } else {
        setForm(EMPTY);
        setRateStr("");
        setExistingCost(null);
        setPackSizeStr("");
        setPackPriceStr("");
        setPackUnit("Litres");
        setCurrency("AUD");
        setWhp("");
        setRei("");
        setRestNotes("");
      }
    }
  }, [open, initial]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const rateNum = rateStr.trim() === "" ? null : Number(rateStr);
      const costNum = effectiveCost;
      if (rateNum != null && Number.isNaN(rateNum)) {
        throw new Error("Rate per ha must be a number");
      }
      if (packSizeStr.trim() !== "" || packPriceStr.trim() !== "") {
        if (computedCost == null) {
          throw new Error("Enter both a pack size (> 0) and a pack price to calculate cost");
        }
      }
      const restrictions = composeRestrictions({ whpDays: whp, reiHours: rei, rest: restNotes });
      const payload: SavedChemicalInput = {
        ...form,
        rate_per_ha: rateNum,
        restrictions,
        purchase: canSeeCosts && costNum != null
          ? {
              ...(form.purchase ?? {}),
              costPerBaseUnit: costNum,
              cost_per_base_unit: costNum,
              costPerUnit: costNum,
              cost_per_unit: costNum,
              currency,
              unit: packUnit || displayBaseUnit(form.unit),
            }
          : null,
      };
      if (!payload.name || !payload.name.trim()) throw new Error("Name is required");
      const labelUrlRaw = (payload.label_url ?? "").trim();
      if (labelUrlRaw) {
        try {
          const u = new URL(labelUrlRaw);
          if (u.protocol !== "http:" && u.protocol !== "https:") {
            throw new Error("only http(s)");
          }
          payload.label_url = u.toString();
        } catch {
          throw new Error("Label link must be a full http:// or https:// URL");
        }
      } else {
        payload.label_url = "";
      }
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
    // Compose unit text from product type + chem unit + basis when AI gives
    // structured fields; fall back to whatever rate_unit string was returned.
    const basis = s.rate_basis ?? inferRateBasis(s.rate_unit);
    const productType = s.product_type ?? inferProductType(s.unit ?? s.rate_unit);
    const chemUnit = s.unit ?? (normaliseUnit(s.rate_unit) || defaultUnitFor(productType));
    const composed = s.rate_unit ?? composeUnit(chemUnit, basis);
    setForm((p) => ({
      ...p,
      name: s.name ?? p.name ?? "",
      active_ingredient: s.active_ingredient ?? p.active_ingredient ?? "",
      use: s.category ?? p.use ?? "",
      chemical_group: s.chemical_group ?? p.chemical_group ?? "",
      manufacturer: s.manufacturer ?? p.manufacturer ?? "",
      problem: s.target ?? p.problem ?? "",
      unit: composed,
      notes: s.notes ?? p.notes ?? "",
      label_url: s.label_url && /^https?:\/\//i.test(s.label_url) ? s.label_url : (p.label_url ?? ""),
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
          <ChemicalAILookup
            initialName={form.name ?? ""}
            country={currentCountry}
            existingLibrary={existingLibrary
              .filter((c) => !initial || c.id !== initial.id)
              .map((c) => ({
                id: c.id,
                name: c.name,
                active_ingredient: c.active_ingredient,
              }))}
            onApply={applySuggestion}
          />
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
          <Field label="Target pest / disease / weed (optional)">
            <Input
              value={form.problem ?? ""}
              onChange={(e) => set("problem", e.target.value)}
              placeholder="Leave blank for biostimulants / nutrition products"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Default rate">
              <Input type="number" inputMode="decimal" step="any" value={rateStr} onChange={(e) => setRateStr(e.target.value)} />
            </Field>
            <Field label="Product type">
              <Select
                value={inferProductType(form.unit)}
                onValueChange={(v) => {
                  const pt = v as ProductType;
                  const basis = inferRateBasis(form.unit);
                  set("unit", composeUnit(defaultUnitFor(pt), basis));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Liquid / Solid" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="liquid">{PRODUCT_TYPE_LABEL.liquid}</SelectItem>
                  <SelectItem value="solid">{PRODUCT_TYPE_LABEL.solid}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Unit">
              <Select
                value={(normaliseUnit(form.unit) as ChemUnit) || defaultUnitFor(inferProductType(form.unit))}
                onValueChange={(v) => {
                  const basis = inferRateBasis(form.unit);
                  set("unit", composeUnit(v, basis));
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {unitsFor(inferProductType(form.unit)).map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          {canSeeCosts && (
            <div className="rounded-md border border-border/60 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Pricing</h4>
                {existingCost != null && computedCost == null && (
                  <span className="text-[11px] text-muted-foreground">
                    Saved: {fmtMoney(existingCost, currency)} / {packUnit}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Enter the pack size and pack price. VineTrack will calculate the cost per L, mL, kg or g for costing.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Pack / container size">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={packSizeStr}
                    onChange={(e) => setPackSizeStr(e.target.value)}
                    placeholder="e.g. 20"
                  />
                </Field>
                <Field label="Pack unit">
                  <Select value={packUnit} onValueChange={setPackUnit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Litres">Litres</SelectItem>
                      <SelectItem value="mL">mL</SelectItem>
                      <SelectItem value="Kg">Kg</SelectItem>
                      <SelectItem value="g">g</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Pack price">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={packPriceStr}
                    onChange={(e) => setPackPriceStr(e.target.value)}
                    placeholder="e.g. 180.00"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr),120px] gap-3 items-end">
                <Field label="Calculated cost per unit">
                  <div className="vt-field flex w-full items-center px-3.5 py-2 text-sm bg-muted/40 text-muted-foreground">
                    {computedCost != null
                      ? `${fmtMoney(computedCost, currency)} / ${packUnit}`
                      : existingCost != null
                        ? `${fmtMoney(existingCost, currency)} / ${packUnit} (saved)`
                        : "—"}
                  </div>
                </Field>
                <Field label="Currency">
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AUD">AUD</SelectItem>
                      <SelectItem value="NZD">NZD</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          )}
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
          <Field label="Product label link">
            <Input
              type="url"
              inputMode="url"
              value={form.label_url ?? ""}
              onChange={(e) => set("label_url", e.target.value)}
              placeholder="https://…"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Link to the product label, SDS, APVMA page or manufacturer product page. Must start with https:// or http://.
            </p>
            {form.label_url && /^https?:\/\//i.test(form.label_url.trim()) && (
              <a
                href={form.label_url.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-1"
              >
                <ExternalLink className="h-3 w-3" />
                Open label
              </a>
            )}
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
