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
  extractHistoricalBlockRows,
  fetchYieldBlocks,
  fetchYieldReportsForVineyard,
  softDeleteHistoricalYieldRecord,
  softDeleteYieldEstimationSession,
  type YieldEstimationSession,
  type HistoricalYieldRecord,
} from "@/lib/yieldReportsQuery";
import { buildYieldOverview, type OverviewBlockCard } from "@/lib/yieldOverview";
import PickingLogPanel from "@/components/yield/PickingLogPanel";
import {
  aggregatePickingRecordsByPlanting,
  fetchPickingRecords,
  supersedeActualYield,
  type ActualYieldEntry,
} from "@/lib/pickingRecordsQuery";
import {
  buildAllocationUnits,
  matchAllocation,
  plantingLabel,
  type AllocationUnit,
} from "@/lib/yieldAllocations";
import { useVintage } from "@/lib/useVintage";
import { vintageForDate } from "@/lib/vineyardSeasonSettingsQuery";
import { buildVarietyMap, resolvePaddockAllocations, useGrapeVarieties } from "@/lib/varietyResolver";
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
  const { vintage: currentVintage, seasonStartMonth, seasonStartDay } = useVintage();
  const fmtDate = mkFmtDate(rf);
  const areaVal = mkAreaVal(rf);
  const yieldPerArea = mkYieldPerArea(rf);
  const areaUnit = rf.areaUnitLabel;
  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // `null` means "not chosen yet" and resolves to the vineyard's current vintage.
  const [vintageFilter, setVintageFilter] = useState<string | null>(null);
  const [completion, setCompletion] = useState<string>(ANY);
  const [tab, setTab] = useState<"overview" | "sessions" | "historical" | "picking">("overview");
  const [selected, setSelected] = useState<AnyRow | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const qc = useQueryClient();

  const blocksQ = useQuery({
    queryKey: ["yield", "blocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchYieldBlocks(selectedVineyardId!),
  });
  // Detailed Picking Log rows (sql/180). Read at record level rather than via
  // the Block + Variety aggregation view so the clone snapshot — the only
  // planting identity a pick carries — survives into the Overview.
  const pickingRecordsQ = useQuery({
    queryKey: ["picking_records", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchPickingRecords(selectedVineyardId!),
  });

  const { data: grapeVarieties } = useGrapeVarieties(selectedVineyardId);
  const varietyMap = useMemo(() => buildVarietyMap(grapeVarieties ?? []), [grapeVarieties]);

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


  const YIELD_COLS = ["date", "type", "vintage", "block", "variety", "yield", "area", "status"] as const;
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

  const allRows = useMemo<AnyRow[]>(() => {
    const a = sessions.map((s) => ({ ...s, __kind: "session" as const }));
    const b = historical.map((h) => ({ ...h, __kind: "historical" as const }));
    return [...a, ...b];
  }, [sessions, historical]);

  /** Harvest vintage of a row: stored year for historical records, derived from
   *  the session date via the shared season contract for estimations. */
  const rowVintage = useMemo(() => {
    return (r: AnyRow): number | null => {
      if (r.__kind === "historical") {
        const h = r as HistoricalYieldRecord;
        if (h.year != null) return Number(h.year);
        const m = /(\d{4})/.exec(h.season ?? "");
        return m ? Number(m[1]) : null;
      }
      const d = sortDate(r);
      if (!d) return null;
      const parsed = new Date(d);
      if (Number.isNaN(parsed.getTime())) return null;
      return vintageForDate(parsed, seasonStartMonth, seasonStartDay);
    };
  }, [seasonStartMonth, seasonStartDay]);

  const activeVintage = vintageFilter ?? String(currentVintage);

  const vintages = useMemo(() => {
    const s = new Set<string>();
    allRows.forEach((r) => {
      const v = rowVintage(r);
      if (v != null) s.add(String(v));
    });
    s.add(String(currentVintage));
    return Array.from(s).sort().reverse();
  }, [allRows, rowVintage, currentVintage]);

  const rows = useMemo(() => {
    let list: AnyRow[] = tab === "historical"
      ? allRows.filter((r) => r.__kind === "historical")
      : tab === "sessions"
      ? allRows.filter((r) => r.__kind === "session")
      : allRows;

    list.sort((a, b) => {
      const ad = sortDate(a);
      const bd = sortDate(b);
      return (bd ?? "").localeCompare(ad ?? "");
    });

    if (from) list = list.filter((r) => (sortDate(r) ?? "") >= from);
    if (to) list = list.filter((r) => (sortDate(r) ?? "") <= to + "T23:59:59");

    if (activeVintage !== ANY) {
      list = list.filter((r) => String(rowVintage(r) ?? "") === activeVintage);
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
          return [h.season, h.year, h.notes, JSON.stringify(h.block_results ?? {})]
            .some((v) => String(v ?? "").toLowerCase().includes(f));
        }
        const s = r as YieldEstimationSession;
        return JSON.stringify(s.payload ?? {}).toLowerCase().includes(f);
      });
    }
    return list;
  }, [allRows, tab, from, to, activeVintage, completion, filter, rowVintage]);

  // Session totals come from the same parser the detail sheet uses — one calculation only.
  const sessionSummaries = useMemo(() => {
    const blocks = blocksQ.data ?? [];
    const map = new Map<string, ReturnType<typeof summariseYieldSession>>();
    for (const s of sessions) map.set(s.id, summariseYieldSession(s.payload, { blocks }));
    return map;
  }, [sessions, blocksQ.data]);

  const rowTonnes = (r: AnyRow): number | null =>
    r.__kind === "historical"
      ? (r as HistoricalYieldRecord).total_yield_tonnes ?? null
      : sessionSummaries.get(r.id)?.totalEstTonnes ?? null;
  const rowAreaHa = (r: AnyRow): number | null =>
    r.__kind === "historical"
      ? (r as HistoricalYieldRecord).total_area_hectares ?? null
      : sessionSummaries.get(r.id)?.totalAreaHa ?? null;

  /** Honest block/variety context for a row: a single name when there is one,
   *  otherwise a count — never a misleading single block name. */
  const rowBlockVariety = (r: AnyRow): { block: string; variety: string } => {
    const names = new Set<string>();
    const varieties = new Set<string>();
    if (r.__kind === "historical") {
      const results = Array.isArray((r as HistoricalYieldRecord).block_results)
        ? ((r as HistoricalYieldRecord).block_results as any[])
        : [];
      for (const b of results) {
        const n = String(b?.blockName ?? b?.block_name ?? b?.paddockName ?? b?.paddock_name ?? "").trim();
        if (n) names.add(n);
        const v = String(b?.variety ?? b?.varietyName ?? b?.variety_name ?? "").trim();
        if (v) varieties.add(v);
      }
    } else {
      const summary = sessionSummaries.get(r.id);
      for (const b of summary?.blocks ?? []) {
        if (b.blockName) names.add(b.blockName);
        if (b.variety) varieties.add(b.variety);
      }
    }
    const label = (set: Set<string>, noun: string) =>
      set.size === 0 ? "—" : set.size === 1 ? Array.from(set)[0] : `${set.size} ${noun}`;
    return { block: label(names, "blocks"), variety: label(varieties, "varieties") };
  };

  const { sorted: rowsSorted, getSortDirection: yDir, toggleSort: yToggle } = useSortableTable<AnyRow, YieldCol>(rows, {
    accessors: {
      date: (r) => sortDate(r) ?? null,
      type: (r) => (r.__kind === "historical" ? "Actual yield" : "Estimation"),
      vintage: (r) => rowVintage(r),
      block: (r) => rowBlockVariety(r).block,
      variety: (r) => rowBlockVariety(r).variety,
      yield: (r) => rowTonnes(r),
      area: (r) => rowAreaHa(r),
      status: (r) => r.__kind === "historical" ? "Archived" : ((r as YieldEstimationSession).is_completed ? "Completed" : "Open"),
    },
  });

  // ---- Overview (quick view) for the selected vintage -----------------------
  const overviewCards = useMemo(() => {
    // Allocation units per block — each planting (variety + clone + rootstock)
    // is its own production unit so yield is never repeated across rows.
    const unitsByBlock = new Map<string, AllocationUnit[]>();
    const blocks = (blocksQ.data ?? []).map((b) => {
      const units = buildAllocationUnits({
        blockId: b.id,
        areaHa: b.areaHa ?? null,
        allocations: resolvePaddockAllocations(b.varietyAllocations, varietyMap),
      }).filter((u) => u.variety != null);
      unitsByBlock.set(b.id.toLowerCase(), units);
      return {
        id: b.id,
        name: b.name ?? null,
        areaHa: b.areaHa ?? null,
        varieties: units.map((u) => ({
          name: u.variety,
          percent: u.percent,
          allocationKey: u.key,
          allocationId: u.id,
          cloneLabel: u.cloneLabel,
          rootstockLabel: u.rootstockLabel,
          areaHa: u.areaHa,
        })),
      };
    });

    const vintageRows = allRows.filter(
      (r) => activeVintage === ANY || String(rowVintage(r) ?? "") === activeVintage,
    );

    const estimatedByBlock = new Map<string, number>();
    for (const r of vintageRows) {
      if (r.__kind !== "session") continue;
      const summary = sessionSummaries.get(r.id);
      for (const b of summary?.blocks ?? []) {
        if (!b.blockId || b.estimatedYieldTonnes == null) continue;
        const k = b.blockId.toLowerCase();
        estimatedByBlock.set(k, (estimatedByBlock.get(k) ?? 0) + b.estimatedYieldTonnes);
      }
    }

    // Basic actual yield (historical_yield_records).
    const basic: ActualYieldEntry[] = extractHistoricalBlockRows(
      vintageRows.filter((r) => r.__kind === "historical") as unknown as HistoricalYieldRecord[],
    ).map((h) => ({
      blockId: h.blockId,
      variety: h.variety,
      vintage: h.year ?? null,
      tonnes: h.yieldTonnes,
    }));

    // Detailed picks supersede Basic for the same Block + Variety + Vintage —
    // they are never summed together. Picks keep their clone snapshot so they
    // can be attributed to a single planting where that is unambiguous.
    const detailed = aggregatePickingRecordsByPlanting(pickingRecordsQ.data ?? []).filter(
      (d) => activeVintage === ANY || String(d.vintage ?? "") === activeVintage,
    );

    const actuals = supersedeActualYield(basic, detailed).map((a) => {
      const units = unitsByBlock.get((a.blockId ?? "").toLowerCase()) ?? [];
      const match = matchAllocation(units, a.variety, a.clone ?? null);
      return {
        blockId: a.blockId,
        variety: a.variety,
        tonnes: a.tonnes,
        allocationKey: match.key,
        source: a.source,
        pickCount: a.pickCount ?? null,
      };
    });

    return buildYieldOverview({ blocks, estimatedByBlock, actuals });
  }, [
    blocksQ.data,
    varietyMap,
    allRows,
    activeVintage,
    rowVintage,
    sessionSummaries,
    pickingRecordsQ.data,
  ]);



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
      activeVintage,
      filtered: rows.length,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Yields</h1>
          <p className="text-sm text-muted-foreground">
            Record and review vineyard production results by block, variety and vintage. Capture harvested weight, area, yield per hectare and other production information for comparing performance over time.
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
        description="Actual yield records are used by Cost Reports to calculate cost per tonne. Make sure each block has an actual yield record for the relevant vintage."
      />


      <YieldDamageAdjustmentPanel vineyardId={selectedVineyardId} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="border border-border bg-muted/70 shadow-sm">
          <TabsTrigger
            value="overview"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow data-[state=active]:border data-[state=active]:border-border"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="sessions"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow data-[state=active]:border data-[state=active]:border-border"
          >
            Estimations ({sessions.length})
          </TabsTrigger>
          <TabsTrigger
            value="historical"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow data-[state=active]:border data-[state=active]:border-border"
          >
            Actual Yields ({historical.length})
          </TabsTrigger>
          <TabsTrigger
            value="picking"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow data-[state=active]:border data-[state=active]:border-border"
          >
            Picking Log
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap items-end gap-2 mt-4">
          {tab !== "overview" && tab !== "picking" && (
            <>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">From</div>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">To</div>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
              </div>
            </>
          )}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Vintage</div>
            <Select value={activeVintage} onValueChange={setVintageFilter}>
              <SelectTrigger className="w-40" aria-label="Vintage"><SelectValue placeholder="Vintage" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All vintages</SelectItem>
                {vintages.map((y) => (<SelectItem key={y} value={y}>{y}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          {tab !== "overview" && tab !== "picking" && (
            <>
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
                  placeholder="Block, variety, notes…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-72"
                />
              </div>
            </>
          )}
        </div>

        <TabsContent value="picking" className="mt-4">
          <PickingLogPanel
            vineyardId={selectedVineyardId}
            vintage={activeVintage === ANY ? null : Number(activeVintage)}
            canDelete={canManageYields}
          />
        </TabsContent>

        <TabsContent value="overview" className="mt-4">
          <YieldOverviewGrid cards={overviewCards} vintage={activeVintage === ANY ? null : activeVintage} />
        </TabsContent>

        {(["sessions", "historical"] as const).map((t) => (
        <TabsContent key={t} value={t} className="mt-4">
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
                      vintage: "Vintage",
                      block: "Block",
                      variety: "Variety",
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
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                )}
                {error && (
                  <TableRow><TableCell colSpan={8} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
                )}
                {!isLoading && !error && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No yield records found for this vintage.
                    </TableCell>
                  </TableRow>
                )}
                {rowsSorted.map((r) => {
                  const isHist = r.__kind === "historical";
                  const s = r as YieldEstimationSession;
                  const bv = rowBlockVariety(r);
                  const cellMap: Record<YieldCol, React.ReactNode> = {
                    date: <TableCell>{fmtDate(sortDate(r))}</TableCell>,
                    type: (
                      <TableCell>
                        <Badge variant={isHist ? "secondary" : "outline"}>
                          {isHist ? "Actual yield" : "Estimation"}
                        </Badge>
                      </TableCell>
                    ),
                    vintage: <TableCell>{fmt(rowVintage(r))}</TableCell>,
                    block: <TableCell>{bv.block}</TableCell>,
                    variety: <TableCell>{bv.variety}</TableCell>,
                    yield: <TableCell>{fmtNum(rowTonnes(r))}</TableCell>,
                    area: <TableCell>{areaVal(rowAreaHa(r))}</TableCell>,
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
        ))}
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

/** Where an Actual Yield total came from — detailed picks or a manual entry. */
export function actualSourceLabel(
  source: "basic" | "detailed" | null,
  pickCount: number | null,
): string {
  if (source === "detailed") {
    const n = pickCount ?? 0;
    return `From ${n} picking record${n === 1 ? "" : "s"}`;
  }
  if (source === "basic") return "Manual actual yield";
  return "";
}

function YieldOverviewGrid({
  cards,
  vintage,
}: {
  cards: OverviewBlockCard[];
  vintage: string | null;
}) {
  const rf = useRegionFormatters();
  if (!cards.length) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No blocks configured for this vineyard yet.
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {vintage ? `Vintage ${vintage}` : "All vintages"} — estimated and actual tonnes by block and variety.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.blockId} className="p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-medium">{c.blockName}</div>
              {c.areaHa != null && (
                <span className="text-xs text-muted-foreground">{rf.area(c.areaHa, 2)}</span>
              )}
            </div>
            <div className="space-y-2">
              {c.varieties.map((v, i) => (
                <div
                  key={v.allocationKey ?? `${v.variety ?? "none"}-${i}`}
                  className="rounded-md border border-border/60 p-2 text-sm"
                >
                  <div className="text-foreground">{v.variety ?? "No variety configured"}</div>
                  <div className="text-xs text-muted-foreground">
                    {plantingLabel(v) ?? "Clone / rootstock not recorded"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Allocated area:{" "}
                    {v.areaHa != null
                      ? rf.area(v.areaHa, 2)
                      : v.percent != null
                      ? `${fmtNum(v.percent)}%`
                      : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Estimated: {v.estimatedTonnes == null ? "—" : `${fmtNum(v.estimatedTonnes)} t`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Actual: {v.actualTonnes == null ? "—" : `${fmtNum(v.actualTonnes)} t`}
                  </div>
                  {v.actualTonnes != null && (
                    <div className="text-xs text-muted-foreground">
                      {actualSourceLabel(v.actualSource, v.actualPickCount)}
                    </div>
                  )}
                </div>
              ))}
              {c.unallocated.map((u, i) => (
                <div
                  key={`not-linked-${i}`}
                  className="rounded-md border border-dashed border-border p-2 text-sm"
                >
                  <div className="text-foreground">
                    {u.variety ?? "No variety recorded"} — planting not linked
                  </div>
                  <div className="text-xs text-muted-foreground">
                    These picks are not linked to a specific planting allocation yet. Open the pick
                    and assign the planting to include it at allocation level.
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Actual: {fmtNum(u.actualTonnes)} t
                  </div>
                </div>
              ))}
              {(c.actualTonnes != null || c.estimatedTonnes != null) && (
                <div className="flex items-baseline justify-between border-t pt-2 text-sm">
                  <span className="text-muted-foreground text-xs">Block total</span>
                  <span className="tabular-nums text-xs">
                    Est {c.estimatedTonnes == null ? "—" : `${fmtNum(c.estimatedTonnes)} t`} · Actual{" "}
                    {c.actualTonnes == null ? "—" : `${fmtNum(c.actualTonnes)} t`}
                  </span>
                </div>
              )}
            </div>

          </Card>
        ))}
      </div>
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
        <Field label="Vintage" value={fmt(row.year ?? row.season)} />
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
        {summary.season != null && <Field label="Vintage" value={fmt(summary.season)} />}
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
