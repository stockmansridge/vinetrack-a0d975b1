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
import {
  fetchAllVineyardMachines,
  resolveMachineForRecord,
  MACHINE_TYPES,
  MACHINE_TYPE_LABELS,
  type MachineType,
  type VineyardMachine,
} from "@/lib/vineyardMachinesQuery";
import { useCanSeeCosts } from "@/lib/permissions";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import type { RegionFormatters } from "@/lib/regionFormatters";

const L_PER_US_GAL = 3.785411784;
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtNum = (v?: number | null, digits = 2) =>
  v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const fmtHrs = (v?: number | null) => (v == null ? "—" : `${fmtNum(v, 1)} h`);

function makeFuelHelpers(rf: RegionFormatters) {
  const imperial = rf.fuelUnitLabel === "gal";
  const toFuelUnits = (litres: number) => (imperial ? litres / L_PER_US_GAL : litres);
  return {
    fuelDateTime: (v?: string | null) => (v ? rf.dateTime(v) || "—" : "—"),
    fuelQty: (litres?: number | null) =>
      litres == null ? "—" : rf.fuel(litres, 2),
    fuelRate: (litresPerHour?: number | null) =>
      litresPerHour == null ? "—" : `${fmtNum(toFuelUnits(litresPerHour), 2)} ${rf.fuelUnitLabel}/h`,
    cost: (v?: number | null) => (v == null ? "—" : rf.currency(v)),
    cpl: (costPerLitre?: number | null) => {
      if (costPerLitre == null) return "—";
      const perUnit = imperial ? costPerLitre * L_PER_US_GAL : costPerLitre;
      try {
        return (
          new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: rf.settings.currency_code,
            currencyDisplay: "narrowSymbol",
            minimumFractionDigits: 3,
            maximumFractionDigits: 4,
          }).format(perUnit) + `/${rf.fuelUnitLabel}`
        );
      } catch {
        return `${rf.settings.currency_code} ${perUnit.toFixed(3)}/${rf.fuelUnitLabel}`;
      }
    },
  };
}

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
  const rf = useRegionFormatters();
  const { fuelDateTime: fmtDateTime, fuelQty: fmtLitres, fuelRate: fmtLhr, cost: fmtCost, cpl: fmtCpl } =
    useMemo(() => makeFuelHelpers(rf), [rf]);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [machineFilter, setMachineFilter] = useState<string>("all"); // key = source:id
  const [machineTypeFilter, setMachineTypeFilter] = useState<string>("all");
  const [operatorFilter, setOperatorFilter] = useState<string>("all");
  const [fullFilter, setFullFilter] = useState<string>("all");
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

  const { data: machines } = useQuery<VineyardMachine[]>({
    queryKey: ["vineyard_machines-all", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchAllVineyardMachines(selectedVineyardId!),
  });

  const machinesById = useMemo(() => {
    const m = new Map<string, VineyardMachine>();
    (machines ?? []).forEach((x) => m.set(x.id, x));
    return m;
  }, [machines]);

  const tractorsById = useMemo(() => {
    const m = new Map<string, { id: string; name?: string | null }>();
    (tractors ?? []).forEach((t) => m.set(t.id, t));
    return m;
  }, [tractors]);

  const resolveLog = (log: TractorFuelLog) =>
    resolveMachineForRecord({ machine_id: log.machine_id, tractor_id: log.tractor_id }, machinesById, tractorsById);

  const lhrMap = useMemo(() => buildLhrMap(logs ?? []), [logs]);

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

  // Machine filter options: union of active machines + legacy tractors actually referenced.
  const machineFilterOptions = useMemo(() => {
    const opts: { key: string; label: string; type: string }[] = [];
    const activeMachines = (machines ?? []).filter((m) => !m.deleted_at);
    activeMachines.forEach((m) =>
      opts.push({
        key: `machine:${m.id}`,
        label: `${m.name ?? "Unnamed"} (${MACHINE_TYPE_LABELS[m.machine_type as MachineType] ?? m.machine_type})`,
        type: m.machine_type,
      }),
    );
    (tractors ?? []).forEach((t) =>
      opts.push({ key: `tractor:${t.id}`, label: `${t.name ?? "Unnamed tractor"} (Tractor)`, type: "tractor" }),
    );
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [machines, tractors]);

  const matchesMachineFilter = (log: TractorFuelLog) => {
    if (machineFilter === "all") return true;
    const [src, id] = machineFilter.split(":");
    if (src === "machine") return log.machine_id === id;
    if (src === "tractor") return !log.machine_id && log.tractor_id === id;
    return true;
  };

  const rows = useMemo(() => {
    let list = (logs ?? []).slice();
    if (from) list = list.filter((l) => (l.fill_datetime ?? "") >= from);
    if (to) {
      const toEnd = `${to}T23:59:59`;
      list = list.filter((l) => (l.fill_datetime ?? "") <= toEnd);
    }
    list = list.filter(matchesMachineFilter);
    if (machineTypeFilter !== "all") {
      list = list.filter((l) => resolveLog(l).type === machineTypeFilter);
    }
    if (operatorFilter !== "all") list = list.filter((l) => operatorLabel(l) === operatorFilter);
    if (fullFilter === "full") list = list.filter((l) => l.filled_to_full === true);
    if (fullFilter === "not_full") list = list.filter((l) => l.filled_to_full !== true);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((l) => {
        const r = resolveLog(l);
        return [r.name, r.typeLabel, operatorLabel(l), l.notes, l.litres_added, l.engine_hours]
          .some((v) => String(v ?? "").toLowerCase().includes(q));
      });
    }
    list.sort((a, b) => (b.fill_datetime ?? "").localeCompare(a.fill_datetime ?? ""));
    return list;
  }, [logs, from, to, machineFilter, machineTypeFilter, operatorFilter, fullFilter, search, machinesById, tractorsById, resolve]);

  const exportCsv = () => {
    const header = [
      "fill_datetime",
      "machine_name",
      "machine_type",
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
      const res = resolveLog(r);
      const row = [
        r.fill_datetime ?? "",
        res.name,
        res.typeLabel,
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
    a.download = `fuel-logs-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const colCount = canSeeCosts ? 12 : 10;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Fuel Logs / Machine</h1>
          <p className="text-sm text-muted-foreground">
            Read-only view of vineyard machine fill records synced from iPhone. L/hr is
            calculated display-only from the previous fill for each machine. Fuel logs do
            not directly allocate costs to blocks or reports.
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
          <div className="text-xs text-muted-foreground">Machine</div>
          <Select value={machineFilter} onValueChange={setMachineFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All machines</SelectItem>
              {machineFilterOptions.map((o) => (
                <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Machine type</div>
          <Select value={machineTypeFilter} onValueChange={setMachineTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {MACHINE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{MACHINE_TYPE_LABELS[t]}</SelectItem>
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
            placeholder="Machine, operator, notes…"
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
              <TableHead>Machine</TableHead>
              <TableHead>Type</TableHead>
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
                <TableCell colSpan={colCount} className="text-center text-muted-foreground py-6">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center text-destructive py-6">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
                  No fuel logs found.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const lhr = lhrMap.get(r.id) ?? { litresPerHour: null, status: "cannot_calculate" as const };
              const res = resolveLog(r);
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{fmtDateTime(r.fill_datetime)}</TableCell>
                  <TableCell>{res.name}</TableCell>
                  <TableCell>{res.typeLabel}</TableCell>
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
