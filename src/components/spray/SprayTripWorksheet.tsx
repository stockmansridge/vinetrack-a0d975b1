// Canonical Spray Trip worksheet.
//
// Renders ONLY `get_spray_report_v1` facts, so the on-screen trip detail, the
// worksheet and the exported Spray Report PDF always agree. Nothing here
// re-derives rows, tank attribution, weather or costs from raw trip columns.
//
// Edit turns the permitted values into inline controls in their existing
// positions — there is no separate edit modal, and nothing is saved on blur.
// Planned quantities and calculated totals stay read-only; Cancel writes
// nothing; only a confirmed save changes the worksheet or a new export.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, Pencil, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { fetchSprayReportV1, type SprayReportPayloadV1 } from "@/lib/sprayReportV1";
import {
  chemicalTotals,
  costFieldLabel,
  costValueKind,
  formatActual,
  formatPlanned,
  formatTotalActual,
  formatTotalPlanned,
  formatWaterLitres,
  matchSourceLabel,
  rowSourceLabel,
  unitLabel,
  waterTotals,
  NOT_RECORDED,
} from "@/lib/sprayReportQuantities";
import {
  amendmentsForChemical,
  amendmentValueLabel,
  diffActualsDraft,
  draftFromPayload,
  formatAmendmentMarker,
  formatAmendmentTime,
  overPlanNotes,
  payloadAmendments,
  saveSprayActuals,
  SprayActualsConflictError,
  tankChemicalKey,
  type ActualsDraft,
} from "@/lib/sprayActuals";
import {
  correctSprayTripMetadata,
  TripMetadataConflictError,
  validateFuelRate,
} from "@/lib/sprayTripMetadata";
import { recoverSprayWeather, weatherProvenanceLabel } from "@/lib/sprayWeatherRecovery";
import { rowProvenanceLabel } from "@/lib/sprayRowRecovery";
import { formatActiveDuration, formatDistance } from "@/lib/sprayReportPdf";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { validateTripEngineHours, type Trip } from "@/lib/tripsQuery";
import { fetchList } from "@/lib/queries";
import { fetchVineyardTeamMembers, memberLabel } from "@/lib/sprayJobsQuery";
import {
  fetchAllVineyardMachines,
  machineTypeLabel,
  type VineyardMachine,
} from "@/lib/vineyardMachinesQuery";

import SystemAdminDiagnostics from "@/components/admin/SystemAdminDiagnostics";
import {
  ACTUALS_SAVE_FAILED,
  ACTUALS_VERSION_CONFLICT,
  TRIP_METADATA_SAVE_FAILED,
  toCustomerError,
} from "@/lib/sprayReportMessaging";


const NONE = "__none__";


export function sprayReportQueryKey(tripId: string) {
  return ["spray-report-v1", tripId] as const;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Block({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground">
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function timeIn(iso: string | null, tz: string): string {
  if (!iso) return NOT_RECORDED;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return NOT_RECORDED;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function numOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) ? n : NaN;
}

export interface SprayTripCoverage {
  rowsCovered?: number | null;
  completed?: number | null;
  partial?: number | null;
  skipped?: number | null;
  manuallyMarkedComplete?: number | null;
  totalDistance?: string | null;
  pathPoints?: number | null;
  pins?: number | null;
  activeTank?: string | null;
  totalTanks?: string | null;
}

export interface SprayTripSummary {
  status?: string | null;
  functionLabel?: string | null;
  title?: string | null;
  pattern?: string | null;
  created?: string | null;
  updated?: string | null;
  recordId?: string | null;
}

export interface SprayTripWorksheetProps {
  tripId: string;
  /** The trip row, needed to correct its operational metadata. */
  trip?: Trip | null;
  vineyardId?: string | null;
  /** Owners, managers and supervisors may correct this trip. */
  canEdit?: boolean;
  /** Generic trip facts merged in so there is no duplicate spray summary. */
  summary?: SprayTripSummary | null;
  /** Counts calculated from the recorded path — always labelled as such. */
  coverage?: SprayTripCoverage | null;
  /** Extra trip sections (fuel estimate, manual corrections) rendered inline. */
  extraSections?: React.ReactNode;
}

export default function SprayTripWorksheet({
  tripId,
  trip = null,
  vineyardId = null,
  canEdit = false,
  summary = null,
  coverage = null,
  extraSections = null,
}: SprayTripWorksheetProps) {
  const formatters = useRegionFormatters();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: sprayReportQueryKey(tripId),
    queryFn: async () => {
      const { payload, error } = await fetchSprayReportV1(tripId);
      if (!payload) throw new Error(error ?? "Spray record not available yet—sync and retry");
      return payload;
    },
    staleTime: 0,
  });

  const [editing, setEditing] = useState(false);
  const [machineId, setMachineId] = useState<string>(NONE);
  const [sprayUnitId, setSprayUnitId] = useState<string>(NONE);
  const [operatorId, setOperatorId] = useState<string>(NONE);
  const [fuelRate, setFuelRate] = useState("");
  const [startHours, setStartHours] = useState("");
  const [endHours, setEndHours] = useState("");
  const [draft, setDraft] = useState<ActualsDraft>({ water: {}, chemicals: {} });
  const [error, setError] = useState<string | null>(null);
  const [errorDiagnostic, setErrorDiagnostic] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [weatherNote, setWeatherNote] = useState<string | null>(null);
  const [weatherDiagnostic, setWeatherDiagnostic] = useState<string | null>(null);

  const { data: machines = [] } = useQuery<VineyardMachine[]>({
    queryKey: ["worksheet-machines", vineyardId],
    enabled: editing && !!vineyardId,
    queryFn: () => fetchAllVineyardMachines(vineyardId!),
  });
  const { data: sprayUnits = [] } = useQuery<any[]>({
    queryKey: ["worksheet-spray-equipment", vineyardId],
    enabled: editing && !!vineyardId,
    queryFn: () => fetchList("spray_equipment", vineyardId!) as Promise<any[]>,
  });
  const { data: members = [] } = useQuery<any[]>({
    queryKey: ["worksheet-members", vineyardId],
    enabled: editing && !!vineyardId,
    queryFn: () => fetchVineyardTeamMembers(vineyardId!) as Promise<any[]>,
  });

  const payload = query.data ?? null;

  // Leaving edit mode (or reloading) always discards the draft. Nothing is
  // hydrated while editing, so a background refetch cannot overwrite typing.
  useEffect(() => {
    if (!editing) return;
    if (!payload) return;
    setDraft(draftFromPayload(payload));
    setMachineId(payload.equipment.machineId ?? trip?.machine_id ?? NONE);
    setSprayUnitId(payload.equipment.sprayEquipmentId ?? NONE);
    setOperatorId(payload.trip.operatorId ?? NONE);
    setFuelRate(
      payload.equipment.fuelConsumptionSource === "explicit_correction" &&
        payload.equipment.fuelConsumptionLPerHour != null
        ? String(payload.equipment.fuelConsumptionLPerHour)
        : "",
    );
    setStartHours(
      payload.equipment.startEngineHours != null ? String(payload.equipment.startEngineHours) : "",
    );
    setEndHours(
      payload.equipment.endEngineHours != null ? String(payload.equipment.endEngineHours) : "",
    );
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, tripId]);

  const selectedMachine = useMemo(
    () => machines.find((m) => m.id === machineId) ?? null,
    [machines, machineId],
  );

  const amendments = useMemo(() => (payload ? payloadAmendments(payload) : []), [payload]);

  const save = useMutation({
    mutationFn: async () => {
      if (!payload) return;
      const diff = diffActualsDraft(payload, draft);
      if (diff.errors.length) throw new Error(diff.errors.join(" "));

      const start = numOrNull(startHours);
      const end = numOrNull(endHours);
      const rate = numOrNull(fuelRate);
      if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(rate)) {
        throw new Error("Engine hours and fuel use must be numbers.");
      }
      const invalidHours = validateTripEngineHours(start, end);
      if (invalidHours) throw new Error(invalidHours);
      const invalidRate = validateFuelRate(rate);
      if (invalidRate) throw new Error(invalidRate);

      // Complete metadata snapshot: an explicit null clears an overlay.
      const metadata = await correctSprayTripMetadata({
        tripId,
        expectedVersion: payload.metadataCorrectionVersion ?? 0,
        correction: {
          machineId: machineId === NONE ? null : machineId,
          tractorId: payload.equipment.tractorId ?? null,
          sprayEquipmentId: sprayUnitId === NONE ? null : sprayUnitId,
          operatorUserId: operatorId === NONE ? null : operatorId,
          fuelConsumptionLPerHour: rate,
          startEngineHours: start,
          endEngineHours: end,
        },
      });

      // Actual usage: one audited correction per edited tank.
      await saveSprayActuals({ payload, draft });
      return metadata;
    },
    onSuccess: async () => {
      setError(null);
      setErrorDiagnostic(null);
      setEditing(false);
      // The canonical report is re-read; nothing local is promoted.
      await qc.invalidateQueries({ queryKey: sprayReportQueryKey(tripId) });
      await qc.invalidateQueries();
      toast({ title: "Spray trip saved" });
    },
    // The draft is kept on screen so the user can retry.
    onError: (e) => {
      if (e instanceof SprayActualsConflictError || e instanceof TripMetadataConflictError) {
        setError(ACTUALS_VERSION_CONFLICT.customer);
        setErrorDiagnostic(ACTUALS_VERSION_CONFLICT.diagnostic);
        return;
      }
      const { customer, diagnostic } = toCustomerError(
        e instanceof Error ? e.message : String(e),
        ACTUALS_SAVE_FAILED.customer,
      );
      setError(customer);
      setErrorDiagnostic(diagnostic ?? TRIP_METADATA_SAVE_FAILED.diagnostic);
    },
  });

  const recoverWeather = useMutation({
    mutationFn: () => recoverSprayWeather(tripId),
    onSuccess: async (outcome) => {
      setWeatherNote(outcome.message);
      setWeatherDiagnostic(outcome.kind === "failed" ? outcome.diagnostic : null);
      if (outcome.kind === "recovered") {
        await qc.invalidateQueries({ queryKey: sprayReportQueryKey(tripId) });
      }
    },
  });


  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading spray details…
      </div>
    );
  }

  if (query.isError || !payload) {
    const loadError = toCustomerError(
      (query.error as Error)?.message,
      "Spray details could not be loaded. Please try again.",
    );
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="text-destructive">{loadError.customer}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => query.refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again
        </Button>
        <SystemAdminDiagnostics className="mt-3" details={[loadError.diagnostic]} />
      </div>
    );
  }

  const p: SprayReportPayloadV1 = payload;
  const tz = p.identity.vineyardTimeZone;
  const water = waterTotals(p.tanks);
  const totals = chemicalTotals(p.tanks);
  const blocks = p.blocks?.length ? p.blocks.map((b) => b.name).join(", ") : NOT_RECORDED;
  const sum = (pick: (b: (typeof p.blocks)[number]) => number | null) =>
    (p.blocks ?? []).reduce<number | null>(
      (acc, b) => (pick(b) == null ? acc : (acc ?? 0) + (pick(b) as number)),
      null,
    );
  const treated = sum((b) => b.treatedAreaHa);
  const gross = sum((b) => b.grossAreaHa);
  const notes = editing ? overPlanNotes(p, draft) : [];

  const setWater = (tankNumber: number, value: string) =>
    setDraft((d) => ({ ...d, water: { ...d.water, [tankNumber]: value } }));
  const setChemical = (key: string, value: string) =>
    setDraft((d) => ({ ...d, chemicals: { ...d.chemicals, [key]: value } }));

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {editing
            ? "Editing. Planned quantities stay as recorded — only actual usage and the trip's operational details can change."
            : "Recorded facts for this spray. Exports use these saved values."}
        </p>
        {canEdit && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
          </Button>
        )}
        {editing && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save changes
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={save.isPending}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          Unsaved changes are not exported. A report downloaded now uses the last saved record.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <SystemAdminDiagnostics details={[errorDiagnostic, weatherDiagnostic]} />


      {!!notes.length && (
        <ul className="rounded-md border p-2 text-xs text-muted-foreground">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      <Block title="Application">
        <Field label="Reference / program step" value={p.identity.reference || NOT_RECORDED} />
        <Field label={formatters.blocksLabel} value={blocks} />
        <Field label="Gross area" value={gross != null ? formatters.area(gross) : NOT_RECORDED} />
        <Field
          label="Treated area"
          value={treated != null ? formatters.area(treated) : NOT_RECORDED}
        />
        <Field label="Start" value={timeIn(p.trip.startUtc, tz)} />
        <Field label="End" value={timeIn(p.trip.endUtc, tz)} />
        <Field
          label="Active duration"
          value={formatActiveDuration(p.trip.activeDurationSeconds)}
        />
        <Field label="Distance" value={formatDistance(p.trip.distanceMetres, formatters)} />
        <Field
          label="Operator"
          value={
            editing ? (
              <Select value={operatorId} onValueChange={setOperatorId}>
                <SelectTrigger aria-label="Operator" className="h-8 w-56">
                  <SelectValue placeholder="Not recorded" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not recorded</SelectItem>
                  {members.map((m: any) => (
                    <SelectItem key={m.user_id ?? m.id} value={m.user_id ?? m.id}>
                      {memberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              p.trip.operatorName || NOT_RECORDED
            )
          }
        />

        <Field label="Pins recorded" value={String(p.trip.pinCount ?? 0)} />
      </Block>

      <Block title="Equipment">
        <Field
          label="Tractor"
          value={
            editing ? (
              <Select value={machineId} onValueChange={setMachineId}>
                <SelectTrigger aria-label="Tractor" className="h-8 w-56">
                  <SelectValue placeholder="Not recorded" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not recorded</SelectItem>
                  {machines.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} · {machineTypeLabel(m.machine_type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              p.equipment.tractorName || NOT_RECORDED
            )
          }
        />
        <Field
          label="Spray unit"
          value={
            editing ? (
              <Select value={sprayUnitId} onValueChange={setSprayUnitId}>
                <SelectTrigger aria-label="Spray unit" className="h-8 w-56">
                  <SelectValue placeholder="Not recorded" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not recorded</SelectItem>
                  {sprayUnits.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name ?? s.equipment_name ?? "Spray unit"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              p.equipment.sprayUnitName || NOT_RECORDED
            )
          }
        />

        <Field
          label="Start engine hours"
          value={
            editing ? (
              <Input
                aria-label="Start engine hours"
                inputMode="decimal"
                className="h-8 w-32 text-right"
                value={startHours}
                onChange={(e) => setStartHours(e.target.value)}
                placeholder={NOT_RECORDED}
              />
            ) : (
              (p.equipment.startEngineHours ?? NOT_RECORDED)
            )
          }
        />
        <Field
          label="End engine hours"
          value={
            editing ? (
              <Input
                aria-label="End engine hours"
                inputMode="decimal"
                className="h-8 w-32 text-right"
                value={endHours}
                onChange={(e) => setEndHours(e.target.value)}
                placeholder={NOT_RECORDED}
              />
            ) : (
              (p.equipment.endEngineHours ?? NOT_RECORDED)
            )
          }
        />
        <Field label="Engine hours used" value={p.equipment.engineHoursUsed ?? NOT_RECORDED} />
        <Field
          label="Fuel consumption for this trip (L/hr)"
          value={
            editing ? (
              <span className="flex flex-col items-end gap-1">
                <Input
                  aria-label="Fuel consumption for this trip"
                  inputMode="decimal"
                  className="h-8 w-32 text-right"
                  value={fuelRate}
                  onChange={(e) => setFuelRate(e.target.value)}
                  placeholder={
                    selectedMachine?.fuel_usage_l_per_hour != null
                      ? String(selectedMachine.fuel_usage_l_per_hour)
                      : NOT_RECORDED
                  }
                />
                <span className="max-w-xs text-right text-xs font-normal text-muted-foreground">
                  Leave blank to use the tractor's usual rate. This applies to this trip only.
                </span>
              </span>
            ) : (
              (p.equipment.fuelConsumptionLPerHour ?? NOT_RECORDED)
            )
          }
        />
      </Block>


      {p.tanks.map((t) => {
        const waterHistory = amendmentsForChemical(amendments, t.tankNumber, null);
        return (
          <Block key={t.tankNumber} title={`Tank ${t.tankNumber}`}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Planned</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead>Match</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Water</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatWaterLitres(t.plannedWaterLitres)}
                  </TableCell>
                  <TableCell className="text-right">
                    {editing ? (
                      <span className="flex items-center justify-end gap-1">
                        <Input
                          aria-label={`Tank ${t.tankNumber} actual water (L)`}
                          inputMode="decimal"
                          className="h-8 w-24 text-right"
                          value={draft.water[t.tankNumber] ?? ""}
                          onChange={(e) => setWater(t.tankNumber, e.target.value)}
                          placeholder="Not recorded"
                        />
                        <span className="text-xs text-muted-foreground">L</span>
                      </span>
                    ) : (
                      formatWaterLitres(t.actualWaterLitres)
                    )}
                  </TableCell>
                  <TableCell>
                    <HistoryCell
                      id={`water-${t.tankNumber}`}
                      history={waterHistory}
                      tz={tz}
                      open={openHistory}
                      setOpen={setOpenHistory}
                    />
                  </TableCell>
                </TableRow>
                {t.chemicals.map((c, i) => {
                  const key = tankChemicalKey(t.tankNumber, c, i);
                  const history = amendmentsForChemical(amendments, t.tankNumber, c.name);
                  return (
                    <TableRow key={key}>
                      <TableCell>{c.name}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatPlanned(c)}
                      </TableCell>
                      <TableCell className="text-right">
                        {editing ? (
                          <span className="flex items-center justify-end gap-1">
                            <Input
                              aria-label={`Tank ${t.tankNumber} ${c.name} actual`}
                              inputMode="decimal"
                              className="h-8 w-24 text-right"
                              value={draft.chemicals[key] ?? ""}
                              onChange={(e) => setChemical(key, e.target.value)}
                              placeholder="Not recorded"
                            />
                            <span className="text-xs text-muted-foreground">
                              {unitLabel(c.unit)}
                            </span>
                          </span>
                        ) : (
                          formatActual(c)
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {matchSourceLabel(c.matchSource)}
                        <HistoryCell
                          id={key}
                          history={history}
                          tz={tz}
                          open={openHistory}
                          setOpen={setOpenHistory}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!t.chemicals.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No chemicals recorded for this tank.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Block>
        );
      })}

      {!!p.tanks.length && (
        <Block title="Totals for this application">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Planned total</TableHead>
                <TableHead className="text-right">Actual total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Water</TableCell>
                <TableCell className="text-right">{formatWaterLitres(water.planned)}</TableCell>
                <TableCell className="text-right">
                  {water.actual == null
                    ? NOT_RECORDED
                    : `${formatWaterLitres(water.actual)}${water.actualIncomplete ? " (partial)" : ""}`}
                </TableCell>
              </TableRow>
              {totals.map((t) => (
                <TableRow key={t.key}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-right">{formatTotalPlanned(t)}</TableCell>
                  <TableCell className="text-right">{formatTotalActual(t)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {editing && (
            <p className="mt-2 text-xs text-muted-foreground">
              Totals refresh from the saved record after you save.
            </p>
          )}
        </Block>
      )}

      <Block title="Rows">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>{formatters.blockLabel}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tank</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.rows.map((r, i) => (
              <TableRow key={`${r.rowNumber}-${r.blockId ?? i}`}>
                <TableCell>{r.rowNumber ?? NOT_RECORDED}</TableCell>
                <TableCell>{r.blockName ?? NOT_RECORDED}</TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell>{r.tank == null ? NOT_RECORDED : String(r.tank)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {rowProvenanceLabel(r) || rowSourceLabel(r.source)}
                </TableCell>
              </TableRow>
            ))}

            {!p.rows.length && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No rows recorded.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Block>

      {coverage && (
        <Block title="Coverage (calculated from the recorded path)">
          <p className="mb-2 text-xs text-muted-foreground">
            Worked out from the recorded track and pins — not part of the signed
            spray record above.
          </p>
          <Field label="Rows covered" value={String(coverage.rowsCovered ?? 0)} />
          <Field label="Completed" value={String(coverage.completed ?? 0)} />
          <Field label="Partial" value={String(coverage.partial ?? 0)} />
          <Field label="Skipped" value={String(coverage.skipped ?? 0)} />
          <Field
            label="Manually marked complete"
            value={String(coverage.manuallyMarkedComplete ?? 0)}
          />
          <Field label="Total distance" value={coverage.totalDistance || NOT_RECORDED} />
          <Field
            label="Path points"
            value={coverage.pathPoints == null ? NOT_RECORDED : String(coverage.pathPoints)}
          />
          <Field
            label="Pins"
            value={coverage.pins == null ? NOT_RECORDED : String(coverage.pins)}
          />
          {(coverage.activeTank || coverage.totalTanks) && (
            <>
              <Field label="Active tank" value={coverage.activeTank || NOT_RECORDED} />
              <Field label="Total tanks" value={coverage.totalTanks || NOT_RECORDED} />
            </>
          )}
        </Block>
      )}

      {summary && (
        <Block title="Trip record">
          <Field label="Status" value={summary.status || NOT_RECORDED} />
          <Field label="Trip type / function" value={summary.functionLabel || NOT_RECORDED} />
          <Field label="Title / details" value={summary.title || NOT_RECORDED} />
          <Field label="Pattern" value={summary.pattern || NOT_RECORDED} />
          <Field label="Created" value={summary.created || NOT_RECORDED} />
          <Field label="Updated" value={summary.updated || NOT_RECORDED} />
          {summary.recordId && (
            <Field
              label="Record ID"
              value={<span className="break-all font-mono text-xs">{summary.recordId}</span>}
            />
          )}
        </Block>
      )}

      {extraSections}



      <Block title="Hourly weather">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Recorded observations are never overwritten; recovery only fills in
            missing hours.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => recoverWeather.mutate()}
            disabled={recoverWeather.isPending}
          >
            {recoverWeather.isPending ? "Retrieving…" : "Retrieve historical weather"}
          </Button>
        </div>
        {weatherNote && <p className="mb-2 text-xs text-muted-foreground">{weatherNote}</p>}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hour</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Temp</TableHead>
              <TableHead>Humidity</TableHead>
              <TableHead>Wind</TableHead>
              <TableHead>Rain</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.weather.map((w, i) => (
              <TableRow key={`${w.sampleSlot}-${i}`}>
                <TableCell>{timeIn(w.sampleSlot, tz)}</TableCell>
                <TableCell className="text-xs">
                  {w.source || NOT_RECORDED}
                  {w.isStale && (
                    <Badge variant="outline" className="ml-1">
                      stale
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {w.temperatureC != null ? formatters.temperature(w.temperatureC, 1) : NOT_RECORDED}
                </TableCell>
                <TableCell>{w.humidityPct != null ? `${w.humidityPct}%` : NOT_RECORDED}</TableCell>
                <TableCell>
                  {w.windSpeedKmh != null ? formatters.wind(w.windSpeedKmh, 1) : NOT_RECORDED}
                </TableCell>
                <TableCell>
                  {w.rainMm != null ? formatters.rainfall(w.rainMm, 2) : NOT_RECORDED}
                </TableCell>
              </TableRow>
            ))}
            {!p.weather.length && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No hourly weather recorded.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Block>

      {!!amendments.length && (
        <Block title="Amendment history">
          <ul className="space-y-1 text-xs text-muted-foreground">
            {amendments.map((a, i) => (
              <li key={i}>
                Tank {a.tankNumber ?? NOT_RECORDED} · {a.chemicalName || "Water"} —{" "}
                {amendmentValueLabel(a.previousValue, a.previousUnit)} →{" "}
                {amendmentValueLabel(a.newValue, a.newUnit)} · {formatAmendmentMarker(a, tz)}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {p.cost && typeof p.cost === "object" && (
        <Block title="Estimated trip cost">
          {Object.entries(p.cost).map(([k, v]) => (
            <Field
              key={k}
              label={costFieldLabel(k)}
              value={
                v == null
                  ? NOT_RECORDED
                  : typeof v !== "number"
                    ? String(v)
                    : costValueKind(k) === "currency"
                      ? formatters.currency(v)
                      : costValueKind(k) === "hours"
                        ? `${v.toFixed(2)} h`
                        : costValueKind(k) === "litres"
                          ? `${v.toFixed(1)} L`
                          : costValueKind(k) === "area"
                            ? formatters.area(v)
                            : String(v)
              }
            />
          ))}
        </Block>
      )}

      {!!p.warnings.length && (
        <Block title="Completeness warnings">
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {p.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

/** Marker plus expandable previous/new history for one changed actual. */
function HistoryCell({
  id,
  history,
  tz,
  open,
  setOpen,
}: {
  id: string;
  history: ReturnType<typeof payloadAmendments>;
  tz: string;
  open: string | null;
  setOpen: (v: string | null) => void;
}) {
  if (!history.length) return null;
  const latest = history[history.length - 1];
  const expanded = open === id;
  return (
    <div className="mt-0.5">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
        aria-expanded={expanded}
        onClick={() => setOpen(expanded ? null : id)}
      >
        <History className="h-3 w-3" />
        {formatAmendmentMarker(latest, tz)}
      </button>
      {expanded && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {history.map((a, i) => (
            <li key={i}>
              {formatAmendmentTime(a.changedAtUtc, tz)} · {a.editorName || "Unknown editor"} ·{" "}
              {amendmentValueLabel(a.previousValue, a.previousUnit)} →{" "}
              {amendmentValueLabel(a.newValue, a.newUnit)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
