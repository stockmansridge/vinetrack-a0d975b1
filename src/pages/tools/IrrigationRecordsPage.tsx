import { Link } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import { PageHead } from "@/components/PageHead";
import { MetricCard } from "@/components/ui/metric-card";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Droplet,
  Gauge,
  Timer,
  ListChecks,
  Settings2,
  Plus,
  History,
  BarChart3,
  CheckCircle2,
  CircleAlert,
} from "lucide-react";
import {
  useSetupStatus,
  useVintageSummary,
  useSessions,
  formatLitres,
  formatDuration,
  formatNumber,
} from "@/lib/irrigationQuery";
import { formatDate } from "@/lib/dateFormat";

function ChecklistRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      )}
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}

export default function IrrigationRecordsPage() {
  const { selectedVineyardId } = useVineyard();
  const { vintage } = useVintage();
  const status = useSetupStatus(selectedVineyardId);
  const summary = useVintageSummary(selectedVineyardId, vintage);
  const recent = useSessions(selectedVineyardId, { vintage_year: vintage, limit: 5 });

  const s = status.data;
  const operational = !!s?.is_operational;

  return (
    <div className="space-y-6">
      <PageHead
        title="Irrigation Records | VineTrack"
        description="Record irrigation sessions, water volumes and per-block water use for your vineyard."
        path="/irrigation"
        noindex
      />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Irrigation Records</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vintage {s?.season?.current_vintage_year ?? vintage} · water applied, runtime and
            per-block water use from recorded sessions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/irrigation/setup">
              <Settings2 className="mr-1.5 h-4 w-4" /> Setup
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/irrigation/history">
              <History className="mr-1.5 h-4 w-4" /> History
            </Link>
          </Button>
          <Button asChild disabled={!operational}>
            <Link to="/irrigation/record">
              <Plus className="mr-1.5 h-4 w-4" /> Record irrigation
            </Link>
          </Button>
        </div>
      </header>

      {status.error && (
        <PortalNotice
          variant="error"
          title="Couldn't load irrigation setup"
          description={(status.error as Error).message}
        />
      )}

      {s && !operational && (
        <PortalNotice
          variant="warning"
          title="Irrigation setup is incomplete"
          description="Add an irrigation system, at least one valve, and connect each valve to blocks totalling 100% before recording sessions."
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/irrigation/setup">Finish setup</Link>
            </Button>
          }
        />
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Water applied (vintage)"
          value={formatLitres(summary.data?.total_volume_litres)}
          icon={Droplet}
          tone="teal"
          hint={
            summary.data?.effective_volume_litres != null
              ? `${formatLitres(summary.data.effective_volume_litres)} effective`
              : "Effective water needs block efficiency"
          }
        />
        <MetricCard
          label="Total runtime"
          value={formatDuration(summary.data?.total_runtime_minutes)}
          icon={Timer}
          tone="primary"
          hint={`${summary.data?.session_count ?? 0} sessions recorded`}
        />
        <MetricCard
          label="Water per vine"
          value={
            summary.data?.water_litres_per_vine != null
              ? `${formatNumber(summary.data.water_litres_per_vine, 2)} L`
              : "—"
          }
          icon={Gauge}
          tone="purple"
          hint="Weighted across blocks with vine counts"
        />
        <MetricCard
          label="Irrigation depth"
          value={
            summary.data?.irrigation_depth_mm != null
              ? `${formatNumber(summary.data.irrigation_depth_mm, 2)} mm`
              : "—"
          }
          icon={BarChart3}
          tone="accent"
          hint="Weighted across blocks with serviced area"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-muted-foreground" /> Setup status
            </CardTitle>
            <CardDescription>
              {operational ? "Ready to record irrigation." : "Complete the required steps below."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {status.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
            {s && (
              <>
                <div className="divide-y divide-border">
                  <ChecklistRow
                    ok={s.required.blocks_ok}
                    label="Blocks"
                    detail={`${s.required.active_block_count} active blocks`}
                  />
                  <ChecklistRow
                    ok={s.required.systems_ok}
                    label="Irrigation systems"
                    detail={`${s.required.active_system_count} active`}
                  />
                  <ChecklistRow
                    ok={s.required.valves_ok}
                    label="Valves"
                    detail={`${s.required.active_valve_count} active · ${s.required.valves_with_configured_flow} with a configured flow rate`}
                  />
                  <ChecklistRow
                    ok={s.required.allocations_ok}
                    label="Valve to block connections"
                    detail={`${s.required.fully_allocated_valve_count} of ${s.required.active_valve_count} valves allocate to 100%`}
                  />
                </div>
                <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Recommended block data
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <div>
                      Area: {s.recommended.blocks_with_area}/{s.recommended.total_active_blocks}
                    </div>
                    <div>
                      Vine counts: {s.recommended.blocks_with_vine_count}/
                      {s.recommended.total_active_blocks}
                    </div>
                    <div>
                      Dripper output: {s.recommended.blocks_with_dripper_output}/
                      {s.recommended.total_active_blocks}
                    </div>
                    <div>
                      Efficiency: {s.recommended.blocks_with_efficiency}/
                      {s.recommended.total_active_blocks}
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Recent sessions</CardTitle>
              <CardDescription>Latest recorded irrigation for this vintage.</CardDescription>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link to="/irrigation/history">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {recent.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
            {recent.data && recent.data.sessions.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No irrigation recorded yet for this vintage.
              </div>
            )}
            <div className="divide-y divide-border">
              {recent.data?.sessions.map((s2) => (
                <div key={s2.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {s2.valve_name} · {formatDate(s2.session_date)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {formatDuration(s2.duration_minutes)} · {s2.blocks.length} block
                      {s2.blocks.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 tabular-nums">
                    {formatLitres(s2.total_volume_litres)}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
