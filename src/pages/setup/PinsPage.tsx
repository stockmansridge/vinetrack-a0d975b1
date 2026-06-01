import { useEffect, useMemo, useState, Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { useVineyard } from "@/context/VineyardContext";
import { useDiagnosticPanel } from "@/lib/systemAdmin";
import { fetchList } from "@/lib/queries";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { formatCell } from "@/pages/setup/ListPage";
import PinsMapView, { type PinStatusFilter } from "@/components/PinsMapView";
import PinDetailPanel, { PinRecord } from "@/components/PinDetailPanel";
import PinDetailSheet from "@/components/PinDetailSheet";
import SelectedPinMap from "@/components/SelectedPinMap";
import { pinStyle, formatPinRowSummary, applyPinStatusFilter, pinIsCompleted } from "@/lib/pinStyle";
import { buildPinsDiagnostics, pinDisplayTitle } from "@/lib/pinsDiagnostics";
import { parsePolygonPoints } from "@/lib/paddockGeometry";
import { fetchPinsForVineyard } from "@/lib/pinsQuery";
import { fetchPinsRawCounts } from "@/lib/pinsRawCounts";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<PinStatusFilter>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { resolve } = useTeamLookup(selectedVineyardId);
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

  const { data: pinsResult, isLoading, error } = useQuery({
    queryKey: ["pins", selectedVineyardId, paddockIds.length],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchPinsForVineyard(selectedVineyardId!, paddockIds),
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

  const [searchParams, setSearchParams] = useSearchParams();
  const paddockFilter = searchParams.get("paddock");
  const paddockFilterName = paddockFilter
    ? paddockNameById.get(paddockFilter) ?? null
    : null;
  const clearPaddockFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("paddock");
    setSearchParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    let list = statusFiltered;
    if (paddockFilter) {
      list = list.filter((p: any) => p.paddock_id === paddockFilter);
    }
    if (!filter) return list;
    const f = filter.toLowerCase();
    return list.filter((p) =>
      [p.title, (p as any).button_name, p.mode, p.category, p.priority, p.status, p.notes]
        .some((v) => String(v ?? "").toLowerCase().includes(f)),
    );
  }, [statusFiltered, filter, paddockFilter]);

  const PRIORITY_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1 };
  type PinSortKey =
    | "title" | "mode" | "paddock" | "row" | "status"
    | "priority" | "category" | "stage"
    | "created" | "createdBy" | "completed" | "completedBy";
  const { sorted, getSortDirection, toggleSort } = useSortableTable<any, PinSortKey>(filtered, {
    accessors: {
      title: (p: any) => (p.title ?? p.button_name ?? "") as string,
      mode: (p: any) => (p.mode ?? "") as string,
      paddock: (p: any) => (p.paddock_id ? paddockNameById.get(p.paddock_id) ?? "" : "") as string,
      row: (p: any) => {
        const v = p.pin_row_number ?? p.driving_row_number ?? p.row_number;
        return v == null ? null : Number(v);
      },
      status: (p: any) => (p.is_completed ? "Completed" : (p.status ?? "Open")),
      priority: (p: any) => (p.priority ? PRIORITY_ORDER[String(p.priority).toLowerCase()] ?? 0 : null),
      category: (p: any) => (p.category ?? "") as string,
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
  const hasCategory = pins.some((p: any) => p.category);
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
    title: "Title", mode: "Type", paddock: "Paddock", row: "Row",
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
          <p className="text-sm text-muted-foreground">Read-only field pin records.</p>
        </div>
        <TabsList>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
        </TabsList>
      </div>

      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        Production data — read-only view. No edits, archives, or deletions are possible from this page.
      </div>

      {paddockFilter && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Filtered by block:</span>
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

      <div className="flex items-center gap-2">
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
      </div>

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
            <Input
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-64"
            />
            <ColumnSettingsMenu onReset={pinReset} />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card>
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
                      {filter
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
                  const style = pinStyle(p.mode, (p as any).button_color, (p as any).category);
                  const createdBy = resolvePerson((p as any).created_by, (p as any).created_by_user_id);
                  const completedBy = (p as any).is_completed
                    ? resolvePerson((p as any).completed_by, (p as any).completed_by_user_id)
                    : "—";
                  const cellMap: Record<PinCol, React.ReactNode> = {
                    title: (
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: style.hex }} title={style.label} />
                          <span className="truncate">{pinDisplayTitle(p as any)}</span>
                        </div>
                      </TableCell>
                    ),
                    mode: <TableCell className="capitalize">{p.mode ?? "—"}</TableCell>,
                    paddock: <TableCell>{p.paddock_id ? (paddockNameById.get(p.paddock_id) ?? "—") : "—"}</TableCell>,
                    row: (
                      <TableCell className="text-right tabular-nums whitespace-pre-line text-xs leading-tight">
                        {formatPinRowSummary(p as any) ?? "—"}
                      </TableCell>
                    ),
                    status: (
                      <TableCell>
                        {(p as any).is_completed ? <Badge>Completed</Badge> : p.status ? <Badge variant="outline">{p.status}</Badge> : <Badge variant="outline">Open</Badge>}
                      </TableCell>
                    ),
                    priority: <TableCell>{p.priority ? <Badge variant="secondary">{p.priority}</Badge> : "—"}</TableCell>,
                    category: <TableCell>{p.category ?? "—"}</TableCell>,
                    stage: <TableCell>{p.growth_stage_code ?? "—"}</TableCell>,
                    created: <TableCell className="text-sm text-muted-foreground">{formatCell(p.created_at)}</TableCell>,
                    createdBy: <TableCell className="text-sm">{createdBy}</TableCell>,
                    completed: <TableCell className="text-sm text-muted-foreground">{(p as any).is_completed ? formatCell((p as any).completed_at) : "—"}</TableCell>,
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
          {!isMobile && (
            <div className="space-y-4">
              {selected ? (
                <>
                  <SelectedPinMap pin={selected} />
                  <PinDetailPanel
                    pin={selected}
                    paddockName={selected.paddock_id ? paddockNameById.get(selected.paddock_id) ?? null : null}
                    paddockRowDirection={selected.paddock_id ? paddockRowDirById.get(selected.paddock_id) ?? null : null}
                    vineyardName={vineyardName}
                    onClose={() => setSelectedId(null)}
                  />
                </>
              ) : (
                <Card className="p-4 text-sm text-muted-foreground">
                  Select a pin to see details.
                </Card>
              )}
            </div>
          )}
        </div>
        <PinDetailSheet
          open={isMobile && !!selected}
          onOpenChange={(open) => !open && setSelectedId(null)}
          pin={selected}
          paddockName={selected?.paddock_id ? paddockNameById.get(selected.paddock_id) ?? null : null}
          vineyardName={vineyardName}
          paddockRowDirection={selected?.paddock_id ? paddockRowDirById.get(selected.paddock_id) ?? null : null}
        />
      </TabsContent>

      <TabsContent value="map" className="mt-0">
        <PinsMapView statusFilter={statusFilter} />
      </TabsContent>
    </Tabs>
  );
}
