// Block-driven Pruning Tracker (portal parity with iOS).
//
// Model: paddocks first. Every active paddock in the selected vineyard
// appears immediately as a block. A pruning_seasons row is the *supporting*
// record that carries settings + progress for the current shared vintage,
// but its existence never gates visibility. If none exists the block reads
// as "Not started"; the season row is created lazily when the user first
// saves settings or records work.
//
// The season year comes from the shared vineyard season settings via
// useVintage() — never the local calendar year — so it stays in sync with
// iOS, Android and Operational Preferences.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { useVintage } from "@/lib/useVintage";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { PageHead } from "@/components/PageHead";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Scissors, Settings2, ArrowLeft, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import {
  usePruningSeasons,
  usePruningEntries,
  usePruningSegments,
  resolvePruningSeasonId,
  type PruningSeason,
} from "@/lib/pruningQuery";
import { pruningSeasonId } from "@/lib/pruningSeasonId";
import {
  buildRowIdentities,
  buildRowCompletion,
  computeBlockProgress,
  type BlockProgress,
  type RowIdentity,
  type RowCompletionState,
} from "@/lib/pruningCalc";
import { usePruningVineyardSummary, type PruningVineyardSummary, type PruningVineyardSummaryBlock } from "@/lib/pruningSummaryQuery";
import { parseRows, parseVarietyAllocations } from "@/lib/paddockGeometry";
import { formatDate } from "@/lib/dateFormat";
import SeasonDialog from "@/components/pruning/SeasonDialog";
import CompleteTodayDialog from "@/components/pruning/CompleteTodayDialog";
import ActivityHistory from "@/components/pruning/ActivityHistory";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Paddock {
  id: string;
  name: string | null;
  rows: any;
  polygon_points: any;
  vine_spacing: number | null;
  vine_count_override: number | null;
  variety_allocations: any;
}

function usePaddocks(vineyardId: string | null) {
  return useQuery({
    queryKey: ["pruning", "paddocks", vineyardId],
    enabled: !!vineyardId,
    queryFn: async (): Promise<Paddock[]> => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id, name, rows, polygon_points, vine_spacing, vine_count_override, variety_allocations")
        .eq("vineyard_id", vineyardId!)
        .is("deleted_at", null)
        .order("name", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Paddock[];
    },
  });
}

function StatusBadge({ p, hasSeason }: { p: BlockProgress; hasSeason: boolean }) {
  if (!hasSeason && p.completedSegments === 0) return <Badge variant="outline">Not started</Badge>;
  if (p.dueStatus === "complete") return <Badge className="bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="h-3 w-3 mr-1" />Complete</Badge>;
  if (p.dueStatus === "overdue") return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Behind</Badge>;
  if (p.dueStatus === "at_risk") return <Badge className="bg-amber-500 hover:bg-amber-500"><Clock className="h-3 w-3 mr-1" />At risk</Badge>;
  if (p.dueStatus === "on_track") return <Badge variant="secondary">On track</Badge>;
  if (p.completedSegments > 0) return <Badge variant="secondary">In progress</Badge>;
  return <Badge variant="outline">Not started</Badge>;
}

function rpcStatusToDueStatus(status: string | null | undefined): BlockProgress["dueStatus"] | null {
  if (!status) return null;
  if (status === "complete") return "complete";
  if (status === "on_track") return "on_track";
  if (status === "at_risk") return "at_risk";
  if (status === "overdue") return "overdue";
  return null;
}

function primaryVariety(p: Paddock): string {
  const allocs = parseVarietyAllocations(p.variety_allocations);
  if (!allocs.length) return "";
  const sorted = [...allocs].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  return sorted[0]?.variety ?? "";
}

function rowRangeLabel(ids: RowIdentity[]): string {
  if (!ids.length) return "No rows configured";
  const nums = ids.map((r) => r.rowNumber).filter((n) => Number.isFinite(n));
  if (!nums.length) return `${ids.length} rows`;
  const min = Math.min(...nums), max = Math.max(...nums);
  return min === max ? `Row ${min}` : `Rows ${min}–${max}`;
}

function searchName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

interface BlockView {
  paddock: Paddock;
  season: PruningSeason | null;
  identities: RowIdentity[];
  completion: RowCompletionState[];
  progress: BlockProgress;
  variety: string;
  firstRowNumber: number | null;
}

type SortKey = "name" | "row";

export default function PruningTrackerPage() {
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const { user } = useAuth();
  const vineyard = memberships.find((m) => m.vineyard_id === selectedVineyardId);
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const { isAdmin: isSystemAdmin } = useIsSystemAdmin();
  const { vintage, isLoading: vintageLoading } = useVintage();

  const seasonsQ = usePruningSeasons(selectedVineyardId);
  const paddocksQ = usePaddocks(selectedVineyardId);

  const [selectedPaddockId, setSelectedPaddockId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");

  // Switching vineyards must not leak a stale block selection or dialog
  // state from the previous vineyard — cross-vineyard paddock IDs won't
  // match and we'd render an empty detail view.
  useEffect(() => {
    setSelectedPaddockId(null);
    setSettingsOpen(false);
    setCompleteOpen(false);
  }, [selectedVineyardId]);

  const seasons = seasonsQ.data ?? [];
  const paddocks = paddocksQ.data ?? [];

  // All season rows for the current vintage, grouped by paddock. There may
  // be more than one per paddock (legacy random-UUID season rows created by
  // an earlier portal build can coexist with the deterministic iOS/Android
  // row). We aggregate segments/entries across ALL of them so per-block
  // stats reflect every recorded quarter, whichever season row it landed
  // on. `pruningSeasonId` gives the canonical id to prefer for display.
  const currentSeasonsByPaddock = useMemo(() => {
    const m = new Map<string, PruningSeason[]>();
    for (const s of seasons) {
      if (s.season_year !== vintage) continue;
      const list = m.get(s.paddock_id) ?? [];
      list.push(s);
      m.set(s.paddock_id, list);
    }
    return m;
  }, [seasons, vintage]);

  const canonicalSeasonByPaddock = useMemo(() => {
    const m = new Map<string, PruningSeason>();
    for (const [paddockId, list] of currentSeasonsByPaddock) {
      if (!list.length) continue;
      // Prefer the deterministic id if present, otherwise the newest row.
      const deterministic = selectedVineyardId
        ? pruningSeasonId(selectedVineyardId, paddockId, vintage)
        : null;
      const preferred = list.find((s) => s.id === deterministic)
        ?? [...list].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0];
      m.set(paddockId, preferred);
    }
    return m;
  }, [currentSeasonsByPaddock, selectedVineyardId, vintage]);

  const currentSeasonIds = useMemo(
    () => {
      const ids: string[] = [];
      for (const list of currentSeasonsByPaddock.values()) for (const s of list) ids.push(s.id);
      return ids;
    },
    [currentSeasonsByPaddock],
  );

  const segmentsQ = useQuery({
    queryKey: ["pruning", "vintage-segments", selectedVineyardId, vintage, currentSeasonIds.join(",")],
    enabled: !!selectedVineyardId && currentSeasonIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pruning_row_segments")
        .select("*")
        .in("pruning_season_id", currentSeasonIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const entriesQ = useQuery({
    queryKey: ["pruning", "vintage-entries", selectedVineyardId, vintage, currentSeasonIds.join(",")],
    enabled: !!selectedVineyardId && currentSeasonIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pruning_entries")
        .select("*")
        .in("pruning_season_id", currentSeasonIds)
        .is("deleted_at", null)
        .order("entry_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Map season_id -> paddock_id so we can resolve records even when the
  // row's own paddock_id column is null (older records / cross-platform
  // inserts sometimes leave it unset).
  const paddockBySeasonId = useMemo(() => {
    const m = new Map<string, string>();
    for (const [paddockId, list] of currentSeasonsByPaddock) {
      for (const s of list) m.set(s.id, paddockId);
    }
    return m;
  }, [currentSeasonsByPaddock]);

  const blocks: BlockView[] = useMemo(() => {
    const segs = segmentsQ.data ?? [];
    const ents = entriesQ.data ?? [];
    // Group by paddock_id, resolving via the season row when the record's
    // own paddock_id is null, so records split across duplicate season
    // rows (or missing paddock_id) still contribute to the same block.
    const bySeg = new Map<string, any[]>();
    const byEnt = new Map<string, any[]>();
    for (const s of segs) {
      const pid = s.paddock_id ?? paddockBySeasonId.get(s.pruning_season_id);
      if (!pid) continue;
      const list = bySeg.get(pid) ?? [];
      list.push(s);
      bySeg.set(pid, list);
    }
    for (const e of ents) {
      const pid = e.paddock_id ?? paddockBySeasonId.get(e.pruning_season_id);
      if (!pid) continue;
      const list = byEnt.get(pid) ?? [];
      list.push(e);
      byEnt.set(pid, list);
    }
    return paddocks.map((paddock) => {
      const season = canonicalSeasonByPaddock.get(paddock.id) ?? null;
      const paddockRows = parseRows(paddock.rows);
      const identities = buildRowIdentities(paddockRows, paddock, season?.manual_row_count ?? null);
      const completion = buildRowCompletion(identities, (bySeg.get(paddock.id) ?? []) as any);
      const shellSeason: PruningSeason = season ?? {
        id: "",
        vineyard_id: selectedVineyardId ?? "",
        paddock_id: paddock.id,
        season_year: vintage,
        start_date: null,
        due_date: null,
        pruning_method: "spur",
        assigned_crew: "",
        working_days: [1, 2, 3, 4, 5],
        manual_row_count: null,
        estimated_labour_hours: null,
        notes: "",
        status: "active",
        created_at: "",
        updated_at: "",
        deleted_at: null,
      };
      const progress = computeBlockProgress(
        identities,
        completion,
        (byEnt.get(paddock.id) ?? []) as any,
        shellSeason,
      );
      const firstRowNumber = identities.length ? identities[0].rowNumber : null;
      return {
        paddock,
        season,
        identities,
        completion,
        progress,
        variety: primaryVariety(paddock),
        firstRowNumber,
      };
    });
  }, [paddocks, canonicalSeasonByPaddock, paddockBySeasonId, segmentsQ.data, entriesQ.data, selectedVineyardId, vintage]);

  const sortedBlocks = useMemo(() => {
    const arr = [...blocks];
    if (sortKey === "name") {
      arr.sort((a, b) => (a.paddock.name ?? "").localeCompare(b.paddock.name ?? ""));
    } else {
      arr.sort((a, b) => {
        const av = a.firstRowNumber, bv = b.firstRowNumber;
        if (av == null && bv == null) return (a.paddock.name ?? "").localeCompare(b.paddock.name ?? "");
        if (av == null) return 1;
        if (bv == null) return -1;
        return av - bv;
      });
    }
    return arr;
  }, [blocks, sortKey]);

  // SQL 115: server-authoritative vineyard summary. Never recompute
  // these numbers locally — cross-platform parity depends on the RPC
  // being the sole source of truth.
  const summaryQ = usePruningVineyardSummary(selectedVineyardId, vintage);
  const summary = summaryQ.data ?? null;

  const membershipCheckQ = useQuery({
    queryKey: ["pruning", "membership-check", selectedVineyardId, user?.id ?? null],
    enabled: !!selectedVineyardId && !!user && isSystemAdmin,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("is_vineyard_member", {
        p_vineyard_id: selectedVineyardId,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });

  // Per-block RPC values keyed by paddock_id for card overlays.
  const rpcBlockByPaddock = useMemo(() => {
    const m = new Map<string, PruningVineyardSummaryBlock>();
    for (const b of summary?.blocks ?? []) if (b.paddock_id) m.set(String(b.paddock_id).toLowerCase(), b);
    return m;
  }, [summary]);

  const grunerPaddock = useMemo(
    () => paddocks.find((p) => searchName(p.name).includes("gruner veltliner")) ?? null,
    [paddocks],
  );

  const grunerDirectQ = useQuery({
    queryKey: ["pruning", "diagnostic-gruner-direct", selectedVineyardId, grunerPaddock?.id ?? null, vintage],
    enabled: !!selectedVineyardId && !!grunerPaddock && isSystemAdmin,
    queryFn: async () => {
      const { data: seasons, error: seasonsError } = await supabase
        .from("pruning_seasons")
        .select("*")
        .eq("vineyard_id", selectedVineyardId!)
        .eq("paddock_id", grunerPaddock!.id)
        .eq("season_year", vintage)
        .is("deleted_at", null);
      if (seasonsError) throw seasonsError;
      const seasonIds = (seasons ?? []).map((s: any) => s.id).filter(Boolean);
      if (seasonIds.length === 0) {
        return { seasons: seasons ?? [], entries: [], segments: [], seasonIds };
      }
      const [{ data: entries, error: entriesError }, { data: segments, error: segmentsError }] = await Promise.all([
        supabase
          .from("pruning_entries")
          .select("*")
          .in("pruning_season_id", seasonIds)
          .is("deleted_at", null),
        supabase
          .from("pruning_row_segments")
          .select("*")
          .in("pruning_season_id", seasonIds),
      ]);
      if (entriesError) throw entriesError;
      if (segmentsError) throw segmentsError;
      return { seasons: seasons ?? [], entries: entries ?? [], segments: segments ?? [], seasonIds };
    },
  });


  const selected = selectedPaddockId ? blocks.find((b) => b.paddock.id === selectedPaddockId) ?? null : null;
  // Aggregate segments/entries across ALL season rows for this paddock+vintage
  // so the detail view matches the block card (which already merges them).
  const selectedSeasonIds = useMemo(() => {
    if (!selectedPaddockId) return [] as string[];
    return (currentSeasonsByPaddock.get(selectedPaddockId) ?? []).map((s) => s.id);
  }, [currentSeasonsByPaddock, selectedPaddockId]);

  const selectedEntries = useMemo(
    () => (entriesQ.data ?? []).filter((e: any) => {
      const pid = e.paddock_id ?? paddockBySeasonId.get(e.pruning_season_id);
      return pid === selectedPaddockId;
    }),
    [entriesQ.data, paddockBySeasonId, selectedPaddockId],
  );
  const selectedSegments = useMemo(
    () => (segmentsQ.data ?? []).filter((s: any) => {
      const pid = s.paddock_id ?? paddockBySeasonId.get(s.pruning_season_id);
      return pid === selectedPaddockId;
    }),
    [segmentsQ.data, paddockBySeasonId, selectedPaddockId],
  );
  void selectedSeasonIds;
  const selectedEntriesQ = { data: selectedEntries };
  const selectedSegmentsQ = { data: selectedSegments };
  const selectedCompletion = useMemo(() => {
    if (!selected) return [];
    return buildRowCompletion(selected.identities, (selectedSegmentsQ.data ?? []) as any);
  }, [selected, selectedSegmentsQ.data]);

  const selectedCanonicalQ = useQuery({
    queryKey: ["pruning", "canonical-season-detail", selectedVineyardId, selectedPaddockId, vintage, summary?.blocks.map((b) => `${b.paddock_id}:${b.season_id ?? ""}`).join("|") ?? ""],
    enabled: !!selectedVineyardId && !!selectedPaddockId,
    queryFn: async () => {
      const { data: splitSeasons, error: splitError } = await supabase
        .from("pruning_seasons")
        .select("*")
        .eq("vineyard_id", selectedVineyardId!)
        .eq("paddock_id", selectedPaddockId!)
        .eq("season_year", vintage)
        .is("deleted_at", null);
      if (splitError) throw splitError;

      const seasonIds = (splitSeasons ?? []).map((s: any) => s.id).filter(Boolean);
      const rpcSeasonId = summary?.blocks.find((b) => b.paddock_id.toLowerCase() === selectedPaddockId!.toLowerCase())?.season_id ?? null;
      const deterministicId = pruningSeasonId(selectedVineyardId!, selectedPaddockId!, vintage);
      const season = (splitSeasons ?? []).find((s: any) => s.id === rpcSeasonId)
        ?? (splitSeasons ?? []).find((s: any) => s.id === deterministicId)
        ?? [...(splitSeasons ?? [])].sort((a: any, b: any) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0]
        ?? null;
      if (seasonIds.length === 0) {
        return {
          season: season as PruningSeason | null,
          entries: [] as any[],
          segments: [] as any[],
          seasonIds,
        };
      }

      const [{ data: entries, error: entriesError }, { data: segments, error: segmentsError }] = await Promise.all([
        supabase
          .from("pruning_entries")
          .select("*")
          .in("pruning_season_id", seasonIds)
          .is("deleted_at", null)
          .order("entry_date", { ascending: false }),
        supabase
          .from("pruning_row_segments")
          .select("*")
          .in("pruning_season_id", seasonIds),
      ]);
      if (entriesError) throw entriesError;
      if (segmentsError) throw segmentsError;
      return {
        season: season as PruningSeason | null,
        entries: entries ?? [],
        segments: segments ?? [],
        seasonIds,
      };
    },
  });

  const openSettings = () => setSettingsOpen(true);

  // Ensure a season row exists for the selected block before opening Complete
  // Today. Resolve-then-adopt: never generate a random season id, and if a
  // live row already exists (iOS/Android may have created it) we adopt it.
  const openComplete = async () => {
    if (!selected || !selectedVineyardId) return;
    if (!selected.season) {
      try {
        const resolved = await resolvePruningSeasonId(
          selectedVineyardId, selected.paddock.id, vintage,
        );
        if (!resolved.existed) {
          const { error } = await supabase.from("pruning_seasons").insert({
            id: resolved.id,
            vineyard_id: selectedVineyardId,
            paddock_id: selected.paddock.id,
            season_year: vintage,
            pruning_method: "spur",
            assigned_crew: "",
            working_days: [1, 2, 3, 4, 5],
            notes: "",
            status: "active",
            client_updated_at: new Date().toISOString(),
          });
          // Duplicate-key = another client won the race; refetch will pick
          // up the existing row. Any other error surfaces to the caller.
          if (error && !/duplicate|unique/i.test(error.message)) throw error;
        }
        await seasonsQ.refetch();
      } catch {
        // Refetch and let the user retry from the reopened dialog.
        await seasonsQ.refetch();
      }
    }
    setCompleteOpen(true);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <PageHead title="Pruning Tracker" description="Track pruning progress across the vineyard." path="/tools/pruning-tracker" />

      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Scissors className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pruning Tracker</h1>
          <p className="text-sm text-muted-foreground">
            {vineyard?.vineyard_name ? `${vineyard.vineyard_name} · Season ${vintage}` : "No vineyard selected"}
          </p>
        </div>
      </div>

      {!selectedVineyardId && (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Select a vineyard to view pruning progress.</CardContent></Card>
      )}

      {selectedVineyardId && !selected && (
        <>
          {/* Vineyard Progress — SQL 115 RPC is the sole source of truth. */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Vineyard Progress</CardTitle>
              <CardDescription>Season {vintage}{vintageLoading ? " · loading…" : ""}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {summaryQ.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>Couldn't load vineyard summary</AlertTitle>
                  <AlertDescription>
                    {(summaryQ.error as any)?.message ?? "The pruning summary service is unavailable."}
                    {" "}Figures are intentionally not calculated locally to keep parity with iOS and Android.
                  </AlertDescription>
                </Alert>
              ) : summaryQ.isLoading || !summary ? (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-2 w-full" />
                  <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <div className="flex items-baseline justify-between mb-1">
                      <div className="text-3xl font-semibold tabular-nums">{Math.round(summary.overall_progress * 100)}%</div>
                      <div className="text-sm text-muted-foreground tabular-nums">
                        {summary.vines_pruned.toLocaleString()} of {summary.total_vines.toLocaleString()} vines
                      </div>
                    </div>
                    <Progress value={summary.overall_progress * 100} className="h-2" />
                  </div>
                  <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 text-sm">
                    <Metric label="Vines pruned" value={summary.vines_pruned.toLocaleString()} />
                    <Metric label="Vines remaining" value={summary.vines_remaining.toLocaleString()} />
                    <Metric label="Vines / day" value={summary.vines_per_day ? Math.round(summary.vines_per_day).toLocaleString() : "—"} />
                    <Metric label="Vines / labour hr" value={summary.vines_per_labour_hour ? Math.round(summary.vines_per_labour_hour).toLocaleString() : "—"} />
                    <Metric label="Blocks complete" value={`${summary.blocks_complete} / ${summary.blocks_total || blocks.length}`} />
                    <Metric label="Blocks at risk" value={String(summary.blocks_at_risk)} />
                  </div>
                  {summary.projected_completion_date && (
                    <div className="text-xs text-muted-foreground">
                      Projected completion: <span className="tabular-nums">{formatDate(summary.projected_completion_date)}</span>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {isSystemAdmin && (
            <PruningDiagnosticsPanel
              summary={summary}
              summaryError={(summaryQ.error as any)?.message ?? null}
              selectedVineyardId={selectedVineyardId}
              selectedVineyardName={vineyard?.vineyard_name ?? null}
              seasonYear={vintage}
              authenticatedUserId={user?.id ?? null}
              membershipOk={membershipCheckQ.data ?? null}
              membershipError={(membershipCheckQ.error as any)?.message ?? null}
              grunerPaddock={grunerPaddock}
              grunerDirect={grunerDirectQ.data ?? null}
              grunerDirectError={(grunerDirectQ.error as any)?.message ?? null}
            />
          )}


          {/* Blocks */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Blocks</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Sort by</span>
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                  <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Block name</SelectItem>
                    <SelectItem value="row">Row number</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {summaryQ.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Couldn't load block summaries</AlertTitle>
                <AlertDescription>
                  {(summaryQ.error as any)?.message ?? "The pruning summary service is unavailable."}
                  {" "}Block cards are not calculated locally because SQL 115 is the shared source of truth.
                </AlertDescription>
              </Alert>
            ) : paddocksQ.isLoading || summaryQ.isLoading || !summary ? (
              <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading blocks…</CardContent></Card>
            ) : sortedBlocks.length === 0 ? (
              <Card><CardContent className="p-6 text-sm text-muted-foreground">This vineyard has no active blocks.</CardContent></Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {sortedBlocks.map((b) => {
                  const rpcB = rpcBlockByPaddock.get(b.paddock.id.toLowerCase());
                  const reDone = rpcB?.completed_row_equivalents ?? 0;
                  const reTotal = rpcB?.total_row_equivalents ?? 0;
                  const pct = reTotal > 0 ? reDone / reTotal : 0;
                  const effectiveProgress: BlockProgress = {
                    ...b.progress,
                    completedSegments: reDone > 0 ? Math.max(1, b.progress.completedSegments) : 0,
                    rowEquivalentsCompleted: reDone,
                    totalRows: reTotal,
                    percentComplete: pct,
                    dueStatus: rpcStatusToDueStatus(rpcB?.status) ?? (pct >= 1 ? "complete" : b.progress.dueStatus),
                  };
                  const hasSeason = !!b.season || !!rpcB?.season_id || reDone > 0;
                  return (
                    <button
                      key={b.paddock.id}
                      onClick={() => setSelectedPaddockId(b.paddock.id)}
                      className="text-left rounded-lg border bg-card p-4 hover:bg-accent/40 transition"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="font-medium leading-tight">
                          {b.paddock.name ?? "Unnamed block"}
                          <span className="text-muted-foreground font-normal"> · {rowRangeLabel(b.identities)}</span>
                        </div>
                        <StatusBadge p={effectiveProgress} hasSeason={hasSeason} />
                      </div>
                      {b.variety && (
                        <div className="text-xs text-muted-foreground mb-3">{b.variety}</div>
                      )}
                      {!rpcB ? (
                        <div className="text-sm text-destructive">Missing SQL 115 block payload</div>
                      ) : (
                        <>
                          <div className="text-sm tabular-nums">
                            {reDone.toFixed(1)} of {reTotal} row equivalents
                            {" — "}
                            {Math.round(pct * 100)}%
                          </div>
                          <Progress value={pct * 100} className="h-1.5 mt-2" />
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {selectedVineyardId && selected && (
        summaryQ.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn't load block summary</AlertTitle>
            <AlertDescription>
              {(summaryQ.error as any)?.message ?? "The pruning summary service is unavailable."}
              {" "}This block is not calculated locally because SQL 115 is the shared source of truth.
            </AlertDescription>
          </Alert>
        ) : summaryQ.isLoading || !summary ? (
          <Card><CardContent className="p-6 space-y-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-2 w-full" /></CardContent></Card>
        ) : (
          <BlockDetail
            block={selected}
            summary={summary}
            rpcBlock={rpcBlockByPaddock.get(selected.paddock.id.toLowerCase()) ?? null}
            selectedVineyardId={selectedVineyardId}
            selectedVineyardName={vineyard?.vineyard_name ?? null}
            seasonYear={vintage}
            authenticatedUserId={user?.id ?? null}
            membershipOk={membershipCheckQ.data ?? null}
            membershipError={(membershipCheckQ.error as any)?.message ?? null}
            canonicalSeason={selectedCanonicalQ.data?.season ?? null}
            canonicalSeasonIds={selectedCanonicalQ.data?.seasonIds ?? selectedSeasonIds}
            canonicalLoading={selectedCanonicalQ.isLoading}
            canonicalError={(selectedCanonicalQ.error as any)?.message ?? null}
            entries={selectedCanonicalQ.data?.entries ?? selectedEntriesQ.data ?? []}
            segments={selectedCanonicalQ.data?.segments ?? selectedSegmentsQ.data ?? []}
            completion={selectedCanonicalQ.data?.segments ? buildRowCompletion(selected.identities, selectedCanonicalQ.data.segments as any) : selectedCompletion}
            canEdit={canEdit}
            isSystemAdmin={isSystemAdmin}
            onBack={() => setSelectedPaddockId(null)}
            onOpenSettings={openSettings}
            onOpenComplete={openComplete}
          />
        )
      )}

      {settingsOpen && selected && selectedVineyardId && (
        <SeasonDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          vineyardId={selectedVineyardId}
          paddockId={selected.paddock.id}
          paddockName={selected.paddock.name ?? "Block"}
          seasonYear={vintage}
          existing={selected.season}
          hasConfiguredRows={parseRows(selected.paddock.rows).length > 0}
          isSystemAdmin={isSystemAdmin}
        />
      )}

      {completeOpen && selected && selected.season && selectedVineyardId && (
        <CompleteTodayDialog
          open={completeOpen}
          onOpenChange={setCompleteOpen}
          season={selected.season}
          vineyardId={selectedVineyardId}
          paddockId={selected.paddock.id}
          paddockName={selected.paddock.name ?? "Block"}
          rows={selectedCompletion}
        />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

interface DetailProps {
  block: BlockView;
  summary: PruningVineyardSummary;
  rpcBlock: PruningVineyardSummaryBlock | null;
  selectedVineyardId: string;
  selectedVineyardName: string | null;
  seasonYear: number;
  authenticatedUserId: string | null;
  membershipOk: boolean | null;
  membershipError: string | null;
  canonicalSeason: PruningSeason | null;
  canonicalSeasonIds: string[];
  canonicalLoading: boolean;
  canonicalError: string | null;
  entries: any[];
  segments: any[];
  completion: RowCompletionState[];
  canEdit: boolean;
  isSystemAdmin: boolean;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenComplete: () => void;
}

function BlockDetail({
  block,
  summary,
  rpcBlock,
  selectedVineyardId,
  selectedVineyardName,
  seasonYear,
  authenticatedUserId,
  membershipOk,
  membershipError,
  canonicalSeason,
  canonicalSeasonIds,
  canonicalLoading,
  canonicalError,
  entries,
  segments,
  completion,
  canEdit,
  isSystemAdmin,
  onBack,
  onOpenSettings,
  onOpenComplete,
}: DetailProps) {
  const local = block.progress;
  const reDone = rpcBlock?.completed_row_equivalents ?? 0;
  const reTotal = rpcBlock?.total_row_equivalents ?? 0;
  const pct = reTotal > 0 ? reDone / reTotal : 0;
  const vinesDone = rpcBlock?.vines_pruned ?? 0;
  const vinesTotal = rpcBlock?.total_vines ?? 0;
  const effectiveProgress: BlockProgress = {
    ...local,
    completedSegments: reDone > 0 ? Math.max(1, local.completedSegments) : 0,
    rowEquivalentsCompleted: reDone,
    totalRows: reTotal,
    percentComplete: pct,
    estimatedVinesCompleted: vinesDone,
    estimatedVinesTotal: vinesTotal,
    dueStatus: rpcStatusToDueStatus(rpcBlock?.status) ?? (pct >= 1 ? "complete" : reDone > 0 ? "on_track" : "no_due"),
  };
  const hasWork = reDone > 0;
  // Shared contract: vines/day = block.vinesDone / distinctEntryDays.
  const distinctDays = new Set<string>(entries.map((e) => e.entry_date).filter(Boolean));
  const vinesPerDay = distinctDays.size > 0 ? vinesDone / distinctDays.size : null;
  const labourHours = entries.reduce((s, e) => s + (Number(e.labour_hours) || 0), 0);
  const vinesPerHour = labourHours > 0 ? vinesDone / labourHours : null;
  const hasSeason = !!canonicalSeason || !!block.season || !!rpcBlock?.season_id || reDone > 0;
  const activitySeasonId = canonicalSeason?.id ?? block.season?.id ?? rpcBlock?.season_id ?? null;
  

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> All blocks
        </Button>
        <div className="flex gap-2">
          {canEdit && (
            <>
              <Button variant="outline" size="sm" onClick={onOpenSettings}>
                <Settings2 className="h-4 w-4 mr-1" /> Settings
              </Button>
              <Button size="sm" onClick={onOpenComplete} disabled={block.identities.length === 0}>
                Record Pruning
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-lg">{block.paddock.name ?? "Block"}</CardTitle>
              <CardDescription>
                {rowRangeLabel(block.identities)}
                {block.variety ? ` · ${block.variety}` : ""}
                {` · Season ${seasonYear}`}
              </CardDescription>
            </div>
            <StatusBadge p={effectiveProgress} hasSeason={hasSeason} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-3xl font-semibold tabular-nums">{Math.round(pct * 100)}%</div>
              <div className="text-sm text-muted-foreground tabular-nums">
                {reDone.toFixed(2)} / {reTotal} row equivalents
              </div>
            </div>
            <Progress value={pct * 100} className="h-2" />
            <div className="text-xs text-muted-foreground mt-1 tabular-nums">
              {Math.round(vinesDone).toLocaleString()} of {Math.round(vinesTotal).toLocaleString()} vines
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Daily Rate</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasWork ? (
            <p className="text-sm text-muted-foreground">
              Record the first day of pruning to see rates and the estimated finish date.
            </p>
          ) : (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 text-sm">
              <Metric label="Vines / day" value={vinesPerDay ? Math.round(vinesPerDay).toLocaleString() : "—"} />
              <Metric label="Vines / labour hr" value={vinesPerHour ? Math.round(vinesPerHour).toLocaleString() : "—"} />
              <Metric label="Estimated completion" value={rpcBlock?.estimated_completion_date ? formatDate(rpcBlock.estimated_completion_date) : (local.estimatedCompletionDate ? formatDate(local.estimatedCompletionDate) : "—")} />
              <Metric label="Due date" value={(canonicalSeason ?? block.season)?.due_date ? formatDate((canonicalSeason ?? block.season)!.due_date!) : "—"} />
            </div>
          )}
        </CardContent>
      </Card>

      {isSystemAdmin && (
        <PruningDiagnosticsPanel
          summary={summary}
          summaryError={null}
          selectedVineyardId={selectedVineyardId}
          selectedVineyardName={selectedVineyardName}
          seasonYear={seasonYear}
          authenticatedUserId={authenticatedUserId}
          membershipOk={membershipOk}
          membershipError={membershipError}
          grunerPaddock={searchName(block.paddock.name).includes("gruner veltliner") ? block.paddock : null}
          grunerDirect={searchName(block.paddock.name).includes("gruner veltliner") ? {
            seasons: canonicalSeason ? [canonicalSeason] : [],
            entries,
            segments,
            seasonIds: canonicalSeasonIds,
          } : null}
          grunerDirectError={canonicalError}
          selectedBlock={block}
          selectedRpcBlock={rpcBlock}
          canonicalLoading={canonicalLoading}
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rows</CardTitle>
          <CardDescription>Green quarters are done. Use <b>Record Pruning</b> to log work.</CardDescription>
        </CardHeader>
        <CardContent>
          {completion.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This block has no configured rows.{" "}
              {canEdit && "Add a manual row count in Settings, or configure row geometry in Setup → Paddocks."}
            </p>
          ) : (
            <div className="grid gap-1.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {[...completion].sort((a, b) => {
                const an = Number(a.identity.rowNumber);
                const bn = Number(b.identity.rowNumber);
                const aF = Number.isFinite(an), bF = Number.isFinite(bn);
                if (aF && bF && an !== bn) return an - bn;
                if (aF && !bF) return -1;
                if (!aF && bF) return 1;
                return String(a.identity.rowLabel).localeCompare(String(b.identity.rowLabel), undefined, { numeric: true });
              }).map((r) => (
                <div key={r.identity.paddockRowId ?? r.identity.rowNumber} className="flex items-center gap-2 rounded border p-2">
                  <div className="w-10 text-sm font-medium tabular-nums text-muted-foreground">
                    {r.identity.rowLabel}
                  </div>
                  <div className="flex gap-1 flex-1">
                    {[1, 2, 3, 4].map((q) => {
                      const done = r.completed.has(q);
                      return (
                        <div
                          key={q}
                          className={`h-6 flex-1 rounded ${done ? "bg-emerald-500" : "bg-muted"}`}
                          title={`Q${q}${done ? " · done" : ""}`}
                        />
                      );
                    })}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                    {r.completed.size}/4
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {activitySeasonId && (
        <ActivityHistory seasonId={activitySeasonId} entries={entries} canReverse={canEdit} />
      )}
    </div>
  );
}

function DiagnosticValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="break-all font-mono text-xs">{value ?? "—"}</div>
    </div>
  );
}

function PruningDiagnosticsPanel({
  summary,
  summaryError,
  selectedVineyardId,
  selectedVineyardName,
  seasonYear,
  authenticatedUserId,
  membershipOk,
  membershipError,
  grunerPaddock,
  grunerDirect,
  grunerDirectError,
  selectedBlock,
  selectedRpcBlock,
  canonicalLoading,
}: {
  summary: PruningVineyardSummary | null;
  summaryError: string | null;
  selectedVineyardId: string;
  selectedVineyardName: string | null;
  seasonYear: number;
  authenticatedUserId: string | null;
  membershipOk: boolean | null;
  membershipError: string | null;
  grunerPaddock: Paddock | null;
  grunerDirect: { seasons: any[]; entries: any[]; segments: any[]; seasonIds: string[] } | null;
  grunerDirectError: string | null;
  selectedBlock?: BlockView;
  selectedRpcBlock?: PruningVineyardSummaryBlock | null;
  canonicalLoading?: boolean;
}) {
  const grunerRpcBlock = summary?.blocks.find((b) => b.paddock_id.toLowerCase() === grunerPaddock?.id.toLowerCase()) ?? null;
  const displayedRpcBlock = selectedRpcBlock ?? grunerRpcBlock;
  const directEntries = grunerDirect?.entries ?? [];
  const directSegments = grunerDirect?.segments ?? [];
  const completedSegments = directSegments.filter((s: any) => s?.completed === true);
  const entryRowEq = directEntries.reduce((sum: number, e: any) => sum + (Number(e.row_equivalents_completed) || 0), 0);
  const distinctSeasonIds = Array.from(new Set([
    ...(grunerDirect?.seasonIds ?? []),
    ...directEntries.map((e: any) => e.pruning_season_id).filter(Boolean),
    ...directSegments.map((s: any) => s.pruning_season_id).filter(Boolean),
  ]));
  const rawForDisplay = summary?.diagnostics?.rawData ?? null;

  return (
    <Card className="border-amber-300/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">SQL 115 diagnostic</CardTitle>
        <CardDescription>System Admin only. Temporary parity diagnostics.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {summaryError && (
          <Alert variant="destructive">
            <AlertTitle>Summary RPC error</AlertTitle>
            <AlertDescription>{summaryError}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DiagnosticValue label="Selected vineyard ID" value={selectedVineyardId} />
          <DiagnosticValue label="Selected vineyard name" value={selectedVineyardName ?? "—"} />
          <DiagnosticValue label="Shared season year" value={`${seasonYear} (${typeof seasonYear})`} />
          <DiagnosticValue label="RPC vineyard ID sent" value={summary?.diagnostics.request.vineyardId ?? selectedVineyardId} />
          <DiagnosticValue label="RPC season year sent" value={`${summary?.diagnostics.request.seasonYear ?? seasonYear} (${summary?.diagnostics.request.seasonYearType ?? typeof seasonYear})`} />
          <DiagnosticValue label="Authenticated user ID" value={authenticatedUserId ?? "—"} />
          <DiagnosticValue label="Backend client" value="iOS/mobile shared pruning client" />
          <DiagnosticValue label="Membership check" value={membershipError ? `error: ${membershipError}` : membershipOk == null ? "not checked" : membershipOk ? "true" : "false"} />
          <DiagnosticValue label="Response shape" value={summary?.diagnostics.responseKind ?? "—"} />
          <DiagnosticValue label="Block-array field" value={summary?.diagnostics.blockArrayFieldName ?? "—"} />
          <DiagnosticValue label="Blocks returned" value={summary?.diagnostics.blockCount ?? "—"} />
          <DiagnosticValue label="Top-level fields" value={summary?.diagnostics.fieldNames.join(", ") ?? "—"} />
          <DiagnosticValue label="Block fields" value={summary?.diagnostics.blockFieldNames.join(", ") ?? "—"} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DiagnosticValue label="Grüner Veltliner paddock ID" value={grunerPaddock?.id ?? "not found"} />
          <DiagnosticValue label="Matching RPC block found" value={grunerRpcBlock ? "yes" : "no"} />
          <DiagnosticValue label="RPC completed row equivalents" value={displayedRpcBlock?.completed_row_equivalents ?? "—"} />
          <DiagnosticValue label="RPC total row equivalents" value={displayedRpcBlock?.total_row_equivalents ?? "—"} />
          <DiagnosticValue label="RPC progress" value={displayedRpcBlock?.progress == null ? "—" : `${Math.round(displayedRpcBlock.progress * 100)}%`} />
          <DiagnosticValue label="RPC vines pruned" value={displayedRpcBlock?.vines_pruned ?? "—"} />
          <DiagnosticValue label="RPC status" value={displayedRpcBlock?.status ?? "—"} />
          <DiagnosticValue label="Canonical season ID" value={displayedRpcBlock?.season_id ?? grunerDirect?.seasonIds?.[0] ?? "—"} />
          <DiagnosticValue label="Direct entry count" value={directEntries.length} />
          <DiagnosticValue label="Direct segment count" value={directSegments.length} />
          <DiagnosticValue label="Completed segment count" value={completedSegments.length} />
          <DiagnosticValue label="Entry row-equivalent sum" value={entryRowEq.toFixed(2)} />
          <DiagnosticValue label="Completed RE from segments" value={(completedSegments.length / 4).toFixed(2)} />
          <DiagnosticValue label="Distinct season IDs present" value={distinctSeasonIds.length ? distinctSeasonIds.join(", ") : "—"} />
          <DiagnosticValue label="Historical split seasons" value={distinctSeasonIds.length > 1 ? "yes" : "no"} />
          {selectedBlock && <DiagnosticValue label="Selected block paddock ID" value={selectedBlock.paddock.id} />}
          {canonicalLoading && <DiagnosticValue label="Canonical detail" value="loading" />}
          {grunerDirectError && <DiagnosticValue label="Direct query error" value={grunerDirectError} />}
        </div>

        <details className="rounded border p-3">
          <summary className="cursor-pointer text-sm font-medium">Raw SQL 115 response</summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(rawForDisplay, null, 2)}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}
