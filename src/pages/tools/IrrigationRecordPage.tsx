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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, ChevronDown, Droplet, Save, Zap } from "lucide-react";
import {
  CALCULATION_METHOD_LABEL,
  calculatePreview,
  flowSourceLabel,
  formatDuration,
  formatFlow,
  formatLitres,
  formatNumber,
  useIrrigationValves,
  useRecordSession,
  useValveValidation,
  type CalculationMethod,
  type IrrigationPreview,
} from "@/lib/irrigationQuery";
import { formatEstimate, weightingBasisLabel } from "@/lib/irrigationRows";
import { SessionTimeFields } from "@/components/irrigation/SessionTimeFields";
import {
  MAX_DURATION_MINUTES,
  TIME_ERRORS,
  formatTimeRange,
  resolveSessionTimes,
} from "@/lib/irrigationTimes";

const todayISO = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** Manual fallbacks — only shown when the operator opens the advanced section. */
const MANUAL_METHODS: CalculationMethod[] = [
  "session_flow",
  "total_volume",
  "meter_readings",
];

export default function IrrigationRecordPage() {
  const { selectedVineyardId } = useVineyard();
  const navigate = useNavigate();
  const valves = useIrrigationValves(selectedVineyardId);
  const record = useRecordSession(selectedVineyardId);

  const [valveId, setValveId] = useState("");
  const [sessionDate, setSessionDate] = useState(todayISO());
  const [duration, setDuration] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [method, setMethod] = useState<CalculationMethod>("configured_flow");
  const [flow, setFlow] = useState("");
  const [meterStart, setMeterStart] = useState("");
  const [meterFinish, setMeterFinish] = useState("");
  const [totalVolume, setTotalVolume] = useState("");
  const [notes, setNotes] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [preview, setPreview] = useState<IrrigationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // The client generates the session id up front so retries are idempotent.
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  const validation = useValveValidation(selectedVineyardId, valveId || null);
  const valve = valves.data?.find((v) => v.id === valveId) ?? null;

  // SQL 131: the backend resolves the flow rate. The portal never derives one.
  const v = validation.data;
  const automaticAvailable = !!v?.configured_flow_available;
  const automaticFlow = v?.resolved_flow_litres_per_hour ?? null;

  // Automatic flow is the default whenever the backend can resolve one; when it
  // cannot, the operator must enter the water manually.
  useEffect(() => {
    if (!v) return;
    if (automaticAvailable) {
      setMethod("configured_flow");
      setAdvancedOpen(false);
    } else {
      setMethod((m) => (m === "configured_flow" ? "session_flow" : m));
      setAdvancedOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.valve_id, automaticAvailable]);

  // Times are resolved against the selected session date in local time. When
  // both are entered the derived duration is authoritative for preview + save.
  const times = useMemo(
    () =>
      resolveSessionTimes({
        sessionDate,
        startTime,
        endTime,
        durationMinutes: num(duration),
      }),
    [sessionDate, startTime, endTime, duration],
  );

  const bothTimes = startTime.trim() !== "" && endTime.trim() !== "";

  // Keep the visible duration field in sync when both times are present.
  useEffect(() => {
    if (bothTimes && times.durationMinutes != null) {
      const val = String(times.durationMinutes);
      if (val !== duration) setDuration(val);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bothTimes, times.durationMinutes]);

  const effectiveMinutes =
    bothTimes && times.durationMinutes != null ? times.durationMinutes : num(duration);

  const durationError = useMemo(() => {
    if (times.error) return times.error;
    if (effectiveMinutes == null || !Number.isFinite(effectiveMinutes)) return null;
    if (effectiveMinutes <= 0) return TIME_ERRORS.zero;
    if (effectiveMinutes > MAX_DURATION_MINUTES) return TIME_ERRORS.tooLong;
    return null;
  }, [times.error, effectiveMinutes]);

  const clearTimes = () => {
    setStartTime("");
    setEndTime("");
  };

  const inputsReady = useMemo(() => {
    if (!valveId || !sessionDate) return false;
    if (durationError) return false;
    const mins = effectiveMinutes;
    if (mins == null || !Number.isFinite(mins) || mins <= 0) return false;
    if (method === "configured_flow") return automaticAvailable;
    if (method === "session_flow") return Number(flow) > 0;
    if (method === "total_volume") return Number(totalVolume) > 0;
    if (method === "meter_readings")
      return Number(meterFinish) > Number(meterStart) && meterStart.trim() !== "";
    return true;
  }, [
    valveId,
    sessionDate,
    effectiveMinutes,
    durationError,
    method,
    automaticAvailable,
    flow,
    totalVolume,
    meterStart,
    meterFinish,
  ]);

  const payload = () => ({
    valve_id: valveId,
    session_date: sessionDate,
    duration_minutes: Number(effectiveMinutes),
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
  }, [selectedVineyardId, inputsReady, valveId, sessionDate, effectiveMinutes, startTime, endTime, method, flow, meterStart, meterFinish, totalVolume]);

  const save = async () => {
    if (!preview || !valve) return;
    const body = payload();
    // Preview and save must agree on the duration — never silently retry.
    if (preview.duration_minutes !== body.duration_minutes) {
      toast({
        title: "Couldn't save session",
        description: TIME_ERRORS.mismatch,
        variant: "destructive",
      });
      return;
    }
    try {
      const saved = await record.mutateAsync({
        id: sessionIdRef.current,
        irrigation_system_id: valve.irrigation_system_id,
        notes: notes || null,
        started_at: times.startedAt,
        finished_at: bothTimes ? times.finishedAt : null,
        ...body,
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
          Pick the valve and how long it ran — VineTrack works out the water applied to each
          block.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Session details</CardTitle>
              <CardDescription>Pick the valve, the date and how long it ran.</CardDescription>
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
                      {valves.data?.map((val) => (
                        <SelectItem key={val.id} value={val.id}>
                          {val.system_name} · {val.name}
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

              {v && !v.can_record && (
                <PortalNotice
                  variant="warning"
                  title="This valve can't record yet"
                  description={v.issues.join(" ")}
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link to="/irrigation/setup">Fix setup</Link>
                    </Button>
                  }
                />
              )}

              <SessionTimeFields
                idPrefix="rec"
                startTime={startTime}
                endTime={endTime}
                duration={duration}
                times={times}
                onStartTime={setStartTime}
                onEndTime={setEndTime}
                onDuration={setDuration}
                onClearTimes={clearTimes}
              />
              {durationError && !times.error && (
                <p className="text-xs text-destructive">{durationError}</p>
              )}

              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4 text-muted-foreground" /> Water calculation
              </CardTitle>
              <CardDescription>
                VineTrack works the flow rate out from your saved irrigation setup.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!valveId && (
                <div className="text-sm text-muted-foreground">
                  Select a valve to see how its water will be calculated.
                </div>
              )}

              {v && automaticAvailable && (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Automatic flow rate
                      </div>
                      <div className="text-xl font-semibold tabular-nums">
                        {formatFlow(automaticFlow)}
                      </div>
                    </div>
                    <Badge variant="secondary">
                      {v.resolved_flow_is_estimated ? "Estimated" : "Measured"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Source: {flowSourceLabel(v.resolved_flow_source)}
                    {v.resolved_flow_emitter_count != null &&
                      ` · ${formatNumber(v.resolved_flow_emitter_count, 0)} connected emitters`}
                  </div>
                  {(v.resolved_flow_blocks?.length ?? 0) > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                      {v.resolved_flow_blocks!.map((b) => (
                        <li key={b.block_id}>
                          {b.block_name}: {formatFlow(b.block_flow_lph)}
                          {b.emitter_count != null &&
                            ` · ${formatNumber(b.emitter_count, 0)} emitters`}
                          {b.flow_per_emitter_lph != null &&
                            ` × ${formatNumber(b.flow_per_emitter_lph, 2)} L/h each`}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {v && !automaticAvailable && (
                <PortalNotice
                  variant="warning"
                  title="Automatic flow isn't available for this valve"
                  description={
                    v.resolved_flow_warning ??
                    "This valve has no resolvable flow rate, so the water used has to be entered manually below."
                  }
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link to="/irrigation/setup">Open setup</Link>
                    </Button>
                  }
                />
              )}

              {v && automaticAvailable && v.resolved_flow_warning && (
                <PortalNotice compact variant="warning" description={v.resolved_flow_warning} />
              )}

              {v?.warnings?.map((w) => (
                <PortalNotice key={w} compact variant="warning" description={w} />
              ))}

              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="-ml-2">
                    <ChevronDown
                      className={`mr-1.5 h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                    />
                    {automaticAvailable
                      ? "Enter the water manually instead"
                      : "Enter the water used"}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>How the water was measured</Label>
                      <Select
                        value={method === "configured_flow" ? "" : method}
                        onValueChange={(val) => setMethod(val as CalculationMethod)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a manual method" />
                        </SelectTrigger>
                        <SelectContent>
                          {MANUAL_METHODS.map((m) => (
                            <SelectItem key={m} value={m}>
                              {CALCULATION_METHOD_LABEL[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {automaticAvailable && method !== "configured_flow" && (
                      <div className="flex items-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setMethod("configured_flow")}
                        >
                          Use the automatic flow rate
                        </Button>
                      </div>
                    )}
                  </div>

                  {method === "session_flow" && (
                    <div>
                      <Label htmlFor="flow">Flow rate for this session (L/hour)</Label>
                      <Input
                        id="flow"
                        inputMode="decimal"
                        value={flow}
                        onChange={(e) => setFlow(e.target.value)}
                      />
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
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        </div>

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
                Enter a valve, date and how long the valve ran to see the calculation.
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
                      ? formatFlow(preview.flow_litres_per_hour_used)
                      : "entered volume"}
                    {preview.effective_volume_litres != null &&
                      ` · ${formatLitres(preview.effective_volume_litres)} effective`}
                  </div>
                  {preview.flow_source && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Flow source: {flowSourceLabel(preview.flow_source)}
                      {preview.flow_is_estimated ? " (estimated)" : ""}
                      {preview.flow_explanation && ` · ${preview.flow_explanation}`}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {times.startedAt && bothTimes
                      ? `${formatTimeRange(times.startedAt, times.finishedAt)} · ${formatDuration(preview.duration_minutes)}`
                      : formatDuration(preview.duration_minutes)}
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

                <Button size="lg" className="w-full" onClick={save} disabled={record.isPending}>
                  <Save className="mr-2 h-4 w-4" />
                  {record.isPending ? "Saving…" : "Save Irrigation Record"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
