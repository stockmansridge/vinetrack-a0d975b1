// Clones & Rootstocks catalogue browsers for the Grape Varieties setup page.
//
// Read/write via the shared sql/182 RPCs only — the same records iOS/Android
// see. Built-ins are read-only; owner/manager can add and archive vineyard
// custom records. Sentinels (Mass selection / Own roots) are allocation-level
// values and never appear here.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, Loader2, Plus } from "lucide-react";

import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
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
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

import {
  useArchiveVineyardClone,
  useArchiveVineyardRootstock,
  useCloneCatalog,
  useRootstockCatalog,
  useUpsertVineyardClone,
  useUpsertVineyardRootstock,
  useVineyardClones,
  useVineyardRootstocks,
  type CatalogClone,
  type CatalogRootstock,
} from "@/lib/cloneRootstockCatalog";
import {
  browseClones,
  browseRootstocks,
  canManageCatalogue,
  cloneUsage,
  collectCloneRefs,
  collectRootstockRefs,
  rootstockUsage,
  type UsagePaddock,
} from "@/lib/cloneRootstockUsage";
import { useGrapeVarietyCatalog, useVineyardGrapeVarieties } from "@/lib/varietyCatalog";

function useCatalogueUsagePaddocks(vineyardId: string | null | undefined) {
  return useQuery({
    queryKey: ["vineyard_variety_usage", vineyardId],
    enabled: !!vineyardId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<UsagePaddock[]> => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id,name,variety_allocations")
        .eq("vineyard_id", vineyardId!)
        .is("deleted_at", null);
      if (error) {
        console.warn("[catalogue_usage]", error.message);
        return [];
      }
      return (data ?? []) as UsagePaddock[];
    },
  });
}

function TypeBadge({ custom }: { custom: boolean }) {
  return custom ? (
    <Badge variant="secondary">Custom</Badge>
  ) : (
    <Badge variant="outline">Built-in</Badge>
  );
}

function UsageCell({ blocks, legacy }: { blocks: string[]; legacy: boolean }) {
  if (blocks.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span title={blocks.join(", ")}>
      {blocks.length} {blocks.length === 1 ? "block" : "blocks"}
      {legacy && (
        <Badge variant="outline" className="ml-2 text-[10px]">
          text match
        </Badge>
      )}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value ?? <span className="text-muted-foreground">—</span>}</span>
    </div>
  );
}

/* ------------------------------- Clones ------------------------------- */

export function ClonesTab() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canEdit = canManageCatalogue(currentRole);

  const builtIns = useCloneCatalog();
  const customs = useVineyardClones(selectedVineyardId);
  const usageQuery = useCatalogueUsagePaddocks(selectedVineyardId);
  const catalogVarieties = useGrapeVarietyCatalog();
  const vineyardVarieties = useVineyardGrapeVarieties(selectedVineyardId);
  const upsert = useUpsertVineyardClone();
  const archive = useArchiveVineyardClone();

  const [query, setQuery] = useState("");
  const [varietyFilter, setVarietyFilter] = useState<string>("all");
  const [newName, setNewName] = useState("");
  const [newVariety, setNewVariety] = useState<string>("");
  const [detail, setDetail] = useState<CatalogClone | null>(null);
  const [pendingArchive, setPendingArchive] = useState<CatalogClone | null>(null);

  const varietyNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of catalogVarieties.data ?? []) map.set(v.variety_key, v.display_name);
    for (const v of vineyardVarieties.data ?? []) map.set(v.variety_key, v.display_name);
    return map;
  }, [catalogVarieties.data, vineyardVarieties.data]);

  const rows = useMemo(
    () =>
      browseClones(builtIns.data ?? [], customs.data ?? [], {
        query,
        varietyKey: varietyFilter === "all" ? null : varietyFilter,
      }),
    [builtIns.data, customs.data, query, varietyFilter],
  );

  const refs = useMemo(() => collectCloneRefs(usageQuery.data ?? []), [usageQuery.data]);

  const varietyOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const c of [...(builtIns.data ?? []), ...(customs.data ?? [])]) keys.add(c.variety_key);
    return Array.from(keys)
      .map((k) => ({ key: k, name: varietyNames.get(k) ?? k }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [builtIns.data, customs.data, varietyNames]);

  const addableVarieties = useMemo(() => {
    const rowsV = [
      ...(catalogVarieties.data ?? []),
      ...(vineyardVarieties.data ?? []).filter((v) => v.is_active !== false && !v.archived_at),
    ];
    const map = new Map<string, string>();
    for (const v of rowsV) map.set(v.variety_key, v.display_name);
    return Array.from(map, ([key, name]) => ({ key, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [catalogVarieties.data, vineyardVarieties.data]);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name || !newVariety || !selectedVineyardId) return;
    try {
      const row = await upsert.mutateAsync({
        vineyardId: selectedVineyardId,
        varietyKey: newVariety,
        displayName: name,
      });
      toast({ title: "Custom clone added", description: row?.display_name ?? name });
      setNewName("");
    } catch (err: any) {
      toast({
        title: "Could not add clone",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  const confirmArchive = async () => {
    if (!pendingArchive?.id) return;
    try {
      await archive.mutateAsync(pendingArchive.id);
      toast({ title: "Clone archived", description: pendingArchive.display_name });
      setPendingArchive(null);
      setDetail(null);
    } catch (err: any) {
      toast({
        title: "Archive failed",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  const loading = builtIns.isLoading || customs.isLoading;
  const detailUsage = detail ? cloneUsage(refs, detail) : null;

  return (
    <div className="space-y-6">
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add custom clone</CardTitle>
            <CardDescription>
              Clones belong to one grape variety. Custom clones are vineyard-wide and sync
              to the mobile apps.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-[240px] space-y-1">
                <label className="text-sm font-medium">Grape variety</label>
                <Select value={newVariety} onValueChange={setNewVariety}>
                  <SelectTrigger aria-label="Clone variety">
                    <SelectValue placeholder="Select a variety" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {addableVarieties.map((v) => (
                      <SelectItem key={v.key} value={v.key}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[220px] space-y-1">
                <label className="text-sm font-medium" htmlFor="newClone">
                  Clone name
                </label>
                <Input
                  id="newClone"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Home block selection"
                />
              </div>
              <Button
                onClick={handleAdd}
                disabled={!newName.trim() || !newVariety || upsert.isPending}
                className="gap-1"
              >
                {upsert.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add clone
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Clone catalogue</CardTitle>
            <CardDescription>
              Built-in clones plus this vineyard's custom clones. “Mass selection” is an
              allocation option, not a catalogue record.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search name, code or alias…"
              aria-label="Search clones"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-[240px]"
            />
            <Select value={varietyFilter} onValueChange={setVarietyFilter}>
              <SelectTrigger className="w-[200px]" aria-label="Filter by variety">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="all">All varieties</SelectItem>
                {varietyOptions.map((v) => (
                  <SelectItem key={v.key} value={v.key}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center gap-2 px-6 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading clones…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clone</TableHead>
                  <TableHead>Variety</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Selection system</TableHead>
                  <TableHead>Source country</TableHead>
                  <TableHead>Used by blocks</TableHead>
                  {canEdit && <TableHead className="w-[120px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => {
                  const usage = cloneUsage(refs, c);
                  return (
                    <TableRow
                      key={c.key}
                      className="cursor-pointer"
                      onClick={() => setDetail(c)}
                    >
                      <TableCell className="font-medium">
                        {c.display_name}
                        {c.clone_code && c.clone_code !== c.display_name && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {c.clone_code}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {varietyNames.get(c.variety_key) ?? c.variety_key}
                      </TableCell>
                      <TableCell>
                        <TypeBadge custom={c.is_custom} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.selection_system || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.source_country || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <UsageCell blocks={usage.blocks} legacy={usage.viaLegacyText} />
                      </TableCell>
                      {canEdit && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {c.is_custom && c.id ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() => setPendingArchive(c)}
                            >
                              <Archive className="h-3.5 w-3.5" /> Archive
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Read-only</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={canEdit ? 7 : 6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No clones match your search.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {detail?.display_name}
              {detail && <TypeBadge custom={detail.is_custom} />}
            </SheetTitle>
            <SheetDescription>
              {detail ? (varietyNames.get(detail.variety_key) ?? detail.variety_key) : ""}
            </SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="mt-4 divide-y">
              <DetailRow label="Clone code" value={detail.clone_code || null} />
              <DetailRow label="Selection system" value={detail.selection_system || null} />
              <DetailRow label="Source country" value={detail.source_country || null} />
              <DetailRow
                label="Aliases"
                value={detail.aliases.length ? detail.aliases.join(", ") : null}
              />
              <DetailRow label="Catalogue key" value={<code className="text-xs">{detail.key}</code>} />
              <DetailRow
                label="Linked blocks"
                value={
                  detailUsage && detailUsage.blocks.length
                    ? detailUsage.blocks.join(", ")
                    : "Not used by any block"
                }
              />
              {!detail.is_custom && (
                <p className="pt-3 text-xs text-muted-foreground">
                  Built-in catalogue records are read-only.
                </p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!pendingArchive}
        onOpenChange={(o) => !o && setPendingArchive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{pendingArchive?.display_name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Archiving hides this clone from block pickers. Existing block allocations keep
              their saved clone name and continue to display correctly.
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

/* ----------------------------- Rootstocks ----------------------------- */

export function RootstocksTab() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canEdit = canManageCatalogue(currentRole);

  const builtIns = useRootstockCatalog();
  const customs = useVineyardRootstocks(selectedVineyardId);
  const usageQuery = useCatalogueUsagePaddocks(selectedVineyardId);
  const upsert = useUpsertVineyardRootstock();
  const archive = useArchiveVineyardRootstock();

  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [detail, setDetail] = useState<CatalogRootstock | null>(null);
  const [pendingArchive, setPendingArchive] = useState<CatalogRootstock | null>(null);

  const rows = useMemo(
    () => browseRootstocks(builtIns.data ?? [], customs.data ?? [], { query }),
    [builtIns.data, customs.data, query],
  );
  const refs = useMemo(() => collectRootstockRefs(usageQuery.data ?? []), [usageQuery.data]);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name || !selectedVineyardId) return;
    try {
      const row = await upsert.mutateAsync({ vineyardId: selectedVineyardId, displayName: name });
      toast({ title: "Custom rootstock added", description: row?.display_name ?? name });
      setNewName("");
    } catch (err: any) {
      toast({
        title: "Could not add rootstock",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  const confirmArchive = async () => {
    if (!pendingArchive?.id) return;
    try {
      await archive.mutateAsync(pendingArchive.id);
      toast({ title: "Rootstock archived", description: pendingArchive.display_name });
      setPendingArchive(null);
      setDetail(null);
    } catch (err: any) {
      toast({
        title: "Archive failed",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  const loading = builtIns.isLoading || customs.isLoading;
  const detailUsage = detail ? rootstockUsage(refs, detail) : null;

  return (
    <div className="space-y-6">
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add custom rootstock</CardTitle>
            <CardDescription>
              Rootstocks are independent of grape variety and available to every block in
              this vineyard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[220px] space-y-1">
                <label className="text-sm font-medium" htmlFor="newRootstock">
                  Rootstock name
                </label>
                <Input
                  id="newRootstock"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Nursery selection A"
                />
              </div>
              <Button
                onClick={handleAdd}
                disabled={!newName.trim() || upsert.isPending}
                className="gap-1"
              >
                {upsert.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add rootstock
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Rootstock catalogue</CardTitle>
            <CardDescription>
              Built-in rootstocks plus this vineyard's custom rootstocks. “Own roots” is an
              allocation option, not a catalogue record.
            </CardDescription>
          </div>
          <Input
            placeholder="Search name, alias or parentage…"
            aria-label="Search rootstocks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-[260px]"
          />
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center gap-2 px-6 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading rootstocks…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rootstock</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Parentage</TableHead>
                  <TableHead>Aliases</TableHead>
                  <TableHead>Used by blocks</TableHead>
                  {canEdit && <TableHead className="w-[120px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const usage = rootstockUsage(refs, r);
                  return (
                    <TableRow key={r.key} className="cursor-pointer" onClick={() => setDetail(r)}>
                      <TableCell className="font-medium">{r.display_name}</TableCell>
                      <TableCell>
                        <TypeBadge custom={r.is_custom} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.parentage || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.aliases.length ? r.aliases.join(", ") : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <UsageCell blocks={usage.blocks} legacy={usage.viaLegacyText} />
                      </TableCell>
                      {canEdit && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {r.is_custom && r.id ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() => setPendingArchive(r)}
                            >
                              <Archive className="h-3.5 w-3.5" /> Archive
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Read-only</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={canEdit ? 6 : 5}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No rootstocks match your search.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {detail?.display_name}
              {detail && <TypeBadge custom={detail.is_custom} />}
            </SheetTitle>
            <SheetDescription>Rootstocks apply to any grape variety.</SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="mt-4 divide-y">
              <DetailRow label="Canonical name" value={detail.canonical_name || null} />
              <DetailRow label="Parentage" value={detail.parentage || null} />
              <DetailRow
                label="Aliases"
                value={detail.aliases.length ? detail.aliases.join(", ") : null}
              />
              <DetailRow label="Catalogue key" value={<code className="text-xs">{detail.key}</code>} />
              <DetailRow
                label="Linked blocks"
                value={
                  detailUsage && detailUsage.blocks.length
                    ? detailUsage.blocks.join(", ")
                    : "Not used by any block"
                }
              />
              {!detail.is_custom && (
                <p className="pt-3 text-xs text-muted-foreground">
                  Built-in catalogue records are read-only.
                </p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!pendingArchive} onOpenChange={(o) => !o && setPendingArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{pendingArchive?.display_name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Archiving hides this rootstock from block pickers. Existing block allocations
              keep their saved rootstock name.
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
