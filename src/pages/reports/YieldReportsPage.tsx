import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { PageHead } from "@/components/PageHead";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download } from "lucide-react";
import {
  extractHistoricalBlockRows,
  fetchYieldReportsForVineyard,
} from "@/lib/yieldReportsQuery";
import { useRegionFormatters } from "@/lib/useRegionFormatters";

const ANY = "__any__";
const HA_PER_AC = 0.40468564224;

const fmtNum = (v?: number | null, dp = 2) =>
  v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp });

export default function YieldReportsComparisonPage() {
  const { selectedVineyardId } = useVineyard();
  const rf = useRegionFormatters();
  const [blockFilter, setBlockFilter] = useState<string>(ANY);
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["yield_reports", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchYieldReportsForVineyard(selectedVineyardId!),
  });

  const rows = useMemo(
    () => extractHistoricalBlockRows(data?.historical ?? []),
    [data?.historical],
  );

  const seasons = useMemo(() => {
    const set = new Set(rows.map((r) => r.season));
    return Array.from(set).sort().reverse();
  }, [rows]);

  const blockNames = useMemo(() => {
    const set = new Set(rows.map((r) => r.blockName));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (blockFilter !== ANY) list = list.filter((r) => r.blockName === blockFilter);
    if (search.trim()) {
      const f = search.toLowerCase();
      list = list.filter((r) => `${r.blockName} ${r.season}`.toLowerCase().includes(f));
    }
    return list;
  }, [rows, blockFilter, search]);

  // Pivot: block × season → tonnes.
  const matrix = useMemo(() => {
    const byBlock = new Map<string, Map<string, { tonnes: number; areaHa: number }>>();
    for (const r of filtered) {
      if (!byBlock.has(r.blockName)) byBlock.set(r.blockName, new Map());
      const seasonMap = byBlock.get(r.blockName)!;
      const cur = seasonMap.get(r.season) ?? { tonnes: 0, areaHa: 0 };
      cur.tonnes += r.yieldTonnes ?? 0;
      cur.areaHa = Math.max(cur.areaHa, r.areaHa ?? 0);
      seasonMap.set(r.season, cur);
    }
    return byBlock;
  }, [filtered]);

  const visibleSeasons = useMemo(() => {
    const set = new Set(filtered.map((r) => r.season));
    return seasons.filter((s) => set.has(s));
  }, [filtered, seasons]);

  const perArea = (tPerHa: number | null) => {
    if (tPerHa == null) return "—";
    const v = rf.areaUnitLabel === "ac" ? tPerHa * HA_PER_AC : tPerHa;
    return `${fmtNum(v)} t/${rf.areaUnitLabel}`;
  };

  const seasonTotals = useMemo(() => {
    const totals = new Map<string, { tonnes: number; areaHa: number }>();
    for (const r of filtered) {
      const cur = totals.get(r.season) ?? { tonnes: 0, areaHa: 0 };
      cur.tonnes += r.yieldTonnes ?? 0;
      cur.areaHa += r.areaHa ?? 0;
      totals.set(r.season, cur);
    }
    return totals;
  }, [filtered]);

  const exportCsv = () => {
    const header = ["Block", ...visibleSeasons.map((s) => `${s} (t)`)];
    const lines = [header.join(",")];
    for (const [block, seasonMap] of matrix) {
      lines.push(
        [
          `"${block.replace(/"/g, '""')}"`,
          ...visibleSeasons.map((s) => (seasonMap.get(s)?.tonnes ?? "").toString()),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "yield-comparison.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <PageHead
        title="Yield Reports"
        description="Compare harvested yield by block across vintages."
        path="/reports/yield"
      />

      <div>
        <h1 className="text-2xl font-semibold">Yield Reports</h1>
        <p className="text-sm text-muted-foreground">
          Compare harvested tonnes and yield per {rf.areaUnitLabel} by block across vintages.
        </p>
      </div>

      {!isLoading && !error && rows.length === 0 && (
        <PortalNotice
          variant="info"
          compact
          title="No actual yield records yet"
          description="Record harvested tonnes on the Yields page — those records feed this comparison and Cost Reports."
        />
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Block</div>
          <Select value={blockFilter} onValueChange={setBlockFilter}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="All blocks" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All blocks</SelectItem>
              {blockNames.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            className="w-64"
            placeholder="Block or season…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={exportCsv} disabled={!filtered.length}>
          <Download className="h-4 w-4 mr-1.5" /> Export CSV
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Block</TableHead>
              {visibleSeasons.map((s) => (
                <TableHead key={s} className="text-right">
                  {s}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={visibleSeasons.length + 1} className="py-6 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={visibleSeasons.length + 1} className="py-6 text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && matrix.size === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
                  No yield records to compare.
                </TableCell>
              </TableRow>
            )}
            {Array.from(matrix).map(([block, seasonMap]) => (
              <TableRow key={block}>
                <TableCell className="font-medium">{block}</TableCell>
                {visibleSeasons.map((s) => {
                  const cell = seasonMap.get(s);
                  return (
                    <TableCell key={s} className="text-right tabular-nums">
                      {cell ? (
                        <div>
                          <div>{fmtNum(cell.tonnes)} t</div>
                          <div className="text-xs text-muted-foreground">
                            {cell.areaHa > 0 ? perArea(cell.tonnes / cell.areaHa) : "—"}
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {matrix.size > 0 && (
              <TableRow className="bg-muted/40">
                <TableCell className="font-semibold">
                  Total <Badge variant="outline" className="ml-1 font-normal">{filtered.length} records</Badge>
                </TableCell>
                {visibleSeasons.map((s) => {
                  const t = seasonTotals.get(s);
                  return (
                    <TableCell key={s} className="text-right font-semibold tabular-nums">
                      {t ? `${fmtNum(t.tonnes)} t` : "—"}
                    </TableCell>
                  );
                })}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
