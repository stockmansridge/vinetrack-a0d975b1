import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  fetchYieldBlocks,
  fetchYieldReportsForVineyard,
  softDeleteHistoricalYieldRecord,
  softDeleteYieldEstimationSession,
  type YieldEstimationSession,
  type HistoricalYieldRecord,
} from "@/lib/yieldReportsQuery";
import { summariseYieldSession, type SessionBlockInfo } from "@/lib/yieldSessionSummary";
import RecordActualYieldDialog from "@/components/yield/RecordActualYieldDialog";
import YieldDamageAdjustmentPanel from "@/components/YieldDamageAdjustmentPanel";
import { Fragment } from "react";
import { ReorderableHead } from "@/components/table/ReorderableHead";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { useSortableTable } from "@/lib/useSortableTable";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import type { RegionFormatters } from "@/lib/regionFormatters";


const ANY = "__any__";

// Canonical conversion: 1 ha = 0.40468564224 ac, so 1 t/ha = 0.4047 t/ac.
const HA_PER_AC = 0.40468564224;

const mkFmtDate = (rf: RegionFormatters) => (v?: string | null) => {
  if (!v) return "—";
  return rf.date(v) || "—";
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtNum = (v?: number | null, digits = 2) =>
  v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });
const mkAreaVal = (rf: RegionFormatters) => (ha?: number | null, dp = 2) =>
  ha == null ? "—" : rf.area(ha, dp);
const mkYieldPerArea = (rf: RegionFormatters) => (tPerHa?: number | null, dp = 2) => {
  if (tPerHa == null) return "—";
  const v = rf.areaUnitLabel === "ac" ? tPerHa * HA_PER_AC : tPerHa;
  return `${fmtNum(v, dp)} t/${rf.areaUnitLabel}`;
};

type AnyRow = (YieldEstimationSession | HistoricalYieldRecord) & { __kind: "session" | "historical" };

export default function YieldReportsPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  // Portal-side mirror of the existing VineTrack role model. The RPC/RLS remains
  // the real security boundary — this only avoids showing an action that would fail.
  const canManageYields = currentRole === "owner" || currentRole === "manager";
  const rf = useRegionFormatters();
  const fmtDate = mkFmtDate(rf);
  const areaVal = mkAreaVal(rf);
  const yieldPerArea = mkYieldPerArea(rf);
  const areaUnit = rf.areaUnitLabel;
  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [yearFilter, setYearFilter] = useState<string>(ANY);
  const [completion, setCompletion] = useState<string>(ANY);
  const [tab, setTab] = useState<"all" | "sessions" | "historical">("all");
  const [selected, setSelected] = useState<AnyRow | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const qc = useQueryClient();

  const blocksQ = useQuery({
    queryKey: ["yield", "blocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchYieldBlocks(selectedVineyardId!),
  });

  const del = useMutation({
    mutationFn: async (row: AnyRow) =>
      row.__kind === "session"
        ? softDeleteYieldEstimationSession(row.id)
        : softDeleteHistoricalYieldRecord(row.id),
    onSuccess: () => {
      toast({ title: "Record deleted" });
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["yield_reports"] });
    },
    onError: (e: any) =>
      toast({ title: "Could not delete", description: e?.message ?? String(e), variant: "destructive" }),
  });


  const YIELD_COLS = ["date", "type", "season", "yield", "area", "status"] as const;
  type YieldCol = (typeof YIELD_COLS)[number];
  const { order: yOrder, moveColumn: yMove, reset: yReset } = useColumnOrder(
    "yield_reports_table",
    YIELD_COLS as unknown as string[],
    { vineyardId: selectedVineyardId },
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["yield_reports", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchYieldReportsForVineyard(selectedVineyardId!),
  });

  const sessions = data?.sessions ?? [];
  const historical = data?.historical ?? [];

  const years = useMemo(() => {
    const s = new Set<string>();
    historical.forEach((r) => {
      if (r.year != null) s.add(String(r.year));
      else if (r.season) s.add(r.season);
    });
    return Array.from(s).sort().reverse();
  }, [historical]);

  const allRows = useMemo<AnyRow[]>(() => {
    const a = sessions.map((s) => ({ ...s, __kind: "session" as const }));
    const b = historical.map((h) => ({ ...h, __kind: "historical" as const }));
    return [...a, ...b];
  }, [sessions, historical]);

  const rows = useMemo(() => {
    let list: AnyRow[] = tab === "sessions"
      ? allRows.filter((r) => r.__kind === "session")
      : tab === "historical"
      ? allRows.filter((r) => r.__kind === "historical")
      : allRows;

    list.sort((a, b) => {
      const ad = sortDate(a);
      const bd = sortDate(b);
      return (bd ?? "").localeCompare(ad ?? "");
    });

    if (from) list = list.filter((r) => (sortDate(r) ?? "") >= from);
    if (to) list = list.filter((r) => (sortDate(r) ?? "") <= to + "T23:59:59");

    if (yearFilter !== ANY) {
      list = list.filter((r) => {
        if (r.__kind === "historical") {
          const h = r as HistoricalYieldRecord;
          return String(h.year ?? "") === yearFilter || h.season === yearFilter;
        }
        return false;
      });
    }

    if (completion === "completed") {
      list = list.filter((r) =>
        r.__kind === "session" ? (r as YieldEstimationSession).is_completed : true,
      );
    } else if (completion === "open") {
      list = list.filter((r) =>
        r.__kind === "session" ? !(r as YieldEstimationSession).is_completed : false,
      );
    }

    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((r) => {
        if (r.__kind === "historical") {
          const h = r as HistoricalYieldRecord;
          return [h.season, h.year, h.notes]
            .some((v) => String(v ?? "").toLowerCase().includes(f));
        }
        const s = r as YieldEstimationSession;
        return JSON.stringify(s.payload ?? {}).toLowerCase().includes(f);
      });
    }
    return list;
  }, [allRows, tab, from, to, yearFilter, completion, filter]);

  const { sorted: rowsSorted, getSortDirection: yDir, toggleSort: yToggle } = useSortableTable<AnyRow, YieldCol>(rows, {
    accessors: {
      date: (r) => sortDate(r) ?? null,
      type: (r) => (r.__kind === "historical" ? "Historical" : "Estimation"),
      season: (r) => r.__kind === "historical" ? ((r as HistoricalYieldRecord).season ?? (r as HistoricalYieldRecord).year ?? null) : null,
      yield: (r) => r.__kind === "historical" ? ((r as HistoricalYieldRecord).total_yield_tonnes ?? null) : null,
      area: (r) => r.__kind === "historical" ? ((r as HistoricalYieldRecord).total_area_hectares ?? null) : null,
      status: (r) => r.__kind === "historical" ? "Archived" : ((r as YieldEstimationSession).is_completed ? "Completed" : "Open"),
    },
  });

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[YieldReportsPage] diagnostics", {
      selectedVineyardId,
      yieldReportsCount: (data?.sessionCount ?? 0) + (data?.historicalCount ?? 0),
      recordsBySource: data?.source ?? "n/a",
      breakdown: {
        sessions: data?.sessionCount ?? 0,
        historical: data?.historicalCount ?? 0,
      },
      deletedExcluded: {
        sessions: data?.deletedExcludedSessions ?? 0,
        historical: data?.deletedExcludedHistorical ?? 0,
      },
      missingDisplayFields: {
        missingSeason: data?.missingSeason ?? 0,
        missingYieldFields: data?.missingYieldFields ?? 0,
      },
      schemaGaps: [
        "no top-level paddock_id / variety / block_id (live inside payload/block_results jsonb)",
        "no estimated vs actual split column (only total_yield_tonnes on historical)",
        "no archive flag (only deleted_at on both tables)",
      ],
      filtered: rows.length,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Yields</h1>
          <p className="text-sm text-muted-foreground">
            Record and review vineyard production results by block, variety and season. Capture harvested weight, area, yield per hectare and other production information for comparing performance over time.
          </p>
        </div>
        <Button onClick={() => setRecordOpen(true)} disabled={!selectedVineyardId}>
          <Plus className="h-4 w-4 mr-1.5" /> Record Actual Yield
        </Button>
      </div>


      <PortalNotice
        variant="success"
        compact
        title="Actual yield records"
        description="Historical yield records are used by Cost Reports to calculate cost per tonne. Make sure each block has an actual yield record for the relevant season."
      />


      <YieldDamageAdjustmentPanel vineyardId={selectedVineyardId} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="all">All ({allRows.length})</TabsTrigger>
          <TabsTrigger value="sessions">Estimation sessions ({sessions.length})</TabsTrigger>
          <TabsTrigger value="historical">Historical ({historical.length})</TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap items-end gap-2 mt-4">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">From</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">To</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Season / year</div>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any season</SelectItem>
                {years.map((y) => (<SelectItem key={y} value={y}>{y}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Completion</div>
            <Select value={completion} onValueChange={setCompletion}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All</SelectItem>
                <SelectItem value="open">Open sessions</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 ml-auto">
            <div className="text-xs text-muted-foreground">Search</div>
            <Input
              placeholder="Season, notes, payload…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-72"
            />
          </div>
        </div>

        <TabsContent value={tab} className="mt-4">
          <div className="flex justify-end mb-2">
            <ColumnSettingsMenu onReset={yReset} />
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  {(yOrder as YieldCol[]).map((id) => {
                    const labels: Record<YieldCol, string> = {
                      date: "Date",
                      type: "Type",
                      season: "Season / year",
                      yield: "Total yield (t)",
                      area: "Area",
                      status: "Status",
                    };
                    return (
                      <ReorderableHead key={id} columnId={id} onDropColumn={yMove} sort={{ active: yDir(id), onSort: () => yToggle(id) }}>
                        {labels[id]}
                      </ReorderableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                )}
                {error && (
                  <TableRow><TableCell colSpan={6} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
                )}
                {!isLoading && !error && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No yield reports found for this vineyard.
                    </TableCell>
                  </TableRow>
                )}
                {rowsSorted.map((r) => {
                  const isHist = r.__kind === "historical";
                  const h = r as HistoricalYieldRecord;
                  const s = r as YieldEstimationSession;
                  const cellMap: Record<YieldCol, React.ReactNode> = {
                    date: <TableCell>{fmtDate(sortDate(r))}</TableCell>,
                    type: (
                      <TableCell>
                        <Badge variant={isHist ? "secondary" : "outline"}>
                          {isHist ? "Historical" : "Estimation"}
                        </Badge>
                      </TableCell>
                    ),
                    season: <TableCell>{isHist ? fmt(h.season ?? h.year) : "—"}</TableCell>,
                    yield: <TableCell>{isHist ? fmtNum(h.total_yield_tonnes) : "—"}</TableCell>,
                    area: <TableCell>{isHist ? areaVal(h.total_area_hectares) : "—"}</TableCell>,
                    status: (
                      <TableCell>
                        {isHist
                          ? <Badge variant="secondary">Archived</Badge>
                          : s.is_completed
                          ? <Badge>Completed</Badge>
                          : <Badge variant="outline">Open</Badge>}
                      </TableCell>
                    ),
                  };
                  return (
                    <TableRow key={r.__kind + ":" + r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                      {(yOrder as YieldCol[]).map((id) => <Fragment key={id}>{cellMap[id]}</Fragment>)}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>


      <YieldSheet
        row={selected}
        vineyardId={selectedVineyardId}
        blocks={blocksQ.data ?? []}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        onDelete={(r) => del.mutate(r)}
        deleting={del.isPending}
        canDelete={canManageYields}
      />


      <RecordActualYieldDialog
        vineyardId={selectedVineyardId}
        open={recordOpen}
        onOpenChange={setRecordOpen}
      />
    </div>
  );
}

function sortDate(r: AnyRow): string | null | undefined {
  if (r.__kind === "historical") {
    const h = r as HistoricalYieldRecord;
    return h.archived_at ?? h.updated_at ?? h.created_at ?? null;
  }
  const s = r as YieldEstimationSession;
  return s.completed_at ?? s.session_created_at ?? s.updated_at ?? s.created_at ?? null;
}

function YieldSheet({
  row,
  vineyardId,
  blocks,
  open,
  onOpenChange,
  onDelete,
  deleting,
  canDelete,
}: {
  row: AnyRow | null;
  vineyardId: string | null;
  blocks: SessionBlockInfo[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDelete: (row: AnyRow) => void;
  deleting: boolean;
  canDelete: boolean;
}) {
  const rf = useRegionFormatters();
  const fmtDate = mkFmtDate(rf);
  const isHistorical = row?.__kind === "historical";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {isHistorical ? "Historical yield" : "Estimation session"}
            {row ? ` — ${fmtDate(sortDate(row))}` : ""}
          </SheetTitle>
        </SheetHeader>
        {row?.__kind === "historical" && (
          <HistoricalDetail row={row as HistoricalYieldRecord} vineyardId={vineyardId} />
        )}
        {row?.__kind === "session" && (
          <SessionDetail row={row as YieldEstimationSession} blocks={blocks} />
        )}
        {row && canDelete && (
          <div className="mt-6 border-t pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleting}>
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Delete {isHistorical ? "yield record" : "session"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete this {isHistorical ? "yield record" : "estimation session"}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    The record is archived (soft deleted) and removed from the portal and the mobile
                    app. It is not permanently erased and can be restored by support if needed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(row)}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}



function HistoricalDetail({ row, vineyardId }: { row: HistoricalYieldRecord; vineyardId: string | null }) {
  const rf = useRegionFormatters();
  const fmtDate = mkFmtDate(rf);
  const areaVal = mkAreaVal(rf);
  const yieldPerArea = mkYieldPerArea(rf);
  const blocks = Array.isArray(row.block_results) ? row.block_results : null;
  return (
    <div className="mt-4 space-y-4 text-sm">
      <Section title="Summary">
        <Field label="Season" value={fmt(row.season)} />
        <Field label="Year" value={fmt(row.year)} />
        <Field label="Total yield (t)" value={fmtNum(row.total_yield_tonnes)} />
        <Field label="Total area" value={areaVal(row.total_area_hectares)} />
        <Field label={`Yield per ${rf.areaUnitLabel}`} value={
          row.total_yield_tonnes != null && row.total_area_hectares
            ? yieldPerArea(row.total_yield_tonnes / row.total_area_hectares)
            : "—"
        } />
        <Field label="Archived at" value={fmtDate(row.archived_at)} />
      </Section>
      {row.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap">{row.notes}</p>
        </Section>
      )}
      <YieldDamageAdjustmentPanel
        vineyardId={vineyardId}
        baseTonnes={row.total_yield_tonnes ?? null}
        baseLabel={row.season ?? (row.year != null ? String(row.year) : undefined)}
        compact
      />
      <Section title={`Block results${blocks ? ` (${blocks.length})` : ""}`}>
        {blocks ? (
          <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto max-h-80">
            {JSON.stringify(blocks, null, 2)}
          </pre>
        ) : (
          <span className="text-muted-foreground">No block results recorded.</span>
        )}
      </Section>
      <Section title="Meta">
        <Field label="Created" value={fmtDate(row.created_at)} />
        <Field label="Updated" value={fmtDate(row.updated_at)} />
        <Field label="Record ID" value={row.id} mono />
      </Section>
    </div>
  );
}

function fmtCoord(lat: any, lon: any): string | null {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return `${la.toFixed(5)}, ${lo.toFixed(5)}`;
}

function SessionDetail({
  row,
  blocks,
}: {
  row: YieldEstimationSession;
  blocks: SessionBlockInfo[];
}) {
  const rf = useRegionFormatters();
  const fmtDate = mkFmtDate(rf);
  const areaVal = mkAreaVal(rf);
  const yieldPerArea = mkYieldPerArea(rf);
  const summary = useMemo(
    () => summariseYieldSession(row.payload, { blocks }),
    [row.payload, blocks],
  );
  const showDev = import.meta.env.DEV;

  return (
    <div className="mt-4 space-y-4 text-sm">
      <Section title="Session">
        <Field label="Created" value={fmtDate(row.session_created_at ?? row.created_at)} />
        <Field label="Completed" value={row.is_completed ? "Yes" : "No"} />
        <Field label="Completed at" value={fmtDate(row.completed_at)} />
        {summary.samplesPerHectare != null && (
          <Field label={`Samples per ${rf.areaUnitLabel === "ac" ? "acre" : "hectare"}`} value={fmtNum(summary.samplesPerHectare, 0)} />
        )}
        {summary.season != null && <Field label="Season / year" value={fmt(summary.season)} />}
        {summary.notes && (
          <div className="pt-1">
            <div className="text-muted-foreground text-xs mb-1">Notes</div>
            <p className="whitespace-pre-wrap">{String(summary.notes)}</p>
          </div>
        )}
      </Section>

      {summary.blocks.length > 0 ? (
        <Section title={`Blocks sampled (${summary.blocks.length})`}>
          <div className="space-y-3">
            {summary.blocks.map((b, i) => (
              <div key={i} className="rounded-md border bg-background/40 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">
                    {b.blockName ?? (b.blockId ? <span className="font-mono text-xs">{String(b.blockId).slice(0, 8)}</span> : "Unnamed block")}
                  </div>
                  {b.variety && <Badge variant="outline">{String(b.variety)}</Badge>}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <Field label="Sample sites" value={`${b.recordedCount} / ${b.siteCount}`} />
                  <Field label="Avg bunches / vine" value={fmtNum(b.avgBunchesPerVine)} />
                  <Field
                    label="Avg bunch weight (kg)"
                    value={`${fmtNum(b.bunchWeightKg, 3)}${b.bunchWeightIsDefault ? " (default)" : ""}`}
                  />
                  <Field label="Vines" value={b.totalVines != null ? fmtNum(b.totalVines, 0) : "—"} />
                  {b.areaHa != null && <Field label="Area" value={areaVal(b.areaHa)} />}
                  <Field label="Total bunches" value={fmtNum(b.totalBunches, 0)} />
                  <Field
                    label="Estimated yield (t)"
                    value={fmtNum(b.estimatedYieldTonnes)}
                  />
                  <Field
                    label={`Yield per ${rf.areaUnitLabel}`}
                    value={
                      b.estimatedYieldTonnes != null && b.areaHa
                        ? yieldPerArea(b.estimatedYieldTonnes / b.areaHa)
                        : "—"
                    }
                  />
                </div>
                {b.notes && (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap pt-1">{String(b.notes)}</p>
                )}
                {b.sites.length > 0 && (
                  <details className="pt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      View {b.sites.length} sample site{b.sites.length === 1 ? "" : "s"}
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="h-8 text-xs">Site</TableHead>
                            <TableHead className="h-8 text-xs">Row</TableHead>
                            <TableHead className="h-8 text-xs text-right">Bunches / vine</TableHead>
                            <TableHead className="h-8 text-xs">Coords</TableHead>
                            <TableHead className="h-8 text-xs">Recorded</TableHead>
                            <TableHead className="h-8 text-xs">By</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {b.sites.map((s, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="text-xs">{s.siteIndex != null ? String(s.siteIndex) : "—"}</TableCell>
                              <TableCell className="text-xs">{s.rowNumber != null ? String(s.rowNumber) : "—"}</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {s.bunchesPerVine != null ? fmtNum(s.bunchesPerVine, 1) : "—"}
                              </TableCell>
                              <TableCell className="text-xs font-mono">{fmtCoord(s.lat, s.lon) ?? "—"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{fmtDate(s.recordedAt as any)}</TableCell>
                              <TableCell className="text-xs">{s.recordedBy ? String(s.recordedBy) : "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </Section>
      ) : (
        <Section title="Blocks sampled">
          <span className="text-muted-foreground">No sample sites recorded in this session.</span>
        </Section>
      )}

      <Section title="Yield estimate">
        {summary.totalEstTonnes != null ? (
          <div className="space-y-1.5">
            <Field label="Estimated total (t)" value={fmtNum(summary.totalEstTonnes)} />
            <Field label="Total area" value={areaVal(summary.totalAreaHa)} />
            <Field
              label={`Yield per ${rf.areaUnitLabel}`}
              value={
                summary.totalAreaHa
                  ? yieldPerArea(summary.totalEstTonnes / summary.totalAreaHa)
                  : "—"
              }
            />
            {(summary.missing.bunchWeight || summary.missing.vines) && (
              <p className="text-xs text-muted-foreground pt-1">
                {summary.missing.bunchWeight && "Some blocks use the default 0.15 kg bunch weight. "}
                {summary.missing.vines && "Some blocks have no vine count, so they are excluded from the total."}
              </p>
            )}
          </div>
        ) : summary.hasAnySamples ? (
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs">
              Yield estimate not available yet — the session is missing the data required to
              calculate tonnes:
            </p>
            <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
              {summary.missing.vines && <li>Vine count on the block (set vine spacing or a vine count override)</li>}
              {summary.missing.area && <li>Block area (map the block boundary)</li>}
            </ul>
          </div>
        ) : (
          <span className="text-muted-foreground">No samples recorded yet.</span>
        )}
      </Section>

      <Section title="Record">
        <Field label="Updated" value={fmtDate(row.updated_at)} />
        <Field label="Record ID" value={row.id} mono />
      </Section>

      {showDev && row.payload && (
        <details className="rounded-md border bg-muted/30 p-2">
          <summary className="cursor-pointer text-xs uppercase tracking-wide text-muted-foreground">
            Developer details (raw payload)
          </summary>
          <pre className="text-[11px] mt-2 overflow-x-auto max-h-96">
            {JSON.stringify(row.payload, null, 2)}
          </pre>
        </details>
      )}
    </div>
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
