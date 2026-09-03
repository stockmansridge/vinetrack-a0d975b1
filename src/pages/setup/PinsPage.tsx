import { useEffect, useMemo, useState, Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Download, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { useVineyard } from "@/context/VineyardContext";
import { useDiagnosticPanel } from "@/lib/systemAdmin";
import { fetchList } from "@/lib/queries";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { matchesPinSearch, matchesRowRange, parseRowBound } from "@/lib/pinsFilter";
import { Badge } from "@/components/ui/badge";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReorderableHead } from "@/components/table/ReorderableHead";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { useSortableTable } from "@/lib/useSortableTable";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import PinsMapView, { type PinStatusFilter } from "@/components/PinsMapView";
import PinDetailSheet from "@/components/PinDetailSheet";
import { pinDisplayStyle, applyPinStatusFilter, pinIsCompleted } from "@/lib/pinStyle";
import { PIN_CATEGORY_ORDER, normalisePinCategoryId, pinCategoryStyleById, type PinCategoryId } from "@/lib/pinCategory";
import { pinPlacementDisplay } from "@/lib/pinPlacement";
import { usePinPlacements } from "@/lib/pinPlacementQuery";
import { usePinCategoryColours } from "@/lib/pinCategoryColoursQuery";
import { buildPinsDiagnostics, pinDisplayTitle } from "@/lib/pinsDiagnostics";
import { parsePolygonPoints } from "@/lib/paddockGeometry";
import { fetchPinsForVineyard } from "@/lib/pinsQuery";
import { fetchPinsRawCounts } from "@/lib/pinsRawCounts";
import { downloadPinsCsv } from "@/lib/pinsExport";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import UnifiedPinDialog from "@/components/pins/UnifiedPinDialog";
import { useVintageFilter } from "@/hooks/useVintageFilter";
import { VintageSelect } from "@/components/VintageSelect";

interface PaddockLite {
  id: string;
  name: string | null;
  row_direction?: number | null;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export default function PinsPage() {
  const { selectedVineyardId, memberships } = useVineyard();
  const isMobile = useIsMobile();
  // Side-by-side table + detail panel only on very wide screens so the
  // detail panel never gets squeezed on laptop widths.
  const sideBySide = useMediaQuery("(min-width: 1536px)");
  const showPinDiagnostics = useDiagnosticPanel("show_pin_diagnostics");
  const queryClient = useQueryClient();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;
  const [tab, setTab] = useState("table");
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [rowFrom, setRowFrom] = useState("");
  const [rowTo, setRowTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<PinStatusFilter>("active");
  const [categoryFilter, setCategoryFilter] = useState<PinCategoryId | "all">("all");
  const [exporting, setExporting] = useState(false);
  const [locationFilter, setLocationFilter] = useState<"all" | "assigned" | "unassigned">("all");
  const catColours = usePinCategoryColours();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { resolve } = useTeamLookup(selectedVineyardId);
  const rf = useRegionFormatters();
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const resolvePerson = (raw?: string | null, userId?: string | null): string => {
    const fromId = userId ? resolve(userId) : null;
    if (fromId) return fromId;
    const t = (raw ?? "").trim();
    if (!t) return userId ? "Unknown member" : "—";
    if (UUID_RE.test(t)) return resolve(t) ?? "Unknown member";
    return t;
  };

  const { data: paddocks = [] } = useQuery({
    queryKey: ["paddocks-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PaddockLite>("paddocks", selectedVineyardId!),
  });

  const paddockIds = useMemo(() => paddocks.map((p) => p.id), [paddocks]);

  const vintageFilter = useVintageFilter(
    { table: "pins", dateColumn: "created_at" },
    { defaultToAll: true },
  );
  const vintageScopeValue = vintageFilter.scope;

  const { data: pinsResult, isLoading, error } = useQuery({
    queryKey: ["pins", selectedVineyardId, paddockIds.length, vintageFilter.vintage ?? "all"],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchPinsForVineyard(selectedVineyardId!, paddockIds, vintageScopeValue),
  });
  const pins = pinsResult?.pins ?? [];

  const { data: rawCounts } = useQuery({
    queryKey: ["pins-raw-counts", selectedVineyardId, paddockIds.length],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchPinsRawCounts(selectedVineyardId!, paddockIds),
  });

  const paddockNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    paddocks.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [paddocks]);

  const paddockRowDirById = useMemo(() => {
    const m = new Map<string, number | null>();
    paddocks.forEach((p) => {
      const v = p.row_direction;
      m.set(p.id, v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    });
    return m;
  }, [paddocks]);

  const paddockPolygonCount = useMemo(
    () =>
      paddocks.reduce(
        (n, p: any) => n + (parsePolygonPoints(p.polygon_points).length >= 3 ? 1 : 0),
        0,
      ),
    [paddocks],
  );

  // Diagnostics — read-only logging (dev only).
  const diag = useMemo(
    () => ({
      ...buildPinsDiagnostics(selectedVineyardId, pins, paddockPolygonCount),
      paddockCount: paddocks.length,
      pinsBySource: pinsResult?.source ?? "n/a",
      vineyardIdMatches: pinsResult?.vineyardCount ?? 0,
      paddockIdFallbackAdded: pinsResult?.paddockFallbackCount ?? 0,
    }),
    [selectedVineyardId, pins, paddocks.length, paddockPolygonCount, pinsResult],
  );
  if (import.meta.env.DEV && showPinDiagnostics) {
    // eslint-disable-next-line no-console
    console.debug("[PinsPage] diagnostics", diag);
    const tally = (k: string) => {
      const m = new Map<string, number>();
      for (const p of pins) {
        const v = String((p as any)[k] ?? "∅");
        m.set(v, (m.get(v) ?? 0) + 1);
      }
      return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
    };
    // eslint-disable-next-line no-console
    console.debug("[PinsPage] distinct values", {
      mode: tally("mode"),
      category: tally("category"),
      button_color: tally("button_color"),
      priority: tally("priority"),
      status: tally("status"),
    });
  }

  const statusCounts = useMemo(() => {
    let active = 0;
    let completed = 0;
    for (const p of pins) {
      if (pinIsCompleted(p as any)) completed++;
      else active++;
    }
    return { active, completed, all: pins.length };
  }, [pins]);

  const statusFiltered = useMemo(
    () => applyPinStatusFilter(pins, statusFilter),
    [pins, statusFilter],
  );

  // Canonical SQL 171 placements for every loaded pin. Assignment,
  // block/row display, counts and filters all originate here — never from
  // fields on the base `pins` row.
  const { placements } = usePinPlacements(useMemo(() => pins.map((p) => p.id), [pins]));

  const locationCounts = useMemo(() => {
    let assigned = 0;
    let unassigned = 0;
    for (const p of statusFiltered) {
      if (placements.get(p.id)?.is_location_assigned === true) assigned++;
      else if (pinPlacementDisplay(placements.get(p.id)).showWarning) unassigned++;
    }
    return { assigned, unassigned, all: statusFiltered.length };
  }, [statusFiltered, placements]);

  const [searchParams, setSearchParams] = useSearchParams();
  const paddockFilter = searchParams.get("paddock");
  const paddockFilterName = paddockFilter
    ? paddockNameById.get(paddockFilter) ?? null
    : null;
  const setPaddockFilter = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("paddock", id);
    else next.delete("paddock");
    setSearchParams(next, { replace: true });
  };
  const clearPaddockFilter = () => setPaddockFilter(null);

  const hasActiveFilters =
    !!search.trim() ||
    !!paddockFilter ||
    !!rowFrom.trim() ||
    !!rowTo.trim() ||
    categoryFilter !== "all" ||
    locationFilter !== "all";

  const clearAllFilters = () => {
    setSearch("");
    setRowFrom("");
    setRowTo("");
    setCategoryFilter("all");
    setLocationFilter("all");
    setPaddockFilter(null);
  };


  const categoryCounts = useMemo(() => {
    const m = new Map<PinCategoryId, number>();
    for (const p of statusFiltered) {
      const id = normalisePinCategoryId(p as any);
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [statusFiltered]);

  const rowFromNum = parseRowBound(rowFrom);
  const rowToNum = parseRowBound(rowTo);

  const filtered = useMemo(() => {
    let list = statusFiltered;
    if (categoryFilter !== "all") {
      list = list.filter((p: any) => normalisePinCategoryId(p) === categoryFilter);
    }
    if (locationFilter === "assigned") {
      list = list.filter((p: any) => placements.get(p.id)?.is_location_assigned === true);
    } else if (locationFilter === "unassigned") {
      list = list.filter((p: any) => pinPlacementDisplay(placements.get(p.id)).showWarning);
    }
    if (paddockFilter) {
      list = list.filter((p: any) => placements.get(p.id)?.paddock_id === paddockFilter);
    }
    if (rowFromNum != null || rowToNum != null) {
      list = list.filter((p: any) => matchesRowRange(placements.get(p.id), rowFromNum, rowToNum));
    }
    if (!search.trim()) return list;
    return list.filter((p: any) => {
      const d = pinPlacementDisplay(placements.get(p.id));
      return matchesPinSearch(p, d.blockLabel, d.rowLabel, search);
    });
  }, [statusFiltered, search, paddockFilter, categoryFilter, locationFilter, placements, rowFromNum, rowToNum]);


  const PRIORITY_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1 };
  type PinSortKey =
    | "title" | "mode" | "paddock" | "row" | "status"
    | "priority" | "category" | "stage"
    | "created" | "createdBy" | "completed" | "completedBy";
  const { sorted, getSortDirection, toggleSort } = useSortableTable<any, PinSortKey>(filtered, {
    accessors: {
      title: (p: any) => (p.title ?? p.button_name ?? "") as string,
      mode: (p: any) => (p.mode ?? "") as string,
      paddock: (p: any) => pinPlacementDisplay(placements.get(p.id)).blockLabel,
      row: (p: any) => pinPlacementDisplay(placements.get(p.id)).rowLabel,
      status: (p: any) => (p.is_completed ? "Completed" : (p.status ?? "Open")),
      priority: (p: any) => (p.priority ? PRIORITY_ORDER[String(p.priority).toLowerCase()] ?? 0 : null),
      category: (p: any) => pinCategoryStyleById(normalisePinCategoryId(p)).label,
      stage: (p: any) => (p.growth_stage_code ?? "") as string,
      created: (p: any) => (p.created_at ? new Date(p.created_at) : null),
      createdBy: (p: any) => resolvePerson(p.created_by, p.created_by_user_id),
      completed: (p: any) => (p.is_completed && p.completed_at ? new Date(p.completed_at) : null),
      completedBy: (p: any) => p.is_completed ? resolvePerson(p.completed_by, p.completed_by_user_id) : "",
    },
    initial: { key: "created", direction: "desc" },
  });


  // Hide optional columns when no pins have a value for them.
  const hasMode = pins.some((p: any) => p.mode);
  const hasPriority = pins.some((p: any) => p.priority);
  const hasCategory = true;
  const hasStage = pins.some((p: any) => p.growth_stage_code);
  const hasAnyCompleted = pins.some((p: any) => p.is_completed);

  const colCount =
    4 /* title, paddock, row, status */ +
    (hasMode ? 1 : 0) +
    (hasPriority ? 1 : 0) +
    (hasCategory ? 1 : 0) +
    (hasStage ? 1 : 0) +
    2 /* created, createdBy */ +
    (hasAnyCompleted ? 2 : 0);

  const selected = pins.find((p) => p.id === selectedId) ?? null;

  const PIN_ALL_COLS = ["title","mode","paddock","row","status","priority","category","stage","created","createdBy","completed","completedBy"] as const;
  type PinCol = (typeof PIN_ALL_COLS)[number];
  const { order: pinOrder, moveColumn: pinMove, reset: pinReset } = useColumnOrder(
    "pins_table",
    PIN_ALL_COLS as unknown as string[],
    { vineyardId: selectedVineyardId },
  );
  // Hide lower-priority columns by default on laptop and smaller widths so
  // the table doesn't crowd the detail panel / get clipped.
  const compact = !sideBySide;
  const visibleByCol: Record<PinCol, boolean> = {
    title: true,
    mode: hasMode,
    paddock: true,
    row: true,
    status: true,
    priority: hasPriority,
    category: hasCategory,
    stage: hasStage,
    created: true,
    createdBy: !compact,
    completed: hasAnyCompleted && !compact,
    completedBy: hasAnyCompleted && !compact,
  };
  const pinLabels: Record<PinCol, string> = {
    title: "Title", mode: "Type", paddock: rf.blockLabel, row: "Row",
    status: "Status", priority: "Priority", category: "Category", stage: "Stage",
    created: "Created", createdBy: "Created by", completed: "Completed", completedBy: "Completed by",
  };
  const pinSortKey: Record<PinCol, PinSortKey> = {
    title: "title", mode: "mode", paddock: "paddock", row: "row",
    status: "status", priority: "priority", category: "category", stage: "stage",
    created: "created", createdBy: "createdBy", completed: "completed", completedBy: "completedBy",
  };

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Pins</h1>
          <p className="text-sm text-muted-foreground">Record location-based repairs, hazards, observations and other field items directly on the vineyard map. Use pins for anything that needs to be found, reviewed or actioned at a specific location.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            disabled={!selectedVineyardId}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Manual Pin / Repair / Observation
          </Button>

          <TabsList>
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="map">Map</TabsTrigger>
          </TabsList>
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Drop a pin, select a row or select a block.
      </p>

      <UnifiedPinDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        vineyardId={selectedVineyardId}
        paddocks={paddocks as any}
      />


      <PortalNotice
        variant="info"
        compact
        description="Pins can only be closed while in the field or through the VineTrack mobile app. This ensures VineTrack records when the pin was completed and who completed it."
      />


      {paddockFilter && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Filtered by {rf.blockLabel.toLowerCase()}:</span>
          <Badge variant="secondary">{paddockFilterName ?? paddockFilter.slice(0, 8)}</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={clearPaddockFilter}
          >
            <X className="h-3 w-3 mr-1" /> Clear
          </Button>
        </div>
      )}

      {showPinDiagnostics && (
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
        <div className="font-semibold">Pins diagnostics (temporary)</div>
        {!rawCounts ? (
          <div className="text-muted-foreground">Loading raw counts…</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-muted-foreground">
            <div>Supabase total (vineyard_id): <span className="text-foreground font-mono">{rawCounts.totalRows}</span></div>
            <div>Not deleted: <span className="text-foreground font-mono">{rawCounts.notDeleted}</span></div>
            <div>Soft-deleted (deleted_at not null): <span className="text-foreground font-mono">{rawCounts.deleted}</span></div>
            <div>Completed (is_completed=true): <span className="text-foreground font-mono">{rawCounts.completed}</span></div>
            <div>Active (not completed): <span className="text-foreground font-mono">{rawCounts.active}</span></div>
            <div>Missing paddock_id: <span className="text-foreground font-mono">{rawCounts.missingPaddock}</span></div>
            <div>Missing all row fields: <span className="text-foreground font-mono">{rawCounts.missingRow}</span></div>
            <div>Legacy (vineyard_id null, paddock match): <span className="text-foreground font-mono">{rawCounts.byVineyardIdNull}</span></div>
            <div className="col-span-2 md:col-span-4 pt-1 border-t">
              Portal loaded: <span className="text-foreground font-mono">{pins.length}</span>{" "}
              (source: <span className="font-mono">{pinsResult?.source ?? "—"}</span>,
              vineyard_id matches: <span className="font-mono">{pinsResult?.vineyardCount ?? 0}</span>,
              paddock_id fallback added: <span className="font-mono">{pinsResult?.paddockFallbackCount ?? 0}</span>)
              {rawCounts.notDeleted !== pins.length && (
                <span className="ml-2 text-destructive font-semibold">
                  Δ {rawCounts.notDeleted - pins.length} pin(s) in Supabase not loaded by portal
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      <Card className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Filters
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearAllFilters}>
              <X className="mr-1 h-3 w-3" /> Clear filters
            </Button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <VintageSelect
            vintage={vintageFilter.vintage}
            options={vintageFilter.options}
            onChange={vintageFilter.setVintage}
            className="space-y-1"
          />
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Search title, notes, {rf.blockLabel.toLowerCase()}</Label>
            <Input
              placeholder={`e.g. broken post`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{rf.blockLabel}</Label>
            <Select
              value={paddockFilter ?? "all"}
              onValueChange={(v) => setPaddockFilter(v === "all" ? null : v)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={`All ${rf.blockLabel.toLowerCase()}s`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All {rf.blockLabel.toLowerCase()}s</SelectItem>
                {paddocks.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name ?? p.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Row range</Label>
            <div className="flex items-center gap-2">
              <Input
                inputMode="decimal"
                placeholder="From"
                value={rowFrom}
                onChange={(e) => setRowFrom(e.target.value)}
                className="h-9"
                aria-label="Row from"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                inputMode="decimal"
                placeholder="To"
                value={rowTo}
                onChange={(e) => setRowTo(e.target.value)}
                className="h-9"
                aria-label="Row to"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Category</Label>
            <Select
              value={categoryFilter}
              onValueChange={(v) => setCategoryFilter(v as PinCategoryId | "all")}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {PIN_CATEGORY_ORDER.map((id) => {
                  const cs = pinCategoryStyleById(id);
                  const label = catColours.labelByCategory[id] ?? cs.label;
                  return (
                    <SelectItem key={id} value={id}>
                      {label} ({categoryCounts.get(id) ?? 0})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border bg-background p-0.5">
          {([
            { key: "active", label: "Active", count: statusCounts.active },
            { key: "completed", label: "Completed", count: statusCounts.completed },
            { key: "all", label: "All", count: statusCounts.all },
          ] as const).map((opt) => (
            <Button
              key={opt.key}
              size="sm"
              variant={statusFilter === opt.key ? "secondary" : "ghost"}
              className="h-7 px-3 text-xs"
              onClick={() => setStatusFilter(opt.key)}
            >
              {opt.label} ({opt.count})
            </Button>
          ))}
        </div>
        <div className="inline-flex rounded-md border bg-background p-0.5" aria-label="Location filter">
          {([
            { key: "all", label: "All locations", count: locationCounts.all },
            { key: "assigned", label: "Assigned", count: locationCounts.assigned },
            { key: "unassigned", label: "Unassigned", count: locationCounts.unassigned },
          ] as const).map((opt) => (
            <Button
              key={opt.key}
              size="sm"
              variant={locationFilter === opt.key ? "secondary" : "ghost"}
              className="h-7 px-3 text-xs"
              onClick={() => setLocationFilter(opt.key)}
            >
              {opt.label} ({opt.count})
            </Button>
          ))}
        </div>
      </div>


      <div className="flex flex-wrap items-center gap-1.5" aria-label="Category legend and filter">
        <Button
          size="sm"
          variant={categoryFilter === "all" ? "secondary" : "ghost"}
          className="h-7 px-3 text-xs"
          onClick={() => setCategoryFilter("all")}
        >
          All categories
        </Button>
        {PIN_CATEGORY_ORDER.map((id) => {
          const cs = pinCategoryStyleById(id);
          const hex = catColours.byCategory[id] ?? cs.hex;
          const label = catColours.labelByCategory[id] ?? cs.label;
          const count = categoryCounts.get(id) ?? 0;
          if (!count && id !== "other" && id !== "unknown") return null;
          return (
            <Button
              key={id}
              size="sm"
              variant={categoryFilter === id ? "secondary" : "ghost"}
              className="h-7 gap-1.5 px-3 text-xs"
              data-category-id={id}
              onClick={() => setCategoryFilter(categoryFilter === id ? "all" : id)}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: hex }}
              />
              {label} ({count})
            </Button>
          );
        })}
      </div>
      </Card>


      <TabsContent value="table" className="mt-0 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {sorted.length} pin{sorted.length === 1 ? "" : "s"}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["pins", selectedVineyardId] })}
              disabled={isLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedVineyardId || exporting}
              onClick={async () => {
                if (!selectedVineyardId) return;
                setExporting(true);
                try {
                  const n = await downloadPinsCsv(selectedVineyardId, vineyardName);
                  toast.success(`Exported ${n} pin${n === 1 ? "" : "s"}`);
                } catch (e) {
                  toast.error((e as Error).message || "Export failed");
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Export CSV
            </Button>

            <ColumnSettingsMenu onReset={pinReset} />
          </div>
        </div>
        <Card className="min-w-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {(pinOrder as PinCol[]).map((id) => {
                  if (!visibleByCol[id]) return null;
                  const align = id === "row" ? "right" : "left";
                  const sk = pinSortKey[id];
                  return (
                    <ReorderableHead
                      key={id}
                      columnId={id}
                      onDropColumn={pinMove}
                      align={align}
                      sort={{ active: getSortDirection(sk), onSort: () => toggleSort(sk) }}
                    >
                      {pinLabels[id]}
                    </ReorderableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center text-muted-foreground">Loading…</TableCell>
                </TableRow>
              )}
              {error && (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center text-destructive">
                    {(error as Error).message}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !error && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
                    {hasActiveFilters
                      ? "No pins match the current filters."
                      : statusFilter === "active"
                        ? "No active pins found."
                        : statusFilter === "completed"
                          ? "No completed pins found."
                          : "No pins found."}
                  </TableCell>
                </TableRow>
              )}
              {sorted.map((p) => {
                const style = pinDisplayStyle(p as any, catColours);
                const placement = pinPlacementDisplay(placements.get(p.id));
                const createdBy = resolvePerson((p as any).created_by, (p as any).created_by_user_id);
                const completedBy = (p as any).is_completed
                  ? resolvePerson((p as any).completed_by, (p as any).completed_by_user_id)
                  : "—";
                const cellMap: Record<PinCol, React.ReactNode> = {
                  title: (
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ background: style.hex }}
                          title={style.label}
                          data-category-id={style.categoryId}
                        />
                        <span className="truncate">{pinDisplayTitle(p as any)}</span>
                        {placement.showWarning && (
                          <span
                            className="inline-flex shrink-0 text-amber-500"
                            title="Unassigned location"
                            aria-label="Unassigned location"
                          >
                            <TriangleAlert className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                  ),
                  mode: <TableCell className="capitalize">{p.mode ?? "—"}</TableCell>,
                  paddock: (
                    <TableCell>
                      {placement.showWarning
                        ? <span className="text-amber-600 dark:text-amber-400 text-xs">Unassigned location</span>
                        : placement.blockLabel}
                    </TableCell>
                  ),
                  row: (
                    <TableCell className="text-right tabular-nums whitespace-pre-line text-xs leading-tight">
{placement.rowLabel}
                    </TableCell>
                  ),
                  status: (
                    <TableCell>
                      {(p as any).is_completed ? <Badge>Completed</Badge> : p.status ? <Badge variant="outline">{p.status}</Badge> : <Badge variant="outline">Open</Badge>}
                    </TableCell>
                  ),
                  priority: <TableCell>{p.priority ? <Badge variant="secondary">{p.priority}</Badge> : "—"}</TableCell>,
                  category: <TableCell>{style.label}</TableCell>,
                  stage: <TableCell>{p.growth_stage_code ?? "—"}</TableCell>,
                  created: <TableCell className="text-sm text-muted-foreground">{p.created_at ? rf.date(p.created_at) : "—"}</TableCell>,
                  createdBy: <TableCell className="text-sm">{createdBy}</TableCell>,
                  completed: <TableCell className="text-sm text-muted-foreground">{(p as any).is_completed ? ((p as any).completed_at ? rf.date((p as any).completed_at) : "—") : "—"}</TableCell>,
                  completedBy: <TableCell className="text-sm">{completedBy}</TableCell>,
                };
                return (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(p.id)}
                    data-active={p.id === selectedId}
                  >
                    {(pinOrder as PinCol[]).map((id) => {
                      if (!visibleByCol[id]) return null;
                      return <Fragment key={id}>{cellMap[id]}</Fragment>;
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
        <PinDetailSheet
          open={!!selected}
          onOpenChange={(open) => !open && setSelectedId(null)}
          pin={selected}
          paddockName={selected?.paddock_id ? paddockNameById.get(selected.paddock_id) ?? null : null}
          vineyardName={vineyardName}
          paddockRowDirection={selected?.paddock_id ? paddockRowDirById.get(selected.paddock_id) ?? null : null}
          placement={selected ? placements.get(selected.id) ?? null : null}
          side={isMobile ? "bottom" : "right"}
        />


      </TabsContent>

      <TabsContent value="map" className="mt-0">
        <PinsMapView statusFilter={statusFilter} />
      </TabsContent>
    </Tabs>
  );
}
