import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  calculateIrrigation,
  DEFAULT_IRRIGATION_SETTINGS,
  type ForecastDay,
  type IrrigationSettings,
} from "@/lib/calculations/irrigation";

interface DayRow {
  id: string;
  label: string;
  eto: string;
  rain: string;
}

const makeRow = (i: number): DayRow => ({
  id: crypto.randomUUID(),
  label: `Day ${i + 1}`,
  eto: "",
  rain: "",
});

const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "—");

export default function IrrigationCalculatorPage() {
  const [days, setDays] = useState<DayRow[]>(() => Array.from({ length: 3 }, (_, i) => makeRow(i)));
  const [settings, setSettings] = useState<IrrigationSettings>(DEFAULT_IRRIGATION_SETTINGS);
  const [recentRain, setRecentRain] = useState<string>("0");

  const update = <K extends keyof IrrigationSettings>(k: K, v: string) => {
    const num = parseFloat(v);
    setSettings((s) => ({ ...s, [k]: Number.isFinite(num) ? num : 0 }));
  };

  const updateDay = (id: string, field: "label" | "eto" | "rain", v: string) => {
    setDays((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: v } : r)));
  };

  const addDay = () => setDays((rows) => [...rows, makeRow(rows.length)]);
  const removeDay = (id: string) => setDays((rows) => rows.filter((r) => r.id !== id));

  const { result, error } = useMemo(() => {
    const forecast: ForecastDay[] = days
      .map((d) => ({
        date: d.label || "Day",
        forecastEToMm: parseFloat(d.eto),
        forecastRainMm: parseFloat(d.rain) || 0,
      }))
      .filter((d) => Number.isFinite(d.forecastEToMm));

    if (!forecast.length) {
      return { result: null, error: "Add at least one forecast day with an ETo value." };
    }
    if (settings.irrigationApplicationRateMmPerHour <= 0) {
      return { result: null, error: "Enter an irrigation application rate greater than 0 mm/hr." };
    }

    const recent = parseFloat(recentRain) || 0;
    return { result: calculateIrrigation(forecast, settings, recent), error: null };
  }, [days, settings, recentRain]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Irrigation Advisor</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Irrigation Advisor estimates irrigation requirements from forecast ETo, rainfall, crop
          coefficient, irrigation efficiency, and your irrigation application rate.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Forecast days</CardTitle>
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
                        className="h-9"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.1"
                        value={d.eto}
                        onChange={(e) => updateDay(d.id, "eto", e.target.value)}
                        className="h-9"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.1"
                        value={d.rain}
                        onChange={(e) => updateDay(d.id, "rain", e.target.value)}
                        className="h-9"
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

        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>Crop, irrigation system, and adjustment values.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
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
                  onChange={(e) => update(f.k as keyof IrrigationSettings, e.target.value)}
                  className="h-9"
                />
              </div>
            ))}
            <div className="space-y-1 col-span-2">
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recommendation</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                <Stat label="Forecast crop use" value={`${fmt(result.forecastCropUseMm)} mm`} />
                <Stat label="Forecast effective rain" value={`${fmt(result.forecastEffectiveRainMm)} mm`} />
                <Stat label="Recent actual rain offset" value={`${fmt(result.recentActualRainMm)} mm`} />
                <Stat label="Net deficit" value={`${fmt(result.netDeficitMm)} mm`} />
                <Stat label="Gross irrigation required" value={`${fmt(result.grossIrrigationMm)} mm`} />
                <Stat
                  label="Recommended irrigation"
                  value={`${fmt(result.recommendedIrrigationHours, 2)} hrs (${result.recommendedIrrigationMinutes} min)`}
                  highlight
                />
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Daily breakdown</h3>
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
                        <TableCell>{d.date}</TableCell>
                        <TableCell>{fmt(d.forecastEToMm)} mm</TableCell>
                        <TableCell>{fmt(d.forecastRainMm)} mm</TableCell>
                        <TableCell>{fmt(d.cropUseMm)} mm</TableCell>
                        <TableCell>{fmt(d.effectiveRainMm)} mm</TableCell>
                        <TableCell>{fmt(d.dailyDeficitMm)} mm</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The calculator estimates crop water use from ETo × crop coefficient, subtracts effective
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
    <div className={`rounded-md border p-3 ${highlight ? "bg-primary/5 border-primary/30" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 font-semibold ${highlight ? "text-primary text-lg" : ""}`}>{value}</div>
    </div>
  );
}
