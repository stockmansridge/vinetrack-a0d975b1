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
import { formatCell } from "@/pages/setup/ListPage";
import PinsMapView from "@/components/PinsMapView";
import PinDetailPanel, { PinRecord } from "@/components/PinDetailPanel";
import { pinStyle } from "@/lib/pinStyle";

interface PaddockLite {
  id: string;
  name: string | null;
}

export default function PinsPage() {
  const { selectedVineyardId } = useVineyard();
  const [tab, setTab] = useState("table");
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: pins = [], isLoading, error } = useQuery({
    queryKey: ["pins", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PinRecord>("pins", selectedVineyardId!),
  });

  const { data: paddocks = [] } = useQuery({
    queryKey: ["paddocks-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PaddockLite>("paddocks", selectedVineyardId!),
  });

  const paddockNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    paddocks.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [paddocks]);

  const filtered = useMemo(() => {
    if (!filter) return pins;
    const f = filter.toLowerCase();
    return pins.filter((p) =>
      [p.title, p.mode, p.category, p.priority, p.status, p.notes]
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
                  <TableHead>Mode</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paddock</TableHead>
                  <TableHead>Row</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground">Loading…</TableCell>
                  </TableRow>
                )}
                {error && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-destructive">
                      {(error as Error).message}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !error && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      No pins found for this vineyard.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((p) => {
                  const style = pinStyle(p.mode);
                  return (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(p.id)}
                      data-active={p.id === selectedId}
                    >
                      <TableCell className="font-medium">{p.title || "—"}</TableCell>
                      <TableCell>
                        {p.mode ? (
                          <Badge
                            variant="secondary"
                            style={{ background: style.hex + "22", color: style.hex }}
                          >
                            {p.mode}
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell>{p.category ?? "—"}</TableCell>
                      <TableCell>{p.priority ?? "—"}</TableCell>
                      <TableCell>{p.status ?? "—"}</TableCell>
                      <TableCell>
                        {p.paddock_id ? (paddockNameById.get(p.paddock_id) ?? p.paddock_id.slice(0, 8)) : "—"}
                      </TableCell>
                      <TableCell>{p.row_number ?? "—"}</TableCell>
                      <TableCell>{p.side ?? "—"}</TableCell>
                      <TableCell>{formatCell(p.created_at)}</TableCell>
                      <TableCell>{formatCell(p.updated_at)}</TableCell>
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
