// Operational Paddocks List — read-only list of blocks for all vineyard
// members. Clicking a row opens the Block Detail page. Owners/managers
// also see a "Manage paddock setup" shortcut to the existing setup page.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Settings2, Search } from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import {
  deriveMetrics,
  parseRows,
  parseVarietyAllocations,
} from "@/lib/paddockGeometry";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmt = (n: any, d = 0) =>
  Number.isFinite(Number(n))
    ? Number(n).toLocaleString(undefined, { maximumFractionDigits: d })
    : "—";

function rowNumberRange(paddock: any): string {
  const rows = parseRows(paddock?.rows);
  const nums = rows
    .map((r) => r.number)
    .filter((n): n is number => Number.isFinite(n));
  if (nums.length === 0) return "—";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return fmt(min, 1);
  return `${fmt(min, 1)}–${fmt(max, 1)}`;
}

function varietySummary(paddock: any): string {
  const allocs = parseVarietyAllocations(paddock?.variety_allocations);
  const names = Array.from(
    new Set(allocs.map((a) => a.variety?.trim()).filter(Boolean) as string[]),
  );
  if (names.length === 0) return "—";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

export default function PaddocksListPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canManage = currentRole === "owner" || currentRole === "manager";
  const [search, setSearch] = useState("");

  const paddocksQ = useQuery({
    queryKey: ["paddocks-list", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<any>("paddocks", selectedVineyardId!),
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const list = (paddocksQ.data ?? []).filter((p) => !p.deleted_at);
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter((p) =>
          [p.name, varietySummary(p)]
            .filter(Boolean)
            .some((v: string) => String(v).toLowerCase().includes(q)),
        )
      : list;
    return filtered
      .map((p) => {
        const m = deriveMetrics(p);
        return {
          paddock: p,
          metrics: m,
          variety: varietySummary(p),
          rowRange: rowNumberRange(p),
        };
      })
      .sort((a, b) =>
        String(a.paddock.name ?? "").localeCompare(String(b.paddock.name ?? "")),
      );
  }, [paddocksQ.data, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Blocks</h1>
          <p className="text-sm text-muted-foreground">
            All blocks for this vineyard. Click a row to open block detail.
          </p>
        </div>
        {canManage && (
          <Button asChild variant="outline" size="sm">
            <Link to="/setup/paddocks">
              <Settings2 className="h-4 w-4 mr-1" /> Manage block setup
            </Link>
          </Button>
        )}
      </div>

      <Card className="p-4 space-y-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search block or variety…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {paddocksQ.isLoading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Loading blocks…
          </div>
        ) : paddocksQ.error ? (
          <div className="text-sm text-destructive py-8 text-center">
            Failed to load blocks.
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No blocks found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Variety</TableHead>
                  <TableHead className="text-right">Area (ha)</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>Row numbers</TableHead>
                  <TableHead className="text-right">Vines</TableHead>
                  <TableHead className="text-right">Emitters</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ paddock, metrics, variety, rowRange }) => (
                  <TableRow
                    key={paddock.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => {
                      window.location.assign(`/blocks/${paddock.id}`);
                    }}
                  >
                    <TableCell className="font-medium">
                      <Link
                        to={`/blocks/${paddock.id}`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {paddock.name ?? "Unnamed block"}
                      </Link>
                    </TableCell>
                    <TableCell>{variety}</TableCell>
                    <TableCell className="text-right">
                      {metrics.areaHa > 0 ? fmt(metrics.areaHa, 2) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmt(metrics.rowCount)}
                    </TableCell>
                    <TableCell>{rowRange}</TableCell>
                    <TableCell className="text-right">
                      {metrics.vineCount != null ? fmt(metrics.vineCount) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {metrics.emitterCount != null
                        ? fmt(metrics.emitterCount)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={paddock.is_archived ? "secondary" : "default"}>
                        {paddock.is_archived ? "Archived" : "Active"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
