import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PortalNotice } from "@/components/ui/PortalNotice";
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
  hardDeleteUnusedSavedChemical, ChemicalInUseError,
  type SavedChemical, type SavedChemicalInput,
} from "@/lib/savedChemicalsQuery";
import { PRODUCT_CATEGORIES, matchCategory, parseRestrictions, composeRestrictions } from "@/lib/chemicalCategories";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Pencil, Archive, RotateCcw, Check, ChevronsUpDown, ExternalLink, FileText, Globe, Trash2, Info } from "lucide-react";
import { toChemicalIntelligence } from "@/lib/chemicalIntelligence";
import { VerificationBadge, ActivityGroupSummary } from "@/components/chemicals/ChemicalIntelligenceBadges";
import { ChemicalIntelligenceDialog } from "@/components/chemicals/ChemicalIntelligenceDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { ChemicalAILookup, type AppliedSuggestion } from "@/components/spray/ChemicalAILookup";
import { JurisdictionNoticeBanner } from "@/components/chemicals/JurisdictionNotice";
import { countryLabel, jurisdictionSuitability } from "@/lib/chemicalJurisdiction";

import { MasterUpdateDialog } from "@/components/chemicals/MasterUpdateDialog";
import {
  fetchMasterChemical,
  masterChemicalDraft,
  masterRevision,
  masterUpdateAvailable,
  MASTER_CURRENT_MESSAGE,
  MASTER_UPDATE_MESSAGE,
} from "@/lib/masterChemicals";
import { ChemicalIntelligenceEditor } from "@/components/chemicals/ChemicalIntelligenceEditor";
import {
  type ChemicalIntelligenceDraft,
  activityGroupReferenceSource,
  draftFromRow,
  emptyDraft,
  encodeChemicalIntelligenceForWrite,
  reconcileEditedDraft,
  hasStructuredIntelligence,
  parseLegacyActiveIngredient,
  suggestActivityGroup,
  withSource,
} from "@/lib/chemicalIntelligenceWrite";
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
import { formatDate } from "@/lib/dateFormat";
import { ChemicalEditor } from "@/components/chemicals/ChemicalEditorSheet";

type ChemColId = "name" | "active_ingredient" | "groups" | "verification" | "group" | "use" | "rate" | "manufacturer" | "label" | "cost";
const CHEM_DEFAULT_COLUMNS: ChemColId[] = [
  "name", "active_ingredient", "groups", "verification", "group", "use", "rate", "manufacturer", "label", "cost",
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
  restrictions: "", notes: "", label_url: "", product_url: "",
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
  const [confirmHardDelete, setConfirmHardDelete] = useState<SavedChemical | null>(null);
  const [detailRow, setDetailRow] = useState<SavedChemical | null>(null);

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
    onError: (e: any) => toast({
      title: "Archive failed. Please try again.",
      description: e?.message ?? String(e),
      variant: "destructive",
    }),
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

  const hardDeleteMut = useMutation({
    mutationFn: (id: string) => hardDeleteUnusedSavedChemical(id),
    onSuccess: () => {
      invalidate();
      toast({ title: "Chemical deleted permanently" });
      setConfirmHardDelete(null);
    },
    onError: (e: any) => {
      if (e instanceof ChemicalInUseError) {
        toast({
          title: "Can't delete this chemical",
          description: "This chemical has been used and cannot be permanently deleted. You can archive it instead.",
          variant: "destructive",
        });
        setConfirmHardDelete(null);
        return;
      }
      toast({ title: "Delete failed. Please try again.", description: e?.message ?? String(e), variant: "destructive" });
    },
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
      case "groups": return <TableHead><DraggableHeaderCell columnId="groups" onDropColumn={moveChemColumn}>Activity groups</DraggableHeaderCell></TableHead>;
      case "verification": return <TableHead><DraggableHeaderCell columnId="verification" onDropColumn={moveChemColumn}>Verification</DraggableHeaderCell></TableHead>;
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
      case "groups": return <TableCell key="groups"><ActivityGroupSummary chem={toChemicalIntelligence(c)} /></TableCell>;
      case "verification": return <TableCell key="verification"><VerificationBadge status={toChemicalIntelligence(c).verification.status} /></TableCell>;
      case "group": return <TableCell key="group">{c.chemical_group ? <Badge variant="secondary">{c.chemical_group}</Badge> : "—"}</TableCell>;
      case "use": return <TableCell key="use">{fmt(c.use)}</TableCell>;
      case "rate": return <TableCell key="rate">{c.rate_per_ha == null ? "—" : `${c.rate_per_ha}${c.unit ? ` ${displayUnitText(c.unit)}` : ""}`}</TableCell>;
      case "manufacturer": return <TableCell key="manufacturer">{fmt(c.manufacturer)}</TableCell>;
      case "label": return (
        <TableCell key="label">
          <div className="flex flex-col gap-0.5 text-xs">
            {c.label_url && /^https?:\/\//i.test(c.label_url) ? (
              <a href={c.label_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" title={c.label_url}>
                <FileText className="h-3 w-3" />Label
              </a>
            ) : (<span className="text-muted-foreground italic">No label found</span>)}
            {c.product_url && /^https?:\/\//i.test(c.product_url) && (
              <a href={c.product_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary hover:underline" title={`Manufacturer/product page — not the official label: ${c.product_url}`}>
                <Globe className="h-3 w-3" />Product page
              </a>
            )}
          </div>
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

      <PortalNotice
        variant="warning"
        compact
        description="Production data — changes save immediately to the live vineyard database."
      />

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
                  <TableHead className="w-40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={visibleChemColumns.length + 1} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                )}
                {error && (
                  <TableRow><TableCell colSpan={visibleChemColumns.length + 1} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
                )}
                {!isLoading && !error && sortedRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={visibleChemColumns.length + 1} className="text-center text-muted-foreground py-8">
                      No chemicals found for this vineyard.
                    </TableCell>
                  </TableRow>
                )}
                {sortedRows.map((c) => (
                  <TableRow key={c.id}>
                    {visibleChemColumns.map((id) => (
                      <React.Fragment key={id}>{renderChemCell(id, c)}</React.Fragment>
                    ))}
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setDetailRow(c)} title="Chemical intelligence">
                        <Info className="h-3.5 w-3.5" />
                      </Button>
                      {canEdit && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmArchive(c)} title="Archive">
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmHardDelete(c)}
                          title="Delete permanently (only if unused)"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                      )}
                    </TableCell>
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
                  <TableHead className="w-40 text-right">Actions</TableHead>
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
                      {c.deleted_at ? formatDate(c.deleted_at) : "—"}
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

      <ChemicalIntelligenceDialog row={detailRow} open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)} />

      <AlertDialog open={!!confirmArchive} onOpenChange={(o) => !o && setConfirmArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{confirmArchive?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Archive this chemical? It will be hidden from active chemical lists but kept for historical records.
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

      <AlertDialog open={!!confirmHardDelete} onOpenChange={(o) => !o && setConfirmHardDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{confirmHardDelete?.name}” permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete this chemical permanently? This is only available because it has not been used in any spray records or jobs. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={hardDeleteMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmHardDelete && hardDeleteMut.mutate(confirmHardDelete.id)}
            >
              {hardDeleteMut.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
