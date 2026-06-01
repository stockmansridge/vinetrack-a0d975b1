import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Download, AlertTriangle } from "lucide-react";
import {
  fetchTractorFuelLogsForVineyard,
  fetchTractorsForVineyard,
  buildLhrMap,
  type TractorFuelLog,
  type LhrResult,
} from "@/lib/tractorFuelLogsQuery";
import { useCanSeeCosts } from "@/lib/permissions";
import { formatDate } from "@/lib/dateFormat";

const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtDateTime = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return `${formatDate(d)} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
};
const fmtNum = (v?: number | null, digits = 2) =>
  v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const fmtLitres = (v?: number | null) => (v == null ? "—" : `${fmtNum(v, 2)} L`);
const fmtHrs = (v?: number | null) => (v == null ? "—" : `${fmtNum(v, 1)} h`);
const fmtLhr = (v?: number | null) => (v == null ? "—" : `${fmtNum(v, 2)} L/h`);
const fmtCost = (v?: number | null) =>
  v == null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "AUD" });
const fmtCpl = (v?: number | null) =>
  v == null
    ? "—"
    : v.toLocaleString(undefined, {
        style: "currency",
        currency: "AUD",
        minimumFractionDigits: 3,
        maximumFractionDigits: 4,
      }) + "/L";

const todayIso = () => new Date().toISOString().slice(0, 10);

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function statusLabel(s: LhrResult["status"]): string {
  if (s === "calculated") return "Calculated";
  if (s === "estimate") return "Estimate";
  return "Cannot calculate";
}

function StatusBadge({ result }: { result: LhrResult }) {
  if (result.status === "calculated") {
    return <Badge variant="secondary">Calculated</Badge>;
  }
  if (result.status === "estimate") {
    return (
      <Badge variant="outline" title={result.reason ?? "Not both fills marked filled-to-full"}>
        Estimate
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground" title={result.reason ?? ""}>
      <AlertTriangle className="h-3 w-3 mr-1" />
      —
    </Badge>
  );
}

export default function TractorFuelLogsPage() {
  const { selectedVineyardId } = useVineyard();
  const canSeeCosts = useCanSeeCosts();
  const { resolve } = useTeamLookup(selectedVineyardId);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tractorFilter, setTractorFilter] = useState<string>("all");
  const [operatorFilter, setOperatorFilter] = useState<string>("all");
  const [fullFilter, setFullFilter] = useState<string>("all"); // all | full | not_full
  const [search, setSearch] = useState("");

  const { data: logs, isLoading, error } = useQuery({
    queryKey: ["tractor_fuel_logs", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchTractorFuelLogsForVineyard(selectedVineyardId!),
  });

  const { data: tractors } = useQuery({
    queryKey: ["tractors-ref", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchTractorsForVineyard(selectedVineyardId!),
  });

  const tractorName = useMemo(() => {
    const m = new Map<string, string>();
    (tractors ?? []).forEach((t) => m.set(t.id, t.name ?? "Unnamed tractor"));
    return (id: string | null) => (id ? m.get(id) ?? "Unknown tractor" : "—");
  }, [tractors]);

  // Compute L/hr across ALL logs (unfiltered) so the previous-fill lookup
  // still works correctly when filters narrow the list.
  const lhrMap = useMemo(() => buildLhrMap(logs ?? []), [logs]);

  // Operator label for filter + display.
  const operatorLabel = (log: TractorFuelLog) =>
    resolve(log.operator_user_id, log.operator_name) ?? log.operator_name ?? "—";

  const operatorOptions = useMemo(() => {
    const set = new Set<string>();
    (logs ?? []).forEach((l) => {
      const lbl = operatorLabel(l);
      if (lbl && lbl !== "—") set.add(lbl);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [logs, resolve]);

  const rows = useMemo(() => {
    let list = (logs ?? []).slice();
    if (from) list = list.filter((l) => (l.fill_datetime ?? "") >= from);
    if (to) {
      const toEnd = `${to}T23:59:59`;
      list = list.filter((l) => (l.fill_datetime ?? "") <= toEnd);
    }
    if (tractorFilter !== "all") list = list.filter((l) => l.tractor_id === tractorFilter);
    if (operatorFilter !== "all") list = list.filter((l) => operatorLabel(l) === operatorFilter);
    if (fullFilter === "full") list = list.filter((l) => l.filled_to_full === true);
    if (fullFilter === "not_full") list = list.filter((l) => l.filled_to_full !== true);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((l) =>
        [
          tractorName(l.tractor_id),
          operatorLabel(l),
          l.notes,
          l.litres_added,
          l.engine_hours,
        ]
          .some((v) => String(v ?? "").toLowerCase().includes(q)),
      );
    }
    // Newest first
    list.sort((a, b) => (b.fill_datetime ?? "").localeCompare(a.fill_datetime ?? ""));
    return list;
  }, [logs, from, to, tractorFilter, operatorFilter, fullFilter, search, tractorName, resolve]);

  const exportCsv = () => {
    const header = [
      "fill_datetime",
      "tractor",
      "litres_added",
      "engine_hours",
      "litres_per_hour",
      "rate_status",
      "operator",
      ...(canSeeCosts ? ["cost_per_litre", "total_cost"] : []),
      "filled_to_full",
      "notes",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      const lhr = lhrMap.get(r.id) ?? { litresPerHour: null, status: "cannot_calculate" as const };
      const row = [
        r.fill_datetime ?? "",
        tractorName(r.tractor_id),
        r.litres_added ?? "",
        r.engine_hours ?? "",
        lhr.litresPerHour != null ? lhr.litresPerHour.toFixed(3) : "",
        statusLabel(lhr.status),
        operatorLabel(r),
        ...(canSeeCosts ? [r.cost_per_litre ?? "", r.total_cost ?? ""] : []),
        r.filled_to_full ? "yes" : "no",
        r.notes ?? "",
      ];
      lines.push(row.map(csvEscape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tractor-fuel-logs-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tractor fuel logs</h1>
          <p className="text-sm text-muted-foreground">
            Read-only view of tractor fill records synced from iPhone. L/hr is calculated
            display-only from the previous fill for each tractor.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">From</div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">To</div>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Tractor</div>
          <Select value={tractorFilter} onValueChange={setTractorFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tractors</SelectItem>
              {(tractors ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name ?? "Unnamed"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Operator</div>
          <Select value={operatorFilter} onValueChange={setOperatorFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All operators</SelectItem>
              {operatorOptions.map((op) => (
                <SelectItem key={op} value={op}>{op}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Filled to full</div>
          <Select value={fullFilter} onValueChange={setFullFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="full">Filled to full</SelectItem>
              <SelectItem value="not_full">Not full</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 ml-auto">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            placeholder="Tractor, operator, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
        </div>
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date / time</TableHead>
              <TableHead>Tractor</TableHead>
              <TableHead className="text-right">Litres</TableHead>
              <TableHead className="text-right">Engine hrs</TableHead>
              <TableHead className="text-right">L/hr</TableHead>
              <TableHead>Rate status</TableHead>
              <TableHead>Operator</TableHead>
              {canSeeCosts && <TableHead className="text-right">Cost/L</TableHead>}
              {canSeeCosts && <TableHead className="text-right">Total</TableHead>}
              <TableHead>Full?</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={canSeeCosts ? 11 : 9} className="text-center text-muted-foreground py-6">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={canSeeCosts ? 11 : 9} className="text-center text-destructive py-6">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={canSeeCosts ? 11 : 9} className="text-center text-muted-foreground py-8">
                  No fuel logs found.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const lhr = lhrMap.get(r.id) ?? { litresPerHour: null, status: "cannot_calculate" as const };
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{fmtDateTime(r.fill_datetime)}</TableCell>
                  <TableCell>{tractorName(r.tractor_id)}</TableCell>
                  <TableCell className="text-right">{fmtLitres(r.litres_added)}</TableCell>
                  <TableCell className="text-right">{fmtHrs(r.engine_hours)}</TableCell>
                  <TableCell className="text-right">{fmtLhr(lhr.litresPerHour)}</TableCell>
                  <TableCell><StatusBadge result={lhr} /></TableCell>
                  <TableCell>{operatorLabel(r)}</TableCell>
                  {canSeeCosts && <TableCell className="text-right">{fmtCpl(r.cost_per_litre)}</TableCell>}
                  {canSeeCosts && <TableCell className="text-right">{fmtCost(r.total_cost)}</TableCell>}
                  <TableCell>{r.filled_to_full ? "Yes" : "No"}</TableCell>
                  <TableCell className="max-w-[280px] truncate" title={r.notes ?? ""}>{fmt(r.notes)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
