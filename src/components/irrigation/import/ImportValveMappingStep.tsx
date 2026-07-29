import { useMemo, useState } from "react";
import { AlertTriangle, Check, EyeOff, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { toast } from "sonner";
import { useIrrigationValves } from "@/lib/irrigationQuery";
import {
  useImportValves,
  useSetValveMapping,
  useValidateImport,
  type ImportValve,
  type ValveMappingStatus,
} from "@/lib/irrigationImportQuery";

const STATUS_LABEL: Record<ValveMappingStatus, string> = {
  saved: "Mapped",
  conflict: "Needs review",
  ignored: "Ignored",
  suggested: "Suggested — confirm",
  unmapped: "Not mapped",
};

const STATUS_VARIANT: Record<ValveMappingStatus, "default" | "secondary" | "destructive" | "outline"> = {
  saved: "default",
  conflict: "destructive",
  ignored: "outline",
  suggested: "secondary",
  unmapped: "destructive",
};

const IGNORE = "__ignore__";

export function ImportValveMappingStep({
  batchId,
  vineyardId,
  provider,
  controllerKey,
  controllerName,
}: {
  batchId: string;
  vineyardId: string;
  provider: string;
  controllerKey: string | null;
  controllerName?: string | null;
}) {
  const valvesQ = useImportValves(batchId);
  const vinetrackValves = useIrrigationValves(vineyardId);
  const setMapping = useSetValveMapping();
  const validate = useValidateImport();
  const [busy, setBusy] = useState<string | null>(null);

  const rows = valvesQ.data ?? [];
  const counts = useMemo(() => {
    const matched = rows.filter((v) => v.status === "saved").length;
    const review = rows.filter((v) => v.status !== "saved" && v.status !== "ignored").length;
    return { matched, review };
  }, [rows]);

  const apply = async (valve: ImportValve, valveId: string | null, ignore: boolean, confirmChange = false) => {
    const key = valve.external_valve_name;
    setBusy(key);
    try {
      await setMapping.mutateAsync({
        vineyardId,
        provider,
        controllerKey,
        controllerName,
        externalValveName: valve.external_valve_name,
        externalStationCode: valve.external_station_code,
        externalValveNumber: valve.external_valve_number,
        irrigationValveId: ignore ? null : valveId,
        ignore,
        confirmChange,
      });
      // Mapping changes always require a re-classification pass.
      await validate.mutateAsync({ batchId });
      await valvesQ.refetch();
      toast.success(ignore ? "Valve ignored for this import." : "Valve mapping saved.");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/mapping.?conflict/i.test(message) && !confirmChange) {
        toast.error(message, {
          description: "Review the mapping change, then confirm to continue.",
          action: {
            label: "Confirm change",
            onClick: () => void apply(valve, valveId, ignore, true),
          },
          duration: 12000,
        });
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Valve mappings</CardTitle>
        <span className="text-sm text-muted-foreground">
          {counts.matched} matched / {counts.review} requiring review
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        {counts.review > 0 && (
          <PortalNotice variant="warning" title="Some controller valves still need attention">
            Events on unmapped valves cannot be imported. Map each controller valve to a VineTrack
            valve, or ignore it for this controller.
          </PortalNotice>
        )}

        {valvesQ.isLoading && (
          <p className="text-sm text-muted-foreground">Loading controller valves…</p>
        )}
        {valvesQ.error && (
          <PortalNotice variant="error" title="Couldn't load controller valves">
            {(valvesQ.error as Error).message}
          </PortalNotice>
        )}

        <div className="space-y-3">
          {rows.map((valve) => {
            const selected = valve.status === "ignored"
              ? IGNORE
              : valve.irrigation_valve_id ?? valve.suggested_valve_id ?? "";
            return (
              <div
                key={valve.external_valve_name}
                className="rounded-lg border border-border p-3 md:flex md:items-center md:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{valve.external_valve_label || valve.external_valve_name}</span>
                    <Badge variant={STATUS_VARIANT[valve.status]} className="rounded-md">
                      {STATUS_LABEL[valve.status]}
                    </Badge>
                    {valve.name_changed && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5" /> Controller name changed
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {valve.external_valve_name}
                    {valve.external_station_code ? ` · Station ${valve.external_station_code}` : ""}
                    {valve.external_valve_number != null ? ` · Valve ${valve.external_valve_number}` : ""}
                    {` · ${valve.row_count} event${valve.row_count === 1 ? "" : "s"}`}
                  </p>
                  {valve.previous_external_name && valve.previous_external_name !== valve.external_valve_name && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Previously mapped as “{valve.previous_external_name}”. Review the mapping change
                      before continuing.
                    </p>
                  )}
                  {valve.status === "suggested" && valve.suggested_valve_name && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Suggested match: {valve.suggested_valve_name} — confirm to save.
                    </p>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-2 md:mt-0">
                  <Select
                    value={selected || undefined}
                    onValueChange={(value) =>
                      void apply(valve, value === IGNORE ? null : value, value === IGNORE)
                    }
                    disabled={busy === valve.external_valve_name}
                  >
                    <SelectTrigger className="w-[280px]">
                      <SelectValue placeholder="Select a VineTrack valve" />
                    </SelectTrigger>
                    <SelectContent>
                      {(vinetrackValves.data ?? []).map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                          {v.system_name ? ` · ${v.system_name}` : ""}
                        </SelectItem>
                      ))}
                      <SelectItem value={IGNORE}>
                        <span className="inline-flex items-center gap-2">
                          <EyeOff className="h-3.5 w-3.5" /> Ignore this valve
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {busy === valve.external_valve_name ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : valve.status === "saved" ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : valve.status === "suggested" && valve.suggested_valve_id ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void apply(valve, valve.suggested_valve_id!, false)}
                    >
                      Confirm
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {!valvesQ.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No controller valves found in this file.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default ImportValveMappingStep;
