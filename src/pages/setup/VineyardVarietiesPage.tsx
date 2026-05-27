// Manage Vineyard Varieties — vineyard-wide grape variety catalogue.
//
// Shows built-in catalogue varieties + vineyard custom varieties.
// Custom varieties are stored via the shared RPCs:
//   - list_vineyard_grape_varieties(p_vineyard_id)
//   - upsert_vineyard_grape_variety(p_vineyard_id, p_variety_key, p_display_name)
//   - archive_vineyard_grape_variety(p_id)
// Custom varieties added here are immediately available to every block in the
// vineyard and round-trip into iOS.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Archive, AlertTriangle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useVineyard } from "@/context/VineyardContext";
import { supabase } from "@/integrations/ios-supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

import {
  useVineyardGrapeVarieties,
  useGrapeVarietyCatalog,
  useUpsertVineyardGrapeVariety,
  useArchiveVineyardGrapeVariety,
  useHardDeleteCustomGrapeVariety,
  type CatalogVariety,
} from "@/lib/varietyCatalog";

interface PaddockRow {
  id: string;
  name: string | null;
  variety_allocations: any;
}

function useVineyardPaddockUsage(vineyardId: string | null | undefined) {
  return useQuery({
    queryKey: ["vineyard_variety_usage", vineyardId],
    enabled: !!vineyardId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id,name,variety_allocations")
        .eq("vineyard_id", vineyardId!)
        .is("deleted_at", null);
      if (error) {
        console.warn("[vineyard_variety_usage]", error.message);
        return [] as PaddockRow[];
      }
      return (data ?? []) as PaddockRow[];
    },
  });
}

/** Build a map: varietyKey → list of paddock names that use it. */
function buildUsageMap(paddocks: PaddockRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const p of paddocks) {
    const allocs = Array.isArray(p.variety_allocations) ? p.variety_allocations : [];
    for (const a of allocs) {
      const key = a?.varietyKey ?? a?.variety_key;
      if (!key) continue;
      const list = map.get(String(key)) ?? [];
      list.push(p.name ?? "Unnamed block");
      map.set(String(key), list);
    }
  }
  return map;
}

export default function VineyardVarietiesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { selectedVineyardId, currentRole } = useVineyard();
  const canEdit = currentRole === "owner" || currentRole === "manager";

  const vineyardList = useVineyardGrapeVarieties(selectedVineyardId);
  const catalog = useGrapeVarietyCatalog();
  const paddockUsage = useVineyardPaddockUsage(selectedVineyardId);
  const upsert = useUpsertVineyardGrapeVariety();
  const archive = useArchiveVineyardGrapeVariety();
  const hardDelete = useHardDeleteCustomGrapeVariety();

  const [newName, setNewName] = useState("");
  const [newGdd, setNewGdd] = useState("");
  const [filter, setFilter] = useState("");
  const [pendingArchive, setPendingArchive] = useState<CatalogVariety | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CatalogVariety | null>(null);

  const usageMap = useMemo(
    () => buildUsageMap(paddockUsage.data ?? []),
    [paddockUsage.data],
  );

  // Combine vineyard list (built-ins + custom) with the global catalogue.
  //  - Built-in catalogue is the source of truth for built-in `optimal_gdd`.
  //  - Vineyard row contributes `optimal_gdd_override` (and id/is_active) without
  //    clobbering the catalogue GDD.
  //  - Custom rows live only on the vineyard list; their GDD comes from override.
  //  - Archived custom rows are kept in the list (faded) but never replace an
  //    active built-in with the same key.
  const combined = useMemo<CatalogVariety[]>(() => {
    const byKey = new Map<string, CatalogVariety>();
    for (const v of catalog.data ?? []) {
      byKey.set(v.variety_key, { ...v, is_custom: false });
    }
    for (const v of vineyardList.data ?? []) {
      const isCustom = v.is_custom === true || v.variety_key.startsWith("custom:");
      if (isCustom) {
        // Custom: take the row as-is. Effective GDD = override (already in optimal_gdd).
        byKey.set(v.variety_key, v);
      } else {
        const base = byKey.get(v.variety_key);
        const catalogueGdd = base?.optimal_gdd ?? null;
        const override = v.optimal_gdd_override ?? null;
        const merged: CatalogVariety = {
          ...(base ?? {}),
          ...v,
          is_custom: false,
          // Preserve catalogue GDD; apply override on top if present.
          optimal_gdd: override != null ? override : catalogueGdd,
          optimal_gdd_override: override,
        };
        byKey.set(v.variety_key, merged);
      }
    }
    const list = Array.from(byKey.values());
    list.sort((a, b) => a.display_name.localeCompare(b.display_name));
    return list;
  }, [catalog.data, vineyardList.data]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return combined;
    return combined.filter((v) => v.display_name.toLowerCase().includes(q));
  }, [combined, filter]);

  const handleAddCustom = async () => {
    const name = newName.trim();
    if (!name || !selectedVineyardId) return;
    const gddNum = newGdd.trim() === "" ? null : Number(newGdd);
    if (gddNum !== null && (!Number.isFinite(gddNum) || gddNum <= 0)) {
      toast({
        title: "Invalid GDD value",
        description: "Optimal GDD must be a positive number.",
        variant: "destructive",
      });
      return;
    }
    try {
      const row = await upsert.mutateAsync({
        vineyardId: selectedVineyardId,
        varietyKey: null,
        displayName: name,
        optimalGddOverride: gddNum,
      });
      if (!row) throw new Error("No row returned");
      toast({ title: "Custom variety added", description: row.display_name });
      setNewName("");
      setNewGdd("");
    } catch (err: any) {
      toast({
        title: "Could not add variety",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ["vineyard_grape_varieties", selectedVineyardId] });
    qc.invalidateQueries({ queryKey: ["grape_variety_catalog"] });
    qc.invalidateQueries({ queryKey: ["vineyard_variety_usage", selectedVineyardId] });
  };


  const confirmArchive = async () => {
    if (!pendingArchive?.id) return;
    try {
      await archive.mutateAsync(pendingArchive.id);
      toast({
        title: "Variety archived",
        description: `${pendingArchive.display_name} hidden from pickers.`,
      });
      setPendingArchive(null);
    } catch (err: any) {
      toast({
        title: "Archive failed",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  const confirmHardDelete = async () => {
    if (!pendingDelete?.id) return;
    try {
      const result = await hardDelete.mutateAsync(pendingDelete.id);
      if (result.success || result.status === "hard_deleted") {
        toast({
          title: "Variety deleted",
          description: `${pendingDelete.display_name} permanently removed.`,
        });
        setPendingDelete(null);
        return;
      }
      const friendly: Record<string, string> = {
        variety_in_use:
          "This custom variety is used by existing records and cannot be deleted. Archive it instead.",
        system_variety: "Built-in varieties cannot be deleted.",
        not_custom: "Only custom varieties can be permanently deleted.",
        not_found: "This variety no longer exists.",
        not_authorised: "Only owners and managers can delete custom varieties.",
        delete_failed: "Delete failed. Please try again.",
        failed: "Delete failed. Please try again.",
      };
      toast({
        title: "Cannot delete variety",
        description: friendly[result.status] ?? result.message ?? "Delete failed.",
        variant: "destructive",
      });
    } catch (err: any) {
      toast({
        title: "Delete failed",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  if (!selectedVineyardId) {
    return (
      <Alert>
        <AlertTitle>No vineyard selected</AlertTitle>
        <AlertDescription>Select a vineyard to manage its grape varieties.</AlertDescription>
      </Alert>
    );
  }

  const loading = vineyardList.isLoading || catalog.isLoading || paddockUsage.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/setup/paddocks")} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Paddocks
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Vineyard grape varieties</h1>
      </div>

      <Alert>
        <AlertDescription>
          Custom varieties added here are vineyard-wide and immediately available to every block.
          They also sync to iOS under the vineyard's grape variety settings.
        </AlertDescription>
      </Alert>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add custom variety</CardTitle>
            <CardDescription>
              Use this when a variety isn't in the built-in catalogue. It becomes
              available across all blocks in this vineyard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[220px] space-y-1">
                <Label htmlFor="newVariety">Variety name</Label>
                <Input
                  id="newVariety"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Aglianico"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustom();
                    }
                  }}
                />
              </div>
              <div className="w-[200px] space-y-1">
                <Label htmlFor="newGdd">Optimal GDD (ripeness target)</Label>
                <Input
                  id="newGdd"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={10}
                  value={newGdd}
                  onChange={(e) => setNewGdd(e.target.value)}
                  placeholder="e.g. 1400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustom();
                    }
                  }}
                />
              </div>
              <Button
                onClick={handleAddCustom}
                disabled={!newName.trim() || upsert.isPending}
                className="gap-1"
              >
                {upsert.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add variety
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Optimal GDD is optional. Leave blank to use the catalogue default.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">All varieties</CardTitle>
            <CardDescription>
              Built-in catalogue plus this vineyard's custom varieties.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-[220px]"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={vineyardList.isFetching}
              className="gap-1"
              title="Refresh from server (pulls latest custom varieties from iOS)"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${vineyardList.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center gap-2 px-6 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading varieties…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variety</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Optimal GDD</TableHead>
                  <TableHead>Used by blocks</TableHead>
                  {canEdit && <TableHead className="w-[200px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((v) => {
                  const usage = usageMap.get(v.variety_key) ?? [];
                  const isCustom = v.is_custom === true || v.variety_key.startsWith("custom:");
                  const isArchived = !!v.archived_at || v.is_active === false;
                  const gdd = v.optimal_gdd;
                  const hasOverride = v.optimal_gdd_override != null;
                  return (
                    <TableRow key={v.variety_key} className={isArchived ? "opacity-60" : ""}>
                      <TableCell className="font-medium">
                        {v.display_name}
                        {isArchived && (
                          <Badge variant="outline" className="ml-2">archived</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {isCustom ? (
                          <Badge variant="secondary">Custom</Badge>
                        ) : (
                          <Badge variant="outline">Built-in</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {gdd != null ? (
                          <span>
                            {gdd} GDD
                            {hasOverride && !isCustom && (
                              <Badge variant="outline" className="ml-2 text-[10px]">override</Badge>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {usage.length === 0 ? (
                          "—"
                        ) : (
                          <span title={usage.join(", ")}>
                            {usage.length} {usage.length === 1 ? "block" : "blocks"}
                          </span>
                        )}
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {isCustom && !isArchived && v.id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-muted-foreground hover:text-foreground"
                                onClick={() => setPendingArchive(v)}
                              >
                                <Archive className="h-3.5 w-3.5" /> Archive
                              </Button>
                            )}
                            {isCustom && v.id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-muted-foreground hover:text-destructive"
                                onClick={() => setPendingDelete(v)}
                                title="Permanently delete this custom variety (only if unused)"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 5 : 4} className="text-center text-sm text-muted-foreground py-8">
                      No varieties match your filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!pendingArchive}
        onOpenChange={(o) => { if (!o) setPendingArchive(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {pendingArchive && (usageMap.get(pendingArchive.variety_key)?.length ?? 0) > 0 && (
                <AlertTriangle className="h-4 w-4 text-warning" />
              )}
              Archive “{pendingArchive?.display_name}”?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Archiving hides this variety from pickers. Existing block allocations
                  keep their saved name snapshot and will still display correctly.
                </p>
                {pendingArchive &&
                  (usageMap.get(pendingArchive.variety_key)?.length ?? 0) > 0 && (
                    <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                      <strong className="font-medium">
                        This variety is currently used by{" "}
                        {usageMap.get(pendingArchive.variety_key)!.length}{" "}
                        block{usageMap.get(pendingArchive.variety_key)!.length === 1 ? "" : "s"}:
                      </strong>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {usageMap.get(pendingArchive.variety_key)!.slice(0, 8).join(", ")}
                        {usageMap.get(pendingArchive.variety_key)!.length > 8 && "…"}
                      </div>
                    </div>
                  )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchive} disabled={archive.isPending}>
              {archive.isPending ? "Archiving…" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
