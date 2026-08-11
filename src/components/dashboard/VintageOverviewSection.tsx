import { useQuery } from "@tanstack/react-query";
import { Droplet, CalendarDays, Scissors, Wrench, ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import { usePruningVineyardSummary } from "@/lib/pruningSummaryQuery";
import { MetricCard } from "@/components/ui/metric-card";

const fmt = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";

const fmtPercent = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
};

export default function VintageOverviewSection() {
  const { selectedVineyardId } = useVineyard();
  const { vintage, hemisphere, startISO, endISO } = useVintage();
  const pruningSeasonYear = new Date().getFullYear();

  const sprayCountQ = useQuery({
    queryKey: ["vintage-spray-count", selectedVineyardId, startISO, endISO],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("spray_records")
        .select("*", { count: "exact", head: true })
        .eq("vineyard_id", selectedVineyardId!)
        .is("deleted_at", null)
        .neq("is_template", true)
        .gte("date", startISO)
        .lte("date", endISO);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  const maintenanceTripsQ = useQuery({
    queryKey: ["vintage-maintenance-trips", selectedVineyardId, startISO, endISO],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("trips")
        .select("*", { count: "exact", head: true })
        .eq("vineyard_id", selectedVineyardId!)
        .is("deleted_at", null)
        .not("trip_function", "is", null)
        .neq("trip_function", "")
        .neq("trip_function", "spraying")
        .gte("start_time", startISO)
        .lte("start_time", endISO);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  const workTasksCountQ = useQuery({
    queryKey: ["vintage-work-tasks-count", selectedVineyardId, startISO, endISO],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("work_tasks")
        .select("*", { count: "exact", head: true })
        .eq("vineyard_id", selectedVineyardId!)
        .is("deleted_at", null)
        .gte("date", startISO)
        .lte("date", endISO);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  const pruningQ = usePruningVineyardSummary(selectedVineyardId, pruningSeasonYear);

  const rangeHint = `${startISO} → ${endISO}`;
  const hemLabel = hemisphere === "southern" ? "Southern Hemisphere" : "Northern Hemisphere";

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Vintage
          </h2>
          <p className="text-lg font-semibold tracking-tight text-foreground">
            Vintage {vintage}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {hemLabel}
            </span>
          </p>
        </div>
        <span className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          {rangeHint}
        </span>
      </div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Sprays complete"
          icon={Droplet}
          tone="teal"
          value={
            sprayCountQ.isLoading
              ? "…"
              : sprayCountQ.error
                ? "—"
                : fmt(sprayCountQ.data ?? 0)
          }
          to="/reports/spray"
        />
        <MetricCard
          label="Pruning complete"
          icon={Scissors}
          tone="amber"
          value={
            pruningQ.isLoading
              ? "…"
              : pruningQ.error
                ? "—"
                : fmtPercent(pruningQ.data?.overall_progress)
          }
          hint={`Season ${pruningSeasonYear}`}
          to="/tools/pruning-tracker"
        />
        <MetricCard
          label="Maintenance trips"
          icon={Wrench}
          tone="purple"
          value={
            maintenanceTripsQ.isLoading
              ? "…"
              : maintenanceTripsQ.error
                ? "—"
                : fmt(maintenanceTripsQ.data ?? 0)
          }
          hint="Trips with no sprays"
          to="/trips"
        />
        <MetricCard
          label="Work tasks"
          icon={ClipboardList}
          tone="accent"
          value={
            workTasksCountQ.isLoading
              ? "…"
              : workTasksCountQ.error
                ? "—"
                : fmt(workTasksCountQ.data ?? 0)
          }
          to="/work-tasks"
        />
      </div>
    </section>
  );
}


