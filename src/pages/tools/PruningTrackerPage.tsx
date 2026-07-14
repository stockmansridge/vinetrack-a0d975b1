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
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { BetaAdminBanner } from "@/components/BetaAdminBanner";
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
  type PruningSeason,
} from "@/lib/pruningQuery";
import {
  buildRowIdentities,
  buildRowCompletion,
  computeBlockProgress,
  type BlockProgress,
  type RowIdentity,
  type RowCompletionState,
} from "@/lib/pruningCalc";
import { parseRows, parseVarietyAllocations } from "@/lib/paddockGeometry";
import { formatDate } from "@/lib/dateFormat";
import SeasonDialog from "@/components/pruning/SeasonDialog";
import CompleteTodayDialog from "@/components/pruning/CompleteTodayDialog";
import ActivityHistory from "@/components/pruning/ActivityHistory";

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

  const seasons = seasonsQ.data ?? [];
  const paddocks = paddocksQ.data ?? [];

  // Season for current vintage, keyed by paddock
  const currentSeasonByPaddock = useMemo(() => {
    const m = new Map<string, PruningSeason>();
    for (const s of seasons) if (s.season_year === vintage) m.set(s.paddock_id, s);
    return m;
  }, [seasons, vintage]);

  const currentSeasonIds = useMemo(
    () => Array.from(currentSeasonByPaddock.values()).map((s) => s.id),
    [currentSeasonByPaddock],
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

  const blocks: BlockView[] = useMemo(() => {
    const segs = segmentsQ.data ?? [];
    const ents = entriesQ.data ?? [];
    const bySeg = new Map<string, any[]>();
    const byEnt = new Map<string, any[]>();
    for (const s of segs) {
      const list = bySeg.get(s.pruning_season_id) ?? [];
      list.push(s);
      bySeg.set(s.pruning_season_id, list);
    }
    for (const e of ents) {
      const list = byEnt.get(e.pruning_season_id) ?? [];
      list.push(e);
      byEnt.set(e.pruning_season_id, list);
    }
    return paddocks.map((paddock) => {
      const season = currentSeasonByPaddock.get(paddock.id) ?? null;
      const paddockRows = parseRows(paddock.rows);
      const identities = buildRowIdentities(paddockRows, paddock, season?.manual_row_count ?? null);
      const completion = buildRowCompletion(identities, season ? (bySeg.get(season.id) ?? []) as any : []);
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
        season ? (byEnt.get(season.id) ?? []) as any : [],
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
  }, [paddocks, currentSeasonByPaddock, segmentsQ.data, entriesQ.data, selectedVineyardId, vintage]);

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

  const summary = useMemo(() => {
    let vinesTotal = 0, vinesDone = 0, reTotal = 0, reDone = 0;
    let complete = 0, atRisk = 0;
    let vinesPerDaySum = 0, vinesPerHourSum = 0, avgCount = 0;
    let latestEta: string | null = null;
    let labourHoursTotal = 0;
    for (const b of blocks) {
      vinesTotal += b.progress.estimatedVinesTotal;
      vinesDone += b.progress.estimatedVinesCompleted;
      reTotal += b.progress.totalRows;
      reDone += b.progress.rowEquivalentsCompleted;
      if (b.progress.dueStatus === "complete") complete += 1;
      else if (b.progress.dueStatus === "at_risk" || b.progress.dueStatus === "overdue") atRisk += 1;
      if (b.progress.workingDayAvgRowEquivalents && b.identities.length) {
        const vinesPerRow = b.identities.length ? b.progress.estimatedVinesTotal / b.identities.length : 0;
        vinesPerDaySum += b.progress.workingDayAvgRowEquivalents * vinesPerRow;
        avgCount += 1;
      }
      if (b.progress.estimatedCompletionDate) {
        if (!latestEta || b.progress.estimatedCompletionDate > latestEta) latestEta = b.progress.estimatedCompletionDate;
      }
    }
    // Labour hours + vines/hour from entries
    for (const e of (entriesQ.data ?? [])) {
      const lh = Number((e as any).labour_hours) || 0;
      labourHoursTotal += lh;
    }
    const vinesPerHour = labourHoursTotal > 0 ? vinesDone / labourHoursTotal : 0;
    void vinesPerHourSum;
    const vinesPerDay = avgCount ? vinesPerDaySum / avgCount : 0;
    const pct = vinesTotal ? vinesDone / vinesTotal : (reTotal ? reDone / reTotal : 0);
    return {
      pct, vinesTotal, vinesDone,
      vinesRemaining: Math.max(0, vinesTotal - vinesDone),
      vinesPerDay, vinesPerHour,
      complete, atRisk, latestEta,
      blocksCount: blocks.length,
    };
  }, [blocks, entriesQ.data]);

  const selected = selectedPaddockId ? blocks.find((b) => b.paddock.id === selectedPaddockId) ?? null : null;
  const selectedEntriesQ = usePruningEntries(selected?.season?.id ?? null);
  const selectedSegmentsQ = usePruningSegments(selected?.season?.id ?? null);
  const selectedCompletion = useMemo(() => {
    if (!selected) return [];
    return buildRowCompletion(selected.identities, (selectedSegmentsQ.data ?? []) as any);
  }, [selected, selectedSegmentsQ.data]);

  const openSettings = () => setSettingsOpen(true);

  // Ensure a season row exists for the selected block before opening Complete Today.
  const openComplete = async () => {
    if (!selected || !selectedVineyardId) return;
    if (!selected.season) {
      try {
        const id = crypto.randomUUID();
        const { error } = await supabase.from("pruning_seasons").insert({
          id,
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
        if (error) throw error;
        await seasonsQ.refetch();
      } catch (e: any) {
        // If a race created it already, refetching will pick it up.
        await seasonsQ.refetch();
      }
    }
    setCompleteOpen(true);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <PageHead title="Pruning Tracker" description="Track pruning progress across the vineyard." path="/tools/pruning-tracker" />
      <BetaAdminBanner />

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
          {/* Vineyard Progress */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Vineyard Progress</CardTitle>
              <CardDescription>Season {vintage}{vintageLoading ? " · loading…" : ""}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="text-3xl font-semibold tabular-nums">{Math.round(summary.pct * 100)}%</div>
                  <div className="text-sm text-muted-foreground tabular-nums">
                    {summary.vinesDone.toLocaleString()} of {summary.vinesTotal.toLocaleString()} vines
                  </div>
                </div>
                <Progress value={summary.pct * 100} className="h-2" />
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 text-sm">
                <Metric label="Vines pruned" value={summary.vinesDone.toLocaleString()} />
                <Metric label="Vines remaining" value={summary.vinesRemaining.toLocaleString()} />
                <Metric label="Vines / day" value={summary.vinesPerDay ? Math.round(summary.vinesPerDay).toLocaleString() : "—"} />
                <Metric label="Vines / labour hr" value={summary.vinesPerHour ? Math.round(summary.vinesPerHour).toLocaleString() : "—"} />
                <Metric label="Blocks complete" value={`${summary.complete} / ${summary.blocksCount}`} />
                <Metric label="Blocks at risk" value={String(summary.atRisk)} />
              </div>
              {summary.latestEta && (
                <div className="text-xs text-muted-foreground">
                  Projected completion: <span className="tabular-nums">{formatDate(summary.latestEta)}</span>
                </div>
              )}
            </CardContent>
          </Card>

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

            {paddocksQ.isLoading ? (
              <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading blocks…</CardContent></Card>
            ) : sortedBlocks.length === 0 ? (
              <Card><CardContent className="p-6 text-sm text-muted-foreground">This vineyard has no active blocks.</CardContent></Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {sortedBlocks.map((b) => (
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
                      <StatusBadge p={b.progress} hasSeason={!!b.season} />
                    </div>
                    {b.variety && (
                      <div className="text-xs text-muted-foreground mb-3">{b.variety}</div>
                    )}
                    <div className="text-sm tabular-nums">
                      {b.progress.rowEquivalentsCompleted.toFixed(1)} of {b.progress.totalRows} row equivalents
                      {" — "}
                      {Math.round(b.progress.percentComplete * 100)}%
                    </div>
                    <Progress value={b.progress.percentComplete * 100} className="h-1.5 mt-2" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {selectedVineyardId && selected && (
        <BlockDetail
          block={selected}
          entries={selectedEntriesQ.data ?? []}
          completion={selectedCompletion}
          canEdit={canEdit}
          onBack={() => setSelectedPaddockId(null)}
          onOpenSettings={openSettings}
          onOpenComplete={openComplete}
        />
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
  entries: any[];
  completion: RowCompletionState[];
  canEdit: boolean;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenComplete: () => void;
}

function BlockDetail({ block, entries, completion, canEdit, onBack, onOpenSettings, onOpenComplete }: DetailProps) {
  const p = block.progress;
  const hasWork = p.completedSegments > 0;
  const rate = p.workingDayAvgRowEquivalents;
  const vinesPerRow = block.identities.length ? p.estimatedVinesTotal / block.identities.length : 0;
  const vinesPerDay = rate ? rate * vinesPerRow : null;
  const labourHours = entries.reduce((s, e) => s + (Number(e.labour_hours) || 0), 0);
  const vinesPerHour = labourHours > 0 ? p.estimatedVinesCompleted / labourHours : null;

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
                Complete Today
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
                {block.season?.season_year ? ` · Season ${block.season.season_year}` : ""}
              </CardDescription>
            </div>
            <StatusBadge p={p} hasSeason={!!block.season} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-3xl font-semibold tabular-nums">{Math.round(p.percentComplete * 100)}%</div>
              <div className="text-sm text-muted-foreground tabular-nums">
                {p.rowEquivalentsCompleted.toFixed(2)} / {p.totalRows} row equivalents
              </div>
            </div>
            <Progress value={p.percentComplete * 100} className="h-2" />
            <div className="text-xs text-muted-foreground mt-1 tabular-nums">
              {p.estimatedVinesCompleted.toLocaleString()} of {p.estimatedVinesTotal.toLocaleString()} vines
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
              <Metric label="Estimated completion" value={p.estimatedCompletionDate ? formatDate(p.estimatedCompletionDate) : "—"} />
              <Metric label="Due date" value={block.season?.due_date ? formatDate(block.season.due_date) : "—"} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rows</CardTitle>
          <CardDescription>Green quarters are done. Use Complete Today to record work.</CardDescription>
        </CardHeader>
        <CardContent>
          {completion.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This block has no configured rows.{" "}
              {canEdit && "Add a manual row count in Settings, or configure row geometry in Setup → Paddocks."}
            </p>
          ) : (
            <div className="grid gap-1.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {completion.map((r) => (
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

      {block.season && (
        <ActivityHistory seasonId={block.season.id} entries={entries} canReverse={canEdit} />
      )}
    </div>
  );
}
