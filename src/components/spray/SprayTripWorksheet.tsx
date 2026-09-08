// Canonical Spray Trip worksheet.
//
// Renders ONLY `get_spray_report_v1` facts, so the on-screen trip detail, the
// worksheet and the exported Spray Report PDF always agree. Nothing here
// re-derives rows, tank attribution, weather or costs from raw trip columns.
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  waterTotals,
  NOT_RECORDED,
} from "@/lib/sprayReportQuantities";
import { formatActiveDuration, formatDistance } from "@/lib/sprayReportPdf";
import { useRegionFormatters } from "@/lib/useRegionFormatters";

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

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
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

export default function SprayTripWorksheet({ tripId }: { tripId: string }) {
  const formatters = useRegionFormatters();
  const query = useQuery({
    queryKey: sprayReportQueryKey(tripId),
    queryFn: async () => {
      const { payload, error } = await fetchSprayReportV1(tripId);
      if (!payload) throw new Error(error ?? "Spray record not available yet—sync and retry");
      return payload;
    },
    staleTime: 0,
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading spray details…
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="text-destructive">
          {(query.error as Error)?.message ?? "Spray details could not be loaded."}
        </p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => query.refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again
        </Button>
      </div>
    );
  }

  const p: SprayReportPayloadV1 = query.data;
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

  return (
    <div className="space-y-3 text-sm">
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
        <Field label="Operator" value={p.trip.operatorName || NOT_RECORDED} />
        <Field label="Pins recorded" value={String(p.trip.pinCount ?? 0)} />
      </Block>

      <Block title="Equipment">
        <Field label="Tractor" value={p.equipment.tractorName || NOT_RECORDED} />
        <Field label="Spray unit" value={p.equipment.sprayUnitName || NOT_RECORDED} />
        <Field
          label="Start engine hours"
          value={p.equipment.startEngineHours ?? NOT_RECORDED}
        />
        <Field label="End engine hours" value={p.equipment.endEngineHours ?? NOT_RECORDED} />
        <Field label="Engine hours used" value={p.equipment.engineHoursUsed ?? NOT_RECORDED} />
      </Block>

      {p.tanks.map((t) => (
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
                <TableCell className="text-right">
                  {formatWaterLitres(t.plannedWaterLitres)}
                </TableCell>
                <TableCell className="text-right">
                  {formatWaterLitres(t.actualWaterLitres)}
                </TableCell>
                <TableCell />
              </TableRow>
              {t.chemicals.map((c, i) => (
                <TableRow key={`${c.name}-${i}`}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell className="text-right">{formatPlanned(c)}</TableCell>
                  <TableCell className="text-right">{formatActual(c)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {matchSourceLabel(c.matchSource)}
                  </TableCell>
                </TableRow>
              ))}
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
      ))}

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
              <TableRow key={`${r.rowNumber}-${i}`}>
                <TableCell>{r.rowNumber}</TableCell>
                <TableCell>{r.blockName ?? NOT_RECORDED}</TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell>{r.tank == null ? NOT_RECORDED : String(r.tank)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {rowSourceLabel(r.source)}
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

      <Block title="Hourly weather">
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
