import { Link } from "react-router-dom";
import {
  BarChart3,
  CalendarClock,
  CloudRain,
  Droplet,
  Gauge,
  Layers,
  Sprout,
  Timer,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/ui/metric-card";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { ReportWarnings } from "./ReportShell";
import { useIrrigationUnits, EMPTY } from "@/lib/irrigationUnits";
import {
  DATA_QUALITY_LABEL,
  type DataQuality,
  type VintageOverview,
} from "@/lib/irrigationReportsQuery";

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium tabular-nums">
        {value}
        {hint && <span className="ml-1 text-xs font-normal text-muted-foreground">{hint}</span>}
      </span>
    </div>
  );
}

export function OverviewTab({
  data,
  isLoading,
  error,
}: {
  data: VintageOverview | undefined;
  isLoading: boolean;
  error: unknown;
}) {
  const u = useIrrigationUnits();

  if (error) {
    return (
      <PortalNotice
        variant="error"
        title="Couldn't load the vintage overview"
        description={(error as Error).message}
      />
    );
  }
  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  const quality = (data.data_quality ?? null) as DataQuality | null;

  return (
    <div className="space-y-6">
      <ReportWarnings warnings={data.warnings} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Water applied"
          value={u.volume(data.total_litres)}
          icon={Droplet}
          tone="teal"
          hint={`${u.count(data.session_count)} sessions`}
        />
        <MetricCard
          label="Runtime"
          value={u.duration(data.total_runtime_minutes)}
          icon={Timer}
          tone="primary"
          hint={`Average ${u.duration(data.average_session_minutes)} per session`}
        />
        <MetricCard
          label="Water per vine"
          value={u.perVine(data.litres_per_vine)}
          icon={Gauge}
          tone="purple"
          hint={`${u.perHectare(data.litres_per_hectare)} across ${u.area(data.serviced_area_hectares)}`}
        />
        <MetricCard
          label="Irrigation depth"
          value={u.depth(data.irrigation_depth_mm)}
          icon={BarChart3}
          tone="accent"
          hint={`Effective ${u.depth(data.effective_irrigation_depth_mm)}`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Volume breakdown</CardTitle>
            <CardDescription>How the vintage total was determined.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Row label="Total applied" value={u.volume(data.total_litres)} />
            <Row label="Effective (block allocated)" value={u.volume(data.effective_litres)} />
            <Row label="Directly reported" value={u.volume(data.directly_reported_litres)} />
            <Row label="Directly measured" value={u.volume(data.directly_measured_litres)} />
            <Row label="Calculated" value={u.volume(data.calculated_litres)} />
            <Row label="Estimated" value={u.volume(data.estimated_litres)} />
            <Row label="Manually recorded" value={u.volume(data.manual_litres)} />
            <Row label="Imported" value={u.volume(data.imported_litres)} />
            <Row label="Average session" value={u.volume(data.average_session_litres)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Coverage</CardTitle>
            <CardDescription>Infrastructure and vineyard area irrigated.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Row label="Systems used" value={u.count(data.systems_used)} />
            <Row label="Water sources" value={u.count(data.water_sources_used)} />
            <Row label="Valves used" value={u.count(data.valves_used)} />
            <Row label="Blocks irrigated" value={u.count(data.blocks_irrigated)} />
            <Row label="Varieties irrigated" value={u.count(data.varieties_irrigated)} />
            <Row label="Serviced area" value={u.area(data.serviced_area_hectares)} />
            <Row label="Serviced vines" value={u.count(data.serviced_vines)} />
            <Row
              label="Normalisation basis"
              value={data.normalisation_basis ?? EMPTY}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Timing</CardTitle>
            <CardDescription>When water was applied this vintage.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Row label="First irrigation" value={u.date(data.first_irrigation_date)} />
            <Row label="Last irrigation" value={u.date(data.last_irrigation_date)} />
            <Row
              label="Days since last"
              value={u.count(data.days_since_last_irrigation)}
            />
            <Row label="Longest session" value={u.duration(data.longest_session_minutes)} />
            <Row label="Shortest session" value={u.duration(data.shortest_session_minutes)} />
            <Row
              label="Highest use day"
              value={u.date(data.highest_use_day)}
              hint={data.highest_use_day_litres != null ? u.volume(data.highest_use_day_litres) : undefined}
            />
            <Row
              label="Highest use month"
              value={data.highest_use_month ?? EMPTY}
              hint={
                data.highest_use_month_litres != null
                  ? u.volume(data.highest_use_month_litres)
                  : undefined
              }
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">
                Compared with vintage {data.previous_vintage_year ?? EMPTY}
              </CardTitle>
              <CardDescription>
                Server-calculated differences against the same vineyard's previous vintage.
              </CardDescription>
            </div>
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="grid gap-x-6 pt-0 sm:grid-cols-2">
            <div>
              <Row label="Previous total" value={u.volume(data.previous_total_litres)} />
              <Row
                label="Difference"
                value={u.signedVolume(data.volume_difference_litres)}
                hint={
                  data.volume_difference_percent != null
                    ? u.signedPercent(data.volume_difference_percent)
                    : undefined
                }
              />
              <Row label="Previous depth" value={u.depth(data.previous_depth_mm)} />
            </div>
            <div>
              <Row
                label="Depth difference"
                value={
                  data.depth_difference_mm != null
                    ? `${data.depth_difference_mm > 0 ? "+" : data.depth_difference_mm < 0 ? "−" : ""}${u.depth(Math.abs(data.depth_difference_mm))}`
                    : EMPTY
                }
              />
              <Row
                label="Runtime difference"
                value={
                  data.runtime_difference_minutes != null
                    ? `${data.runtime_difference_minutes > 0 ? "+" : data.runtime_difference_minutes < 0 ? "−" : ""}${u.duration(Math.abs(data.runtime_difference_minutes))}`
                    : EMPTY
                }
              />
              <Row
                label="Session difference"
                value={
                  data.session_count_difference != null
                    ? `${data.session_count_difference > 0 ? "+" : ""}${data.session_count_difference}`
                    : EMPTY
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">Rainfall &amp; data quality</CardTitle>
              <CardDescription>Recorded rainfall over the vintage window.</CardDescription>
            </div>
            <CloudRain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="pt-0">
            <Row label="Rainfall" value={u.depth(data.rainfall_mm)} />
            <Row
              label="Rainfall records"
              value={
                data.rainfall_data_complete == null
                  ? "Not yet applicable"
                  : data.rainfall_data_complete
                    ? "Complete"
                    : "Incomplete"
              }
              hint={
                data.rainfall_expected_days != null
                  ? `${data.rainfall_observed_days ?? 0} of ${data.rainfall_expected_days} days`
                  : undefined
              }
            />
            <Row
              label="Missing days"
              value={u.count(data.rainfall_missing_days)}
              hint={
                data.rainfall_future_days != null
                  ? `${data.rainfall_future_days} not yet applicable`
                  : undefined
              }
            />
            <Row
              label="Coverage window"
              value={
                data.rainfall_coverage_start && data.rainfall_coverage_end
                  ? `${u.date(data.rainfall_coverage_start)} – ${u.date(data.rainfall_coverage_end)}`
                  : EMPTY
              }
            />

            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-muted-foreground">Data quality</span>
              {quality ? (
                <Badge
                  variant={
                    quality === "complete"
                      ? "default"
                      : quality === "limited"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {DATA_QUALITY_LABEL[quality] ?? quality}
                </Badge>
              ) : (
                <span className="text-sm">{EMPTY}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/irrigation">
                  <Sprout className="mr-1.5 h-4 w-4" /> Irrigation Records
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link to="/irrigation/history">
                  <Layers className="mr-1.5 h-4 w-4" /> History
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
