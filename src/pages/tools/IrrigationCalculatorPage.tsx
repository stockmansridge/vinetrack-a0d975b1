import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, RefreshCw, CloudSun, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { useVineyard } from "@/context/VineyardContext";
import {
  calculateIrrigation,
  DEFAULT_IRRIGATION_SETTINGS,
  type ForecastDay,
  type IrrigationSettings,
} from "@/lib/calculations/irrigation";
import { fetchIrrigationForecast } from "@/lib/calculations/irrigationForecast";
import {
  formatHoursMinutes,
  interpretRecommendation,
  type AdvisorStatus,
} from "@/lib/calculations/irrigationAdvisor";

interface DayRow {
  id: string;
  label: string;
  eto: string;
  rain: string;
}

const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "—");
const newId = () => crypto.randomUUID();

const DURATION_OPTIONS = [3, 5, 7, 14];

const STATUS_STYLES: Record<AdvisorStatus, string> = {
  none: "bg-muted text-muted-foreground border-muted",
  light: "bg-primary/10 text-primary border-primary/30",
  recommended: "bg-primary/15 text-primary border-primary/40",
  high: "bg-destructive/10 text-destructive border-destructive/30",
};

export default function IrrigationCalculatorPage() {
  const { selectedVineyardId } = useVineyard();
  const [mode, setMode] = useState<"forecast" | "manual">("forecast");
  const [duration, setDuration] = useState<number>(5);

  // Settings (shared between modes)
  const [settings, setSettings] = useState<IrrigationSettings>(DEFAULT_IRRIGATION_SETTINGS);
  const [recentRain, setRecentRain] = useState<string>("0");

  // Forecast mode: per-day overrides keyed by date
  const [etoOverrides, setEtoOverrides] = useState<Record<string, string>>({});
  const [rainOverrides, setRainOverrides] = useState<Record<string, string>>({});

  // Manual mode rows
  const [manualDays, setManualDays] = useState<DayRow[]>([
    { id: newId(), label: "Day 1", eto: "", rain: "" },
    { id: newId(), label: "Day 2", eto: "", rain: "" },
    { id: newId(), label: "Day 3", eto: "", rain: "" },
  ]);

  const forecastQuery = useQuery({
    queryKey: ["irrigation-forecast", selectedVineyardId, duration],
    queryFn: () =>
      selectedVineyardId
        ? fetchIrrigationForecast(selectedVineyardId, duration)
        : Promise.resolve({ available: false, reason: "no_coords" } as const),
    enabled: !!selectedVineyardId && mode === "forecast",
    staleTime: 1000 * 60 * 30,
  });

  // Auto-switch to manual if forecast clearly unavailable for this vineyard
  useEffect(() => {
    if (mode === "forecast" && forecastQuery.data && !forecastQuery.data.available) {
      // leave on forecast tab so the user sees the message; they can switch
    }
  }, [forecastQuery.data, mode]);

  const updateSetting = <K extends keyof IrrigationSettings>(k: K, v: string) => {
    const num = parseFloat(v);
    setSettings((s) => ({ ...s, [k]: Number.isFinite(num) ? num : 0 }));
  };

  const forecastDays: ForecastDay[] = useMemo(() => {
    if (mode !== "forecast" || !forecastQuery.data?.available) return [];
    return forecastQuery.data.forecast.days.map((d) => {
      const etoOv = etoOverrides[d.date];
      const rainOv = rainOverrides[d.date];
      const eto = etoOv != null && etoOv !== "" ? parseFloat(etoOv) : d.forecastEToMm;
      const rain = rainOv != null && rainOv !== "" ? parseFloat(rainOv) : d.forecastRainMm;
      return {
        date: d.date,
        forecastEToMm: Number.isFinite(eto) ? eto : 0,
        forecastRainMm: Number.isFinite(rain) ? rain : 0,
      };
    });
  }, [mode, forecastQuery.data, etoOverrides, rainOverrides]);

  const manualForecastDays: ForecastDay[] = useMemo(() => {
    return manualDays
      .map((d) => ({
        date: d.label || "Day",
        forecastEToMm: parseFloat(d.eto),
        forecastRainMm: parseFloat(d.rain) || 0,
      }))
      .filter((d) => Number.isFinite(d.forecastEToMm));
  }, [manualDays]);

  const activeDays = mode === "forecast" ? forecastDays : manualForecastDays;

  const validation = useMemo(() => {
    if (!activeDays.length) {
      return mode === "forecast"
        ? "Forecast not loaded yet — load a forecast or switch to Manual mode."
        : "Add at least one forecast day with an ETo value.";
    }
    if (settings.irrigationApplicationRateMmPerHour <= 0) {
      return "Enter an irrigation application rate greater than 0 mm/hr.";
    }
    return null;
  }, [activeDays, settings, mode]);

  const result = useMemo(() => {
    if (validation) return null;
    const recent = parseFloat(recentRain) || 0;
    return calculateIrrigation(activeDays, settings, recent);
  }, [activeDays, settings, recentRain, validation]);

  const interpretation = interpretRecommendation(result);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Irrigation Advisor</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Irrigation Advisor estimates irrigation requirements from forecast ETo, rainfall, crop
          coefficient, irrigation efficiency, and your irrigation application rate.
        </p>
      </div>

      {/* Recommendation summary */}
      <Card className={`border ${STATUS_STYLES[interpretation.status]}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-lg">{interpretation.headline}</CardTitle>
              <CardDescription className="mt-1">{interpretation.detail}</CardDescription>
            </div>
            <Badge variant="outline" className={STATUS_STYLES[interpretation.status]}>
              {interpretation.label}
            </Badge>
          </div>
        </CardHeader>
        {result && (
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <Stat label="Forecast crop use" value={`${fmt(result.forecastCropUseMm)} mm`} />
            <Stat
              label="Forecast effective rain"
              value={`${fmt(result.forecastEffectiveRainMm)} mm`}
            />
            <Stat label="Recent rain offset" value={`${fmt(result.recentActualRainMm)} mm`} />
            <Stat label="Net deficit" value={`${fmt(result.netDeficitMm)} mm`} />
            <Stat label="Gross irrigation required" value={`${fmt(result.grossIrrigationMm)} mm`} />
            <Stat
              label="Application rate used"
              value={`${fmt(settings.irrigationApplicationRateMmPerHour)} mm/hr`}
            />
            <Stat
              label="Recommended duration"
              value={formatHoursMinutes(result.recommendedIrrigationMinutes)}
              highlight
            />
          </CardContent>
        )}
        {validation && (
          <CardContent>
            <p className="text-sm text-muted-foreground">{validation}</p>
          </CardContent>
        )}
      </Card>

      <Tabs value={mode} onValueChange={(v) => setMode(v as "forecast" | "manual")}>
        <TabsList>
          <TabsTrigger value="forecast">
            <CloudSun className="h-4 w-4 mr-1" /> Forecast Advisor
          </TabsTrigger>
          <TabsTrigger value="manual">
            <Pencil className="h-4 w-4 mr-1" /> Manual Calculator
          </TabsTrigger>
        </TabsList>

        <TabsContent value="forecast" className="mt-4">
          <ForecastSection
            duration={duration}
            setDuration={setDuration}
            query={forecastQuery}
            etoOverrides={etoOverrides}
            rainOverrides={rainOverrides}
            setEtoOverride={(date, v) => setEtoOverrides((p) => ({ ...p, [date]: v }))}
            setRainOverride={(date, v) => setRainOverrides((p) => ({ ...p, [date]: v }))}
            resetOverrides={() => {
              setEtoOverrides({});
              setRainOverrides({});
            }}
          />
        </TabsContent>

        <TabsContent value="manual" className="mt-4">
          <ManualSection days={manualDays} setDays={setManualDays} />
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>
            Crop, irrigation system, and adjustment values. These will use saved vineyard/block
            defaults where available.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { k: "cropCoefficientKc", label: "Crop coefficient Kc", step: "0.01" },
            { k: "irrigationApplicationRateMmPerHour", label: "Application rate (mm/hr)", step: "0.1" },
            { k: "irrigationEfficiencyPercent", label: "Irrigation efficiency (%)", step: "1" },
            { k: "rainfallEffectivenessPercent", label: "Rainfall effectiveness (%)", step: "1" },
            { k: "replacementPercent", label: "Replacement (%)", step: "1" },
            { k: "soilMoistureBufferMm", label: "Soil moisture buffer (mm)", step: "0.1" },
          ].map((f) => (
            <div key={f.k} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              <Input
                type="number"
                step={f.step}
                value={String(settings[f.k as keyof IrrigationSettings])}
                onChange={(e) => updateSetting(f.k as keyof IrrigationSettings, e.target.value)}
                className="h-9"
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label className="text-xs">Recent actual rain (mm)</Label>
            <Input
              type="number"
              step="0.1"
              value={recentRain}
              onChange={(e) => setRecentRain(e.target.value)}
              className="h-9"
            />
          </div>
        </CardContent>
      </Card>

      {result && activeDays.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Daily breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>ETo</TableHead>
                  <TableHead>Rain</TableHead>
                  <TableHead>Crop use</TableHead>
                  <TableHead>Effective rain</TableHead>
                  <TableHead>Daily deficit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.dailyBreakdown.map((d, i) => (
                  <TableRow key={i}>
                    <TableCell>{formatDateLabel(d.date)}</TableCell>
                    <TableCell>{fmt(d.forecastEToMm)} mm</TableCell>
                    <TableCell>{fmt(d.forecastRainMm)} mm</TableCell>
                    <TableCell>{fmt(d.cropUseMm)} mm</TableCell>
                    <TableCell>{fmt(d.effectiveRainMm)} mm</TableCell>
                    <TableCell>{fmt(d.dailyDeficitMm)} mm</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The advisor estimates crop water use from ETo × crop coefficient, subtracts effective
          rainfall, then adjusts for recent rain and soil moisture buffer. The final irrigation
          target is adjusted for replacement percentage and irrigation efficiency before converting
          millimetres required into irrigation hours. Forecast rain under 2 mm is treated as zero
          effective rainfall.
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-md border p-3 ${
        highlight ? "bg-background border-primary/40" : "bg-background/60"
      }`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 font-semibold ${highlight ? "text-lg text-primary" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function formatDateLabel(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function ForecastSection({
  duration,
  setDuration,
  query,
  etoOverrides,
  rainOverrides,
  setEtoOverride,
  setRainOverride,
  resetOverrides,
}: {
  duration: number;
  setDuration: (n: number) => void;
  query: ReturnType<typeof useQuery<any>>;
  etoOverrides: Record<string, string>;
  rainOverrides: Record<string, string>;
  setEtoOverride: (date: string, v: string) => void;
  setRainOverride: (date: string, v: string) => void;
  resetOverrides: () => void;
}) {
  const data = query.data;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Forecast days</CardTitle>
            <CardDescription>
              {data?.available
                ? `Source: ${data.forecast.source}${
                    data.forecast.coordsSource ? ` · ${data.forecast.coordsSource}` : ""
                  }`
                : "Daily forecast based on your vineyard location."}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
              <SelectTrigger className="w-[120px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Loading forecast…</p>
        )}
        {data && !data.available && (
          <Alert>
            <AlertTitle>Forecast unavailable</AlertTitle>
            <AlertDescription>
              {data.reason === "no_coords"
                ? "Vineyard location is not set. Add coordinates in Weather settings or use Manual mode."
                : data.reason === "no_data"
                ? "No forecast data was returned for this location. Try Manual mode."
                : "Forecast could not be loaded right now. Try again or use Manual mode."}
            </AlertDescription>
          </Alert>
        )}
        {data?.available && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>ETo (mm)</TableHead>
                  <TableHead>Rain (mm)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.forecast.days.map((d: ForecastDay) => (
                  <TableRow key={d.date}>
                    <TableCell className="whitespace-nowrap">{formatDateLabel(d.date)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder={d.forecastEToMm.toFixed(2)}
                        value={etoOverrides[d.date] ?? ""}
                        onChange={(e) => setEtoOverride(d.date, e.target.value)}
                        className="h-9 max-w-[120px]"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder={d.forecastRainMm.toFixed(1)}
                        value={rainOverrides[d.date] ?? ""}
                        onChange={(e) => setRainOverride(d.date, e.target.value)}
                        className="h-9 max-w-[120px]"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button variant="ghost" size="sm" onClick={resetOverrides}>
              Reset overrides
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ManualSection({
  days,
  setDays,
}: {
  days: DayRow[];
  setDays: React.Dispatch<React.SetStateAction<DayRow[]>>;
}) {
  const updateDay = (id: string, field: "label" | "eto" | "rain", v: string) => {
    setDays((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: v } : r)));
  };
  const addDay = () =>
    setDays((rows) => [
      ...rows,
      { id: newId(), label: `Day ${rows.length + 1}`, eto: "", rain: "" },
    ]);
  const removeDay = (id: string) => setDays((rows) => rows.filter((r) => r.id !== id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual forecast days</CardTitle>
        <CardDescription>Enter ETo (mm) and forecast rain (mm) for each day.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>ETo (mm)</TableHead>
              <TableHead>Rain (mm)</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <Input
                    value={d.label}
                    onChange={(e) => updateDay(d.id, "label", e.target.value)}
                    className="h-9 max-w-[140px]"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.1"
                    value={d.eto}
                    onChange={(e) => updateDay(d.id, "eto", e.target.value)}
                    className="h-9 max-w-[120px]"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.1"
                    value={d.rain}
                    onChange={(e) => updateDay(d.id, "rain", e.target.value)}
                    className="h-9 max-w-[120px]"
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeDay(d.id)}
                    disabled={days.length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Button variant="outline" size="sm" onClick={addDay}>
          <Plus className="h-4 w-4" /> Add day
        </Button>
      </CardContent>
    </Card>
  );
}
