import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2, CircleAlert, ListChecks } from "lucide-react";
import {
  flowSourceLabel,
  formatFlow,
  formatNumber,
  useSetupStatus,
  type SetupStatus,
} from "@/lib/irrigationQuery";

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

/** Per-valve readiness, including the SQL 131 automatic flow resolution. */
function ValveReadiness({ valves }: { valves: SetupStatus["valves"] }) {
  if (!valves?.length) return null;
  return (
    <div className="mt-4 rounded-lg border border-border">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Valve readiness
      </div>
      <div className="divide-y divide-border">
        {valves.map((v) => {
          const ready = !!v.automatic_flow_ready;
          return (
            <div key={v.valve_id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{v.valve_name}</span>
                  <Badge variant={ready ? "default" : "outline"}>
                    {ready ? "Automatic flow ready" : "Manual entry required"}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {v.block_count} block{v.block_count === 1 ? "" : "s"}
                  {v.row_count ? ` · ${v.row_count} rows` : ""} · Allocation{" "}
                  {formatNumber(v.allocation_total, 1)}%
                </div>
                {ready ? (
                  <div className="text-xs text-muted-foreground">
                    {formatFlow(v.resolved_flow_litres_per_hour)} ·{" "}
                    {flowSourceLabel(v.resolved_flow_source)}
                    {v.resolved_flow_is_estimated ? " (estimated)" : ""}
                    {v.resolved_flow_emitter_count != null &&
                      ` · ${formatNumber(v.resolved_flow_emitter_count, 0)} emitters`}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {v.resolved_flow_warning ??
                      "No flow rate could be resolved — sessions for this valve need a manual volume."}
                  </div>
                )}
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link to="/irrigation/setup">Configure</Link>
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Shared irrigation setup status. Lives on the Setup page ("Setup status" tab)
 * and is only surfaced on the dashboard while setup is incomplete.
 */
export function SetupStatusPanel({
  vineyardId,
  showCard = true,
}: {
  vineyardId: string | null;
  showCard?: boolean;
}) {
  const status = useSetupStatus(vineyardId);
  const s = status.data;
  const operational = !!s?.is_operational;

  const body = (
    <>
      {status.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {status.error && (
        <PortalNotice
          variant="error"
          title="Couldn't load irrigation setup"
          description={(status.error as Error).message}
        />
      )}
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
              detail={`${s.required.active_valve_count} active · ${
                s.required.valves_with_automatic_flow ?? 0
              } with an automatic flow rate`}
            />
            <ChecklistRow
              ok={s.required.allocations_ok}
              label="Valve to block or row connections"
              detail={`${s.required.fully_allocated_valve_count} of ${s.required.active_valve_count} valves allocate to 100%`}
            />
          </div>

          {s.valves.some((v) => v.uses_rows && !v.row_count) && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {s.valves
                .filter((v) => v.uses_rows && !v.row_count)
                .map((v) => (
                  <li key={v.valve_id}>{v.valve_name}: this valve has no vineyard rows assigned.</li>
                ))}
            </ul>
          )}

          <ValveReadiness valves={s.valves} />

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
    </>
  );

  if (!showCard) return <div>{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4 text-muted-foreground" /> Setup status
        </CardTitle>
        <CardDescription>
          {operational ? "Ready to record irrigation." : "Complete the required steps below."}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">{body}</CardContent>
    </Card>
  );
}
