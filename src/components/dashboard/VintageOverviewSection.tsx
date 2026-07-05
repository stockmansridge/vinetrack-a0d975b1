import { useQuery } from "@tanstack/react-query";
import { SprayCan, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import { MetricCard } from "@/components/ui/metric-card";

const fmt = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";

export default function VintageOverviewSection() {
  const { selectedVineyardId } = useVineyard();
  const { vintage, hemisphere, startISO, endISO } = useVintage();

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
          icon={SprayCan}
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
      </div>
    </section>
  );
}
