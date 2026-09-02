import { useQuery } from "@tanstack/react-query";
import { Droplet, CalendarDays, Scissors, Wrench, ClipboardList, Grape } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import { hemisphereLabel } from "@/lib/hemisphere";

import { usePruningVineyardSummary } from "@/lib/pruningSummaryQuery";
import { fetchGrapeAllocations } from "@/lib/grapeAllocationsQuery";
import { MetricCard } from "@/components/ui/metric-card";

const fmt = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";

const fmtT = (n: number) =>
  Number.isFinite(n)
    ? `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} t`
    : "—";

const fmtPercent = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
};

export default function VintageOverviewSection() {
  const { selectedVineyardId } = useVineyard();
  const { vintage, hemisphere, startISO, endISO, seasonStartMonth, seasonStartDay } = useVintage();
  const pruningSeasonYear = new Date().getFullYear();
  // Half-open season bound so timestamp columns keep the final day.
  const scope = vintageScope(vintage, seasonStartMonth, seasonStartDay);

  const sprayCountQ = useQuery({
    queryKey: ["vintage-spray-count", selectedVineyardId, scope.startISO, scope.endExclusiveISO],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { count, error } = await applyVintageScope(
        supabase
          .from("spray_records")
          .select("*", { count: "exact", head: true })
          .eq("vineyard_id", selectedVineyardId!)
          .is("deleted_at", null)
          .neq("is_template", true) as any,
        "date",
        scope,
      );
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  const maintenanceTripsQ = useQuery({
    queryKey: ["vintage-maintenance-trips", selectedVineyardId, scope.startISO, scope.endExclusiveISO],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { count, error } = await applyVintageScope(
        supabase
          .from("trips")
          .select("*", { count: "exact", head: true })
          .eq("vineyard_id", selectedVineyardId!)
          .is("deleted_at", null)
          .not("trip_function", "is", null)
          .neq("trip_function", "")
          .neq("trip_function", "spraying") as any,
        "start_time",
        scope,
      );
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  const workTasksCountQ = useQuery({
    queryKey: ["vintage-work-tasks-count", selectedVineyardId, scope.startISO, scope.endExclusiveISO],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { count, error } = await applyVintageScope(
        supabase
          .from("work_tasks")
          .select("*", { count: "exact", head: true })
          .eq("vineyard_id", selectedVineyardId!)
          .is("deleted_at", null) as any,
        "date",
        scope,
      );
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });


  const pruningQ = usePruningVineyardSummary(selectedVineyardId, pruningSeasonYear);

  const allocationQ = useQuery({
    queryKey: ["vintage-grape-allocation", selectedVineyardId, vintage],
    enabled: !!selectedVineyardId && vintage != null,
    queryFn: async () => {
      const all = await fetchGrapeAllocations(selectedVineyardId!, vintage!);
      let ownUse = 0;
      let external = 0;
      for (const a of all) {
        const t = typeof a.quantity_tonnes === "number" && Number.isFinite(a.quantity_tonnes)
          ? a.quantity_tonnes
          : 0;
        if (a.allocation_type === "own_use") ownUse += t;
        else external += t;
      }
      return { ownUse, external };
    },
    staleTime: 60_000,
  });

  const rangeHint = `${startISO} → ${endISO}`;
  const hemLabel = hemisphereLabel(hemisphere);

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
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
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
        <MetricCard
          label="Grape allocation"
          icon={Grape}
          tone="primary"
          value={
            allocationQ.isLoading
              ? "…"
              : allocationQ.error
                ? "—"
                : (
                  <div className="grid grid-cols-2 gap-3 mt-0.5">
                    <div>
                      <div className="text-[22px] font-semibold leading-tight tracking-tight text-foreground tabular-nums">
                        {fmtT(allocationQ.data?.ownUse ?? 0)}
                      </div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                        Own Use
                      </div>
                    </div>
                    <div>
                      <div className="text-[22px] font-semibold leading-tight tracking-tight text-foreground tabular-nums">
                        {fmtT(allocationQ.data?.external ?? 0)}
                      </div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                        External
                      </div>
                    </div>
                  </div>
                )
          }
          to="/yield"
        />
      </div>
    </section>
  );
}


