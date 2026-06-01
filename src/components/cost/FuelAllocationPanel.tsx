// Phase 3 — Fuel Allocation Report (portal-side).
//
// Owner/manager only — gated by useCanSeeCosts() in the parent page.
// Aggregates per-trip fuel estimates (computed from engine hours or trip
// duration) by a user-selected grouping dimension. Does not write to DB.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";

import { fetchTripsForVineyard } from "@/lib/tripsQuery";
import { fetchList } from "@/lib/queries";
import { fetchFuelPurchasesForVineyard } from "@/lib/fuelPurchasesQuery";
import { fetchVineyardMembersWithCategory } from "@/lib/teamMembersQuery";
import { computeFuelEstimate } from "@/lib/fuelEstimate";
import { tripFunctionLabel } from "@/lib/tripFunctionLabels";
import type { TractorLite } from "@/lib/tripCosting";
import { useTeamLookup } from "@/hooks/useTeamLookup";

type GroupBy = "tractor" | "trip_function" | "block" | "operator";

interface PaddockLite { id: string; name: string | null }

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
}
function fmtL(v: number): string {
  return `${v.toFixed(1)} L`;
}
function csvCell(v: any): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function FuelAllocationPanel({ vineyardId }: { vineyardId: string }) {
  const [groupBy, setGroupBy] = useState<GroupBy>("tractor");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: paddocks = [] } = useQuery({
    queryKey: ["fuel-alloc-paddocks", vineyardId],
    queryFn: () => fetchList<PaddockLite>("paddocks", vineyardId),
    enabled: !!vineyardId,
  });
  const paddockIds = useMemo(() => paddocks.map((p) => p.id), [paddocks]);
  const padNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    paddocks.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [paddocks]);

  const { data: tripsRes } = useQuery({
    queryKey: ["fuel-alloc-trips", vineyardId, paddockIds.length],
    queryFn: () => fetchTripsForVineyard(vineyardId, paddockIds),
    enabled: !!vineyardId,
  });
  const trips = tripsRes?.trips ?? [];

  const { data: tractors = [] } = useQuery({
    queryKey: ["fuel-alloc-tractors", vineyardId],
    queryFn: () => fetchList<TractorLite>("tractors", vineyardId),
    enabled: !!vineyardId,
  });
  const tractorById = useMemo(() => {
    const m = new Map<string, TractorLite>();
    tractors.forEach((t) => m.set(t.id, t));
    return m;
  }, [tractors]);

  const { data: fuel = [] } = useQuery({
    queryKey: ["fuel-alloc-purchases", vineyardId],
    queryFn: async () => {
      try { return await fetchFuelPurchasesForVineyard(vineyardId); } catch { return []; }
    },
    enabled: !!vineyardId,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["fuel-alloc-members", vineyardId],
    queryFn: () => fetchVineyardMembersWithCategory(vineyardId),
    enabled: !!vineyardId,
  });

  const { teamMap } = useTeamLookup(vineyardId ?? null);

  const operatorNameFor = (userId: string | null | undefined): string | null => {
    if (!userId) return null;
    const tm = teamMap?.[userId];
    return tm?.display_name ?? tm?.email ?? null;
  };

  // Filter by date range against trip.start_time.
  const filteredTrips = useMemo(() => {
    return trips.filter((t) => {
      if (!t.start_time) return false;
      if (from && t.start_time < from) return false;
      if (to && t.start_time > `${to}T23:59:59`) return false;
      return true;
    });
  }, [trips, from, to]);

  type Group = {
    key: string;
    label: string;
    tripCount: number;
    engineHourBasis: number;
    durationBasis: number;
    rateMissing: number;
    litres: number;
    cost: number;
    costAvailableCount: number;
  };

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const t of filteredTrips) {
      const tractor = t.tractor_id ? tractorById.get(t.tractor_id) ?? null : null;
      const fe = computeFuelEstimate(t, tractor, fuel ?? []);
      const blockNames = (() => {
        const ids = Array.isArray(t.paddock_ids) ? (t.paddock_ids as string[]) : t.paddock_id ? [t.paddock_id] : [];
        const names = ids.map((id) => padNameById.get(id) ?? null).filter((v): v is string => !!v);
        return names.length ? names : (t.paddock_name ? [t.paddock_name] : ["—"]);
      })();
      const groupKeys: { key: string; label: string }[] = (() => {
        switch (groupBy) {
          case "tractor": {
            const name = tractor?.name ?? "Unassigned tractor";
            return [{ key: tractor?.id ?? "none", label: name }];
          }
          case "trip_function": {
            const raw = t.trip_function ?? "";
            return [{ key: raw || "none", label: tripFunctionLabel(raw) ?? "Unassigned function" }];
          }
          case "block":
            return blockNames.map((name) => ({ key: name, label: name }));
          case "operator": {
            const name = operatorNameFor(t.operator_user_id) ?? t.person_name ?? "Unassigned operator";
            return [{ key: name, label: name }];
          }
        }
      })();
      for (const gk of groupKeys) {
        let g = map.get(gk.key);
        if (!g) {
          g = {
            key: gk.key, label: gk.label,
            tripCount: 0, engineHourBasis: 0, durationBasis: 0, rateMissing: 0,
            litres: 0, cost: 0, costAvailableCount: 0,
          };
          map.set(gk.key, g);
        }
        g.tripCount += 1;
        if (fe.rateMissing) g.rateMissing += 1;
        if (fe.basis === "engine_hours") g.engineHourBasis += 1;
        else if (fe.basis === "trip_duration") g.durationBasis += 1;
        if (fe.litres != null) g.litres += fe.litres;
        if (fe.cost != null) { g.cost += fe.cost; g.costAvailableCount += 1; }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.litres - a.litres);
  }, [filteredTrips, tractorById, fuel, padNameById, groupBy, teamMap, members]);

  const totals = useMemo(() => {
    return groups.reduce(
      (acc, g) => {
        acc.trips += g.tripCount;
        acc.litres += g.litres;
        acc.cost += g.cost;
        acc.rateMissing += g.rateMissing;
        return acc;
      },
      { trips: 0, litres: 0, cost: 0, rateMissing: 0 },
    );
  }, [groups]);

  function exportCsv() {
    const headers = [
      "group_by", "group", "trip_count", "engine_hours_basis", "trip_duration_basis",
      "rate_missing", "estimated_litres", "estimated_fuel_cost",
    ];
    const lines = [headers.join(",")];
    for (const g of groups) {
      lines.push([
        groupBy,
        csvCell(g.label),
        g.tripCount,
        g.engineHourBasis,
        g.durationBasis,
        g.rateMissing,
        g.litres.toFixed(2),
        g.cost.toFixed(2),
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuel-allocation-${groupBy}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Fuel allocation</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Per-trip fuel estimates aggregated by your chosen dimension. Uses
            engine hours when available and falls back to trip duration. Not
            written to the database.
          </p>
        </div>
        <Button onClick={exportCsv} variant="outline" size="sm" disabled={groups.length === 0}>
          <Download className="h-4 w-4 mr-2" />Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Group by</div>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tractor">Tractor</SelectItem>
              <SelectItem value="trip_function">Trip function</SelectItem>
              <SelectItem value="block">Paddock / block</SelectItem>
              <SelectItem value="operator">Operator</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">From</div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">To</div>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground uppercase">Trips</div><div className="text-lg font-semibold">{totals.trips}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground uppercase">Estimated litres</div><div className="text-lg font-semibold">{fmtL(totals.litres)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground uppercase">Estimated cost</div><div className="text-lg font-semibold">{fmtMoney(totals.cost)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground uppercase">Rate missing</div><div className="text-lg font-semibold">{totals.rateMissing}</div></Card>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead className="text-right">Trips</TableHead>
              <TableHead className="text-right">Engine hr basis</TableHead>
              <TableHead className="text-right">Duration basis</TableHead>
              <TableHead className="text-right">Rate missing</TableHead>
              <TableHead className="text-right">Estimated litres</TableHead>
              <TableHead className="text-right">Estimated cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No trips match these filters.
                </TableCell>
              </TableRow>
            )}
            {groups.map((g) => (
              <TableRow key={g.key}>
                <TableCell>{g.label}</TableCell>
                <TableCell className="text-right">{g.tripCount}</TableCell>
                <TableCell className="text-right">{g.engineHourBasis}</TableCell>
                <TableCell className="text-right">{g.durationBasis}</TableCell>
                <TableCell className="text-right">{g.rateMissing}</TableCell>
                <TableCell className="text-right">{fmtL(g.litres)}</TableCell>
                <TableCell className="text-right">
                  {g.costAvailableCount === 0 ? "Unavailable" : fmtMoney(g.cost)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Card>
  );
}
