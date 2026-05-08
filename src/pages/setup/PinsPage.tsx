import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
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
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useSortableTable } from "@/lib/useSortableTable";
import { formatCell } from "@/pages/setup/ListPage";
import PinsMapView from "@/components/PinsMapView";
import PinDetailPanel, { PinRecord } from "@/components/PinDetailPanel";
import { pinStyle, formatRowNumber } from "@/lib/pinStyle";
import { buildPinsDiagnostics, pinDisplayTitle } from "@/lib/pinsDiagnostics";
import { parsePolygonPoints } from "@/lib/paddockGeometry";
import { fetchPinsForVineyard } from "@/lib/pinsQuery";

interface PaddockLite {
  id: string;
  name: string | null;
}

export default function PinsPage() {
  const { selectedVineyardId, memberships } = useVineyard();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;
  const [tab, setTab] = useState("table");
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const paddockNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    paddocks.forEach((p) => m.set(p.id, p.name));
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
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[PinsPage] diagnostics", diag);
    // Temporary inspection: distinct classifier values across loaded pins.
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

  const filtered = useMemo(() => {
    if (!filter) return pins;
    const f = filter.toLowerCase();
    return pins.filter((p) =>
      [p.title, (p as any).button_name, p.mode, p.category, p.priority, p.status, p.notes]
        .some((v) => String(v ?? "").toLowerCase().includes(f)),
    );
  }, [pins, filter]);

  const selected = pins.find((p) => p.id === selectedId) ?? null;

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

      <TabsContent value="table" className="mt-0 space-y-4">
        <div className="flex justify-end">
          <Input
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-64"
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Paddock</TableHead>
                  <TableHead className="text-right">Row</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell>
                  </TableRow>
                )}
                {error && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-destructive">
                      {(error as Error).message}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !error && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No pins found for this vineyard.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((p) => {
                  const style = pinStyle(p.mode, (p as any).button_color, (p as any).category);
                  return (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(p.id)}
                      data-active={p.id === selectedId}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ background: style.hex }}
                            title={style.label}
                          />
                          <span className="truncate">{pinDisplayTitle(p as any)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {p.paddock_id ? (paddockNameById.get(p.paddock_id) ?? "—") : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatRowNumber(p.row_number)}</TableCell>
                      <TableCell>
                        {(p as any).is_completed ? (
                          <Badge>Completed</Badge>
                        ) : p.status ? (
                          <Badge variant="outline">{p.status}</Badge>
                        ) : (
                          <Badge variant="outline">Open</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {p.priority ? <Badge variant="secondary">{p.priority}</Badge> : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatCell(p.created_at)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(p as any).is_completed ? formatCell((p as any).completed_at) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <div>
            {selected ? (
              <PinDetailPanel
                pin={selected}
                paddockName={selected.paddock_id ? paddockNameById.get(selected.paddock_id) ?? null : null}
                vineyardName={vineyardName}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <Card className="p-4 text-sm text-muted-foreground">
                Select a pin to see details.
              </Card>
            )}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="map" className="mt-0">
        <PinsMapView />
      </TabsContent>
    </Tabs>
  );
}
