import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { fetchCount, fetchList } from "@/lib/queries";
import {
  Map, Tractor, SprayCan, Users, Ruler, Grape, LayoutGrid,
  ArrowRight, Activity, Sprout, Layers, MapPin, FolderOpen, Route,
} from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { deriveMetrics } from "@/lib/paddockGeometry";
import { useMemo } from "react";
import VineyardOverviewMap from "@/components/dashboard/VineyardOverviewMap";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { MetricCard, PageHeader } from "@/components/ui/metric-card";
import { Badge } from "@/components/ui/badge";

const fmt = (n: number, digits = 0) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";

const QuickLink = ({ to, label, Icon }: { to: string; label: string; Icon: any }) => (
  <Link
    to={to}
    className="group flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm hover:bg-muted/50 hover:border-primary/30 transition"
  >
    <span className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <span className="font-medium text-foreground">{label}</span>
    </span>
    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-primary transition" />
  </Link>
);

export default function Dashboard() {
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const rf = useRegionFormatters();
  const vineyard = memberships.find((m) => m.vineyard_id === selectedVineyardId);

  const paddocksQ = useQuery({
    queryKey: ["dashboard-paddocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<any>("paddocks", selectedVineyardId!),
    staleTime: 5 * 60_000,
  });

  const tractorsQ = useQuery({
    queryKey: ["count", "tractors", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchCount("tractors", selectedVineyardId!),
  });
  const sprayQ = useQuery({
    queryKey: ["count", "spray_equipment", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchCount("spray_equipment", selectedVineyardId!),
  });
  const teamQ = useQuery({
    queryKey: ["count", "vineyard_members", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("vineyard_members")
        .select("*", { count: "exact", head: true })
        .eq("vineyard_id", selectedVineyardId!);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const summary = useMemo(() => {
    const list = paddocksQ.data ?? [];
    let mapped = 0;
    let totalAreaHa = 0;
    let totalRows = 0;
    let totalVines = 0;
    let vineFromAll = true;
    for (const p of list) {
      const m = deriveMetrics(p);
      if (m.areaHa > 0) mapped += 1;
      totalAreaHa += m.areaHa;
      totalRows += m.rowCount;
      if (m.vineCount != null) totalVines += m.vineCount;
      else vineFromAll = false;
    }
    return {
      paddocks: list.length,
      mapped,
      totalAreaHa,
      totalRows,
      totalVines,
      vineFromAll,
    };
  }, [paddocksQ.data]);

  if (!selectedVineyardId) return null;

  const loading = paddocksQ.isLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{vineyard?.vineyard_name ?? "Dashboard"}</h1>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={rf.blocksLabel}
          Icon={Map}
          value={loading ? "…" : fmt(summary.paddocks)}
          hint={loading ? undefined : `${summary.mapped} mapped`}
          to="/paddocks"
        />
        <StatCard
          label="Area"
          Icon={LayoutGrid}
          value={loading ? "…" : summary.totalAreaHa > 0 ? rf.area(summary.totalAreaHa, 2) : "—"}
          hint={`From ${rf.blockLabel.toLowerCase()} polygons`}
        />
        <StatCard
          label="Total rows"
          Icon={Ruler}
          value={loading ? "…" : fmt(summary.totalRows)}
        />
        <StatCard
          label="Vines"
          Icon={Grape}
          value={loading ? "…" : summary.totalVines > 0 ? fmt(summary.totalVines) : "—"}
          hint={summary.vineFromAll ? "Derived from row length / vine spacing" : "Partial — some paddocks missing data"}
        />
        <StatCard
          label="Tractors"
          Icon={Tractor}
          value={tractorsQ.isLoading ? "…" : tractorsQ.error ? "—" : fmt(tractorsQ.data ?? 0)}
          to="/setup/tractors"
        />
        <StatCard
          label="Spray equipment"
          Icon={SprayCan}
          value={sprayQ.isLoading ? "…" : sprayQ.error ? "—" : fmt(sprayQ.data ?? 0)}
          to="/setup/spray-equipment"
        />
        <StatCard
          label="Team members"
          Icon={Users}
          value={teamQ.isLoading ? "…" : teamQ.error ? "—" : fmt(teamQ.data ?? 0)}
          to="/team"
        />
      </div>

      <VineyardOverviewMap />

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Daily management</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <QuickLink to="/dashboard/live" label="Live Dashboard" Icon={Activity} />
          <QuickLink to="/trips" label="Today's Trips" Icon={Sprout} />
          <QuickLink to="/spray-jobs" label="Spray Jobs" Icon={Layers} />
          <QuickLink to="/reports/trips" label="Trip Reports" Icon={Route} />
          <QuickLink to="/pins" label="Pins / Repairs" Icon={MapPin} />
          <QuickLink to="/reports/documents" label="Documents & Exports" Icon={FolderOpen} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Setup</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <QuickLink to="/setup/paddocks" label={rf.blocksLabel} Icon={Map} />
          <QuickLink to="/setup/tractors" label="Tractors" Icon={Tractor} />
          <QuickLink to="/setup/spray-equipment" label="Spray equipment" Icon={SprayCan} />
          <QuickLink to="/team" label="Team" Icon={Users} />
        </div>
      </div>
    </div>
  );
}
