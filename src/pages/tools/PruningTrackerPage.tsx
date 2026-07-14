import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { BetaAdminBanner } from "@/components/BetaAdminBanner";
import { PageHead } from "@/components/PageHead";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Scissors, Plus, Pencil, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
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
} from "@/lib/pruningCalc";
import { parseRows } from "@/lib/paddockGeometry";
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
}

function usePaddocks(vineyardId: string | null) {
  return useQuery({
    queryKey: ["pruning", "paddocks", vineyardId],
    enabled: !!vineyardId,
    queryFn: async (): Promise<Paddock[]> => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id, name, rows, polygon_points, vine_spacing, vine_count_override")
        .eq("vineyard_id", vineyardId!)
        .is("deleted_at", null)
        .order("name", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Paddock[];
    },
  });
}

function StatusBadge({ p }: { p: BlockProgress }) {
  if (p.dueStatus === "complete") return <Badge className="bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="h-3 w-3 mr-1" />Complete</Badge>;
  if (p.dueStatus === "overdue") return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Overdue</Badge>;
  if (p.dueStatus === "at_risk") return <Badge className="bg-amber-500 hover:bg-amber-500"><Clock className="h-3 w-3 mr-1" />At risk</Badge>;
  if (p.dueStatus === "on_track") return <Badge variant="secondary">On track</Badge>;
  return <Badge variant="outline">No due date</Badge>;
}

type SortKey = "name" | "progress" | "due" | "eta";
type SortDir = "asc" | "desc";

export default function PruningTrackerPage() {
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const vineyard = memberships.find((m) => m.vineyard_id === selectedVineyardId);
  const canEdit = currentRole === "owner" || currentRole === "manager";

  const seasonsQ = usePruningSeasons(selectedVineyardId);
  const paddocksQ = usePaddocks(selectedVineyardId);

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [seasonDialogOpen, setSeasonDialogOpen] = useState(false);
  const [editingSeason, setEditingSeason] = useState<PruningSeason | null>(null);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("progress");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const seasons = seasonsQ.data ?? [];
  const paddocks = paddocksQ.data ?? [];
  const paddockById = useMemo(() => new Map(paddocks.map((p) => [p.id, p])), [paddocks]);

  // Fetch all season data (entries + segments) in one hook per season would be expensive;
  // fetch for all seasons at once instead.
  const allSegmentsQ = useQuery({
    queryKey: ["pruning", "all-segments", selectedVineyardId],
    enabled: !!selectedVineyardId && seasons.length > 0,
    queryFn: async () => {
      const seasonIds = seasons.map((s) => s.id);
      const { data, error } = await supabase
        .from("pruning_row_segments")
        .select("*")
        .in("pruning_season_id", seasonIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const allEntriesQ = useQuery({
    queryKey: ["pruning", "all-entries", selectedVineyardId],
    enabled: !!selectedVineyardId && seasons.length > 0,
    queryFn: async () => {
      const seasonIds = seasons.map((s) => s.id);
      const { data, error } = await supabase
        .from("pruning_entries")
        .select("*")
        .in("pruning_season_id", seasonIds)
        .is("deleted_at", null)
        .order("entry_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const perSeason = useMemo(() => {
    const segs = allSegmentsQ.data ?? [];
    const ents = allEntriesQ.data ?? [];
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
    const rowsMap = new Map<string, { season: PruningSeason; paddock: Paddock | undefined; identities: any; completion: any; progress: BlockProgress }>();
    for (const season of seasons) {
      const paddock = paddockById.get(season.paddock_id);
      if (!paddock) continue;
      const paddockRows = parseRows(paddock.rows);
      const identities = buildRowIdentities(paddockRows, paddock, season.manual_row_count);
      const completion = buildRowCompletion(identities, (bySeg.get(season.id) ?? []) as any);
      const progress = computeBlockProgress(identities, completion, (byEnt.get(season.id) ?? []) as any, season);
      rowsMap.set(season.id, { season, paddock, identities, completion, progress });
    }
    return rowsMap;
  }, [seasons, allSegmentsQ.data, allEntriesQ.data, paddockById]);

  const summary = useMemo(() => {
    let totalRows = 0, completedRE = 0, blocks = 0, complete = 0, overdue = 0, atRisk = 0;
    for (const v of perSeason.values()) {
      blocks += 1;
      totalRows += v.progress.totalRows;
      completedRE += v.progress.rowEquivalentsCompleted;
      if (v.progress.dueStatus === "complete") complete += 1;
      else if (v.progress.dueStatus === "overdue") overdue += 1;
      else if (v.progress.dueStatus === "at_risk") atRisk += 1;
    }
    const pct = totalRows ? completedRE / totalRows : 0;
    return { totalRows, completedRE, blocks, complete, overdue, atRisk, pct };
  }, [perSeason]);

  const sortedRows = useMemo(() => {
    const arr = Array.from(perSeason.values());
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "name": return dir * ((a.paddock?.name ?? "").localeCompare(b.paddock?.name ?? ""));
        case "progress": return dir * (a.progress.percentComplete - b.progress.percentComplete);
        case "due": {
          const av = a.season.due_date ?? "9999-99-99";
          const bv = b.season.due_date ?? "9999-99-99";
          return dir * av.localeCompare(bv);
        }
        case "eta": {
          const av = a.progress.estimatedCompletionDate ?? "9999-99-99";
          const bv = b.progress.estimatedCompletionDate ?? "9999-99-99";
          return dir * av.localeCompare(bv);
        }
      }
    });
    return arr;
  }, [perSeason, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "name" ? "asc" : "desc"); }
  };

  const selected = selectedSeasonId ? perSeason.get(selectedSeasonId) : null;
  const selectedEntriesQ = usePruningEntries(selectedSeasonId);
  const selectedSegmentsQ = usePruningSegments(selectedSeasonId);
  const selectedIdentities = selected?.identities ?? [];
  const selectedCompletion = useMemo(() => {
    if (!selected) return [];
    return buildRowCompletion(selectedIdentities, (selectedSegmentsQ.data ?? []) as any);
  }, [selected, selectedIdentities, selectedSegmentsQ.data]);

  const paddocksWithoutSeason = paddocks.filter((p) => !seasons.some((s) => s.paddock_id === p.id));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHead title="Pruning Tracker" description="Track pruning progress across the vineyard." path="/tools/pruning-tracker" />
      <BetaAdminBanner />

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Scissors className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pruning Tracker</h1>
            <p className="text-sm text-muted-foreground">
              {vineyard?.vineyard_name ? `Vineyard: ${vineyard.vineyard_name}` : "No vineyard selected"}
            </p>
          </div>
        </div>
        {canEdit && (
          <Button onClick={() => { setEditingSeason(null); setSeasonDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> New season
          </Button>
        )}
      </div>

      {!selectedVineyardId && (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Select a vineyard to view pruning progress.</CardContent></Card>
      )}

      {selectedVineyardId && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Card><CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">Blocks with seasons</div>
              <div className="text-2xl font-semibold tabular-nums">{summary.blocks}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">Row equivalents</div>
              <div className="text-2xl font-semibold tabular-nums">
                {summary.completedRE.toFixed(1)} / {summary.totalRows}
              </div>
              <Progress value={summary.pct * 100} className="mt-2 h-1.5" />
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">Complete</div>
              <div className="text-2xl font-semibold tabular-nums text-emerald-600">{summary.complete}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">At risk</div>
              <div className="text-2xl font-semibold tabular-nums text-amber-600">{summary.atRisk}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">Overdue</div>
              <div className="text-2xl font-semibold tabular-nums text-destructive">{summary.overdue}</div>
            </CardContent></Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Blocks</CardTitle>
                <CardDescription>Click a row for row-quarter detail.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {seasonsQ.isLoading || paddocksQ.isLoading ? (
                  <div className="p-6 text-sm text-muted-foreground">Loading…</div>
                ) : sortedRows.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">
                    No pruning seasons yet.{" "}
                    {canEdit && paddocks.length > 0 && (
                      <button className="underline" onClick={() => { setEditingSeason(null); setSeasonDialogOpen(true); }}>
                        Create the first one
                      </button>
                    )}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead><button onClick={() => toggleSort("name")} className="hover:underline">Block</button></TableHead>
                        <TableHead className="text-right"><button onClick={() => toggleSort("progress")} className="hover:underline">Progress</button></TableHead>
                        <TableHead className="text-right hidden md:table-cell"><button onClick={() => toggleSort("due")} className="hover:underline">Due</button></TableHead>
                        <TableHead className="text-right hidden lg:table-cell"><button onClick={() => toggleSort("eta")} className="hover:underline">ETA</button></TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedRows.map(({ season, paddock, progress, identities }) => {
                        const first = identities[0]?.rowNumber;
                        const last = identities[identities.length - 1]?.rowNumber;
                        return (
                          <TableRow
                            key={season.id}
                            data-state={selectedSeasonId === season.id ? "selected" : undefined}
                            className="cursor-pointer"
                            onClick={() => setSelectedSeasonId(season.id)}
                          >
                            <TableCell>
                              <div className="font-medium">{paddock?.name ?? "—"}</div>
                              <div className="text-xs text-muted-foreground">
                                {season.season_year} · {identities.length} rows{first != null && last != null ? ` (${first}–${last})` : ""}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="tabular-nums">{(progress.percentComplete * 100).toFixed(0)}%</div>
                              <Progress value={progress.percentComplete * 100} className="h-1 mt-1" />
                            </TableCell>
                            <TableCell className="text-right hidden md:table-cell">
                              {season.due_date ? formatDate(season.due_date) : "—"}
                            </TableCell>
                            <TableCell className="text-right hidden lg:table-cell">
                              {progress.estimatedCompletionDate ? formatDate(progress.estimatedCompletionDate) : "—"}
                            </TableCell>
                            <TableCell><StatusBadge p={progress} /></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              {selected ? (
                <>
                  <Card>
                    <CardHeader className="flex-row items-start justify-between space-y-0 gap-3">
                      <div>
                        <CardTitle className="text-base">{selected.paddock?.name ?? "—"} · {selected.season.season_year}</CardTitle>
                        <CardDescription>
                          {selected.progress.completedSegments} / {selected.progress.totalSegments} quarters completed
                          · {selected.progress.rowEquivalentsCompleted.toFixed(2)} row equivalents
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        {canEdit && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => { setEditingSeason(selected.season); setSeasonDialogOpen(true); }}>
                              <Pencil className="h-4 w-4 mr-1" /> Edit
                            </Button>
                            <Button size="sm" onClick={() => setCompleteDialogOpen(true)}>
                              Complete Today
                            </Button>
                          </>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Vines completed</div>
                        <div className="tabular-nums">
                          {selected.progress.estimatedVinesCompleted.toLocaleString()} / {selected.progress.estimatedVinesTotal.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Working-day avg</div>
                        <div className="tabular-nums">
                          {selected.progress.workingDayAvgRowEquivalents != null
                            ? `${selected.progress.workingDayAvgRowEquivalents.toFixed(2)} row eq./day`
                            : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Due date</div>
                        <div>{selected.season.due_date ? formatDate(selected.season.due_date) : "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Estimated completion</div>
                        <div>{selected.progress.estimatedCompletionDate ? formatDate(selected.progress.estimatedCompletionDate) : "—"}</div>
                      </div>
                      <div className="sm:col-span-2">
                        <div className="text-xs uppercase text-muted-foreground">Crew</div>
                        <div>{selected.season.assigned_crew || "—"} · method: {selected.season.pruning_method}</div>
                      </div>
                    </CardContent>
                  </Card>

                  <ActivityHistory
                    seasonId={selected.season.id}
                    entries={selectedEntriesQ.data ?? []}
                    canReverse={canEdit}
                  />

                  {completeDialogOpen && (
                    <CompleteTodayDialog
                      open={completeDialogOpen}
                      onOpenChange={setCompleteDialogOpen}
                      season={selected.season}
                      vineyardId={selectedVineyardId!}
                      paddockId={selected.season.paddock_id}
                      paddockName={selected.paddock?.name ?? ""}
                      rows={selectedCompletion}
                    />
                  )}
                </>
              ) : (
                <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
                  Select a block to see row-quarter progress and history.
                </CardContent></Card>
              )}
            </div>
          </div>
        </>
      )}

      {seasonDialogOpen && selectedVineyardId && (
        <SeasonDialog
          open={seasonDialogOpen}
          onOpenChange={setSeasonDialogOpen}
          vineyardId={selectedVineyardId}
          paddocks={editingSeason ? paddocks : paddocksWithoutSeason.length ? paddocksWithoutSeason : paddocks}
          existing={editingSeason}
          defaultPaddockId={selected?.season.paddock_id ?? null}
        />
      )}
    </div>
  );
}
