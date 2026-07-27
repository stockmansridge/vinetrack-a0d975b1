import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { PageHead } from "@/components/PageHead";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Droplet } from "lucide-react";
import {
  CALCULATION_METHOD_LABEL,
  calculatePreview,
  formatLitres,
  formatNumber,
  useIrrigationValves,
  useRecordSession,
  useValveValidation,
  type CalculationMethod,
  type IrrigationPreview,
} from "@/lib/irrigationQuery";
import { formatEstimate, weightingBasisLabel } from "@/lib/irrigationRows";


const todayISO = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => (v.trim() === "" ? null : Number(v));

export default function IrrigationRecordPage() {
  const { selectedVineyardId } = useVineyard();
  const navigate = useNavigate();
  const valves = useIrrigationValves(selectedVineyardId);
  const record = useRecordSession(selectedVineyardId);

  const [valveId, setValveId] = useState("");
  const [sessionDate, setSessionDate] = useState(todayISO());
  const [duration, setDuration] = useState("");
  const [method, setMethod] = useState<CalculationMethod>("configured_flow");
  const [flow, setFlow] = useState("");
  const [meterStart, setMeterStart] = useState("");
  const [meterFinish, setMeterFinish] = useState("");
  const [totalVolume, setTotalVolume] = useState("");
  const [notes, setNotes] = useState("");

  const [preview, setPreview] = useState<IrrigationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // The client generates the session id up front so retries are idempotent.
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  const validation = useValveValidation(selectedVineyardId, valveId || null);
  const valve = valves.data?.find((v) => v.id === valveId) ?? null;

  useEffect(() => {
    if (validation.data?.requires_volume_entry && method === "configured_flow") {
      setMethod("session_flow");
    }
  }, [validation.data?.requires_volume_entry]); // eslint-disable-line react-hooks/exhaustive-deps

  const inputsReady = useMemo(() => {
    if (!valveId || !sessionDate) return false;
    const mins = Number(duration);
    if (!Number.isFinite(mins) || mins <= 0) return false;
    if (method === "session_flow") return Number(flow) > 0;
    if (method === "total_volume") return Number(totalVolume) > 0;
    if (method === "meter_readings")
      return Number(meterFinish) > Number(meterStart) && meterStart.trim() !== "";
    return true;
  }, [valveId, sessionDate, duration, method, flow, totalVolume, meterStart, meterFinish]);

  const payload = () => ({
    valve_id: valveId,
    session_date: sessionDate,
    duration_minutes: Number(duration),
    calculation_method: method,
    flow_litres_per_hour: method === "session_flow" ? num(flow) : null,
    meter_start_litres: method === "meter_readings" ? num(meterStart) : null,
    meter_finish_litres: method === "meter_readings" ? num(meterFinish) : null,
    total_volume_litres: method === "total_volume" ? num(totalVolume) : null,
  });

  // Preview is server-authoritative — the portal never computes volumes itself.
  useEffect(() => {
    if (!selectedVineyardId || !inputsReady) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(() => {
      calculatePreview(selectedVineyardId, payload())
        .then((p) => {
          if (!cancelled) {
            setPreview(p);
            setPreviewError(null);
          }
        })
        .catch((e: Error) => {
          if (!cancelled) {
            setPreview(null);
            setPreviewError(e.message);
          }
        })
        .finally(() => !cancelled && setPreviewing(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVineyardId, inputsReady, valveId, sessionDate, duration, method, flow, meterStart, meterFinish, totalVolume]);

  const save = async () => {
    if (!preview || !valve) return;
    try {
      const saved = await record.mutateAsync({
        id: sessionIdRef.current,
        irrigation_system_id: valve.irrigation_system_id,
        notes: notes || null,
        ...payload(),
      });
      toast({
        title: saved.duplicate ? "Session already recorded" : "Irrigation recorded",
        description: `${formatLitres(saved.total_volume_litres)} across ${saved.blocks.length} block(s).`,
      });
      navigate("/irrigation/history");
    } catch (e) {
      toast({
        title: "Couldn't save session",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHead
        title="Record Irrigation | VineTrack"
        description="Record an irrigation session and see the water applied to each block before saving."
        path="/irrigation/record"
        noindex
      />
      <header>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link to="/irrigation">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Irrigation Records
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Record irrigation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Volumes and per-block allocations are calculated by the shared VineTrack backend.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Session details</CardTitle>
            <CardDescription>Pick the valve, the date and how the water was measured.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Valve</Label>
                <Select value={valveId} onValueChange={setValveId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a valve" />
                  </SelectTrigger>
                  <SelectContent>
                    {valves.data?.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.system_name} · {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={sessionDate}
                  onChange={(e) => setSessionDate(e.target.value)}
                />
              </div>
            </div>

            {validation.data && !validation.data.can_record && (
              <PortalNotice
                variant="warning"
                title="This valve can't record yet"
                description={validation.data.issues.join(" ")}
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link to="/irrigation/setup">Fix setup</Link>
                  </Button>
                }
              />
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="duration">Duration (minutes)</Label>
                <Input
                  id="duration"
                  inputMode="numeric"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </div>
              <div>
                <Label>Water measurement</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as CalculationMethod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CALCULATION_METHOD_LABEL) as CalculationMethod[]).map((m) => (
                      <SelectItem
                        key={m}
                        value={m}
                        disabled={m === "configured_flow" && !validation.data?.has_configured_flow}
                      >
                        {CALCULATION_METHOD_LABEL[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {method === "configured_flow" && validation.data?.configured_flow_litres_per_hour != null && (
              <PortalNotice
                compact
                variant="info"
                description={`Using the valve's configured flow rate of ${validation.data.configured_flow_litres_per_hour} L/hour.`}
              />
            )}
            {method === "session_flow" && (
              <div>
                <Label htmlFor="flow">Flow rate for this session (L/hour)</Label>
                <Input id="flow" inputMode="decimal" value={flow} onChange={(e) => setFlow(e.target.value)} />
              </div>
            )}
            {method === "total_volume" && (
              <div>
                <Label htmlFor="vol">Total volume used (litres)</Label>
                <Input
                  id="vol"
                  inputMode="decimal"
                  value={totalVolume}
                  onChange={(e) => setTotalVolume(e.target.value)}
                />
              </div>
            )}
            {method === "meter_readings" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ms">Meter start (litres)</Label>
                  <Input
                    id="ms"
                    inputMode="decimal"
                    value={meterStart}
                    onChange={(e) => setMeterStart(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="mf">Meter finish (litres)</Label>
                  <Input
                    id="mf"
                    inputMode="decimal"
                    value={meterFinish}
                    onChange={(e) => setMeterFinish(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Droplet className="h-4 w-4 text-muted-foreground" /> Calculated water
            </CardTitle>
            <CardDescription>Preview from the backend before you save.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!inputsReady && (
              <div className="text-sm text-muted-foreground">
                Enter a valve, date, duration and water measurement to see the calculation.
              </div>
            )}
            {previewError && (
              <PortalNotice variant="error" title="Can't calculate" description={previewError} />
            )}
            {previewing && <div className="text-sm text-muted-foreground">Calculating…</div>}

            {preview && (
              <>
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Total water applied
                  </div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {formatLitres(preview.total_volume_litres)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Vintage {preview.vintage_year} ·{" "}
                    {preview.flow_litres_per_hour_used != null
                      ? `${formatNumber(preview.flow_litres_per_hour_used)} L/h`
                      : "entered volume"}
                    {preview.effective_volume_litres != null &&
                      ` · ${formatLitres(preview.effective_volume_litres)} effective`}
                  </div>
                  {(preview.uses_rows || preview.row_count != null) && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Rows supplied: {preview.row_count ?? "—"} · Allocation basis:{" "}
                      {weightingBasisLabel(preview.weighting_basis)} · Blocks supplied:{" "}
                      {preview.blocks.length}
                      {formatEstimate(
                        (preview as any).selected_vine_count ?? null,
                        (preview as any).vine_count_is_estimated ?? true,
                      ) &&
                        ` · Estimated vines supplied: ${formatEstimate(
                          (preview as any).selected_vine_count,
                          (preview as any).vine_count_is_estimated ?? true,
                        )}`}
                      {formatEstimate(
                        (preview as any).selected_emitter_count ?? null,
                        (preview as any).emitter_count_is_estimated ?? true,
                      ) &&
                        ` · Estimated emitters supplied: ${formatEstimate(
                          (preview as any).selected_emitter_count,
                          (preview as any).emitter_count_is_estimated ?? true,
                        )}`}
                    </div>
                  )}

                </div>


                <div className="divide-y divide-border rounded-lg border border-border">
                  {preview.blocks.map((b) => (
                    <div key={b.block_id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{b.block_name}</span>
                        <Badge variant="secondary" className="tabular-nums">
                          {formatLitres(b.allocated_volume_litres)}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {formatNumber(b.allocation_percentage, 2)}%
                        {b.water_litres_per_vine != null &&
                          ` · ${formatNumber(b.water_litres_per_vine, 2)} L/vine`}
                        {b.irrigation_depth_mm != null &&
                          ` · ${formatNumber(b.irrigation_depth_mm, 2)} mm`}
                      </div>
                    </div>
                  ))}
                </div>

                {preview.warnings.length > 0 && (
                  <PortalNotice
                    variant="warning"
                    title="Some figures couldn't be calculated"
                    description={
                      <ul className="list-disc pl-4">
                        {preview.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    }
                  />
                )}

                <Button className="w-full" onClick={save} disabled={record.isPending}>
                  {record.isPending ? "Saving…" : "Save irrigation session"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
