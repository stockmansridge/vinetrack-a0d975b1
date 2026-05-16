import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, RefreshCw, CloudSun, Pencil, Save, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/ios-supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  calculateIrrigationRateFromInfrastructure,
  calculateVineyardIrrigationRateFromBlocks,
  resolveIrrigationRate,
  saveVineyardIrrigationRate,
  savePaddockIrrigationRate,
  describeRateSource,
  type IrrigationRateSource,
} from "@/lib/calculations/irrigationDefaults";
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
import { fetchIrrigationForecast, type IrrigationForecastResult } from "@/lib/calculations/irrigationForecast";
import {
  formatHoursMinutes,
  interpretRecommendation,
  isDormantSeason,
  type AdvisorStatus,
} from "@/lib/calculations/irrigationAdvisor";
import { parsePolygonPoints, polygonAreaHectares } from "@/lib/paddockGeometry";
import {
  useVineyardSoilProfiles,
  useVineyardDefaultSoilProfile,
  deriveSoilBufferMm,
  aggregateConservativeBuffer,
} from "@/lib/soilProfiles";
import { useGrapeVarieties } from "@/lib/varietyResolver";
import { useVineyardGrapeVarieties } from "@/lib/varietyCatalog";
import { buildWizardItems } from "@/lib/irrigationWizard";
import AdvisorWizard from "@/components/irrigation/AdvisorWizard";
import VarietyResolverDiagnostics from "@/components/irrigation/VarietyResolverDiagnostics";
import AdvisorConfigSheet from "@/components/irrigation/AdvisorConfigSheet";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import {
  useRecentRainResolution,
  useRecentRainLookbackHours,
  useSetRecentRainLookbackHours,
  describeLookback,
  type RecentRainResolution,
} from "@/lib/recentRainResolver";

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
  dormant: "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700/60",
};

const FIELD_HELP: Record<string, string> = {
  cropCoefficientKc:
    "Adjusts reference ETo to better match vine water use. Lower values represent lower vine water use; higher values represent larger canopy and higher demand.",
  irrigationApplicationRateMmPerHour:
    "How many millimetres of water your irrigation system applies per hour. This converts irrigation depth into irrigation time.",
  irrigationEfficiencyPercent:
    "Allows for losses in the irrigation system and soil. Lower efficiency means more water must be applied to achieve the target amount.",
  rainfallEffectivenessPercent:
    "Estimates how much rain is useful to the vines after losses such as runoff, evaporation, canopy interception, or shallow wetting.",
  replacementPercent:
    "The percentage of the calculated deficit you want to replace. 100% replaces the full calculated deficit.",
  soilMoistureBufferMm:
    "An allowance for water already available in the soil. This reduces the irrigation requirement.",
  recentRain:
    "Rain that has already fallen recently. The Advisor uses this to reduce the irrigation requirement.",
  eto:
    "Reference evapotranspiration. It estimates water loss from a reference crop through evaporation and transpiration. Vine water use is estimated by multiplying ETo by the crop coefficient.",
};

function InfoTip({ text }: { text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="More information"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72 text-xs leading-relaxed">
        {text}
      </PopoverContent>
    </Popover>
  );
}

export default function IrrigationCalculatorPage() {
  const { selectedVineyardId } = useVineyard();
  const { toast } = useToast();
  const [mode, setMode] = useState<"forecast" | "manual">("forecast");
  const [duration, setDuration] = useState<number>(5);
  const [selectedPaddockId, setSelectedPaddockId] = useState<string>("__vineyard__");

  // Settings (shared between modes)
  const [settings, setSettings] = useState<IrrigationSettings>(DEFAULT_IRRIGATION_SETTINGS);
  const [recentRain, setRecentRain] = useState<string>("0");
  const [recentRainUserEdited, setRecentRainUserEdited] = useState<boolean>(false);
  const [recentRainLookbackHours, setRecentRainLookbackHours] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("vt_recent_rain_lookback_hours"));
      return [24, 48, 168, 336].includes(v) ? v : 48;
    } catch {
      return 48;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("vt_recent_rain_lookback_hours", String(recentRainLookbackHours));
    } catch {}
  }, [recentRainLookbackHours]);

  // Auto-resolve recent rain from rainfall_daily / get_daily_rainfall.
  const recentRainQuery = useRecentRainResolution(
    selectedVineyardId,
    recentRainLookbackHours,
  );
  const recentRainResolution: RecentRainResolution | undefined = recentRainQuery.data;
  // Auto-fill the input from the resolver unless the user has edited it manually.
  useEffect(() => {
    if (recentRainUserEdited) return;
    if (!recentRainResolution) return;
    setRecentRain(String(recentRainResolution.totalMm));
  }, [recentRainResolution, recentRainUserEdited]);

  const handleRecentRainChange = (v: string) => {
    setRecentRainUserEdited(true);
    setRecentRain(v);
  };
  const resetRecentRainToAuto = () => {
    setRecentRainUserEdited(false);
    if (recentRainResolution) setRecentRain(String(recentRainResolution.totalMm));
  };
  const [rateSource, setRateSource] = useState<IrrigationRateSource>("none");

  // Shared soil profiles (iOS Supabase)
  const { data: vineyardSoilProfiles = [] } = useVineyardSoilProfiles(selectedVineyardId);
  const { data: vineyardDefaultSoil } = useVineyardDefaultSoilProfile(selectedVineyardId);
  const { data: grapeVarieties } = useGrapeVarieties(selectedVineyardId);
  const { data: varietyCatalog } = useVineyardGrapeVarieties(selectedVineyardId);
  const { isAdmin: isSystemAdmin } = useIsSystemAdmin();

  // Forecast mode: per-day overrides keyed by date
  const [etoOverrides, setEtoOverrides] = useState<Record<string, string>>({});
  const [rainOverrides, setRainOverrides] = useState<Record<string, string>>({});

  // Manual mode rows
  const [manualDays, setManualDays] = useState<DayRow[]>([
    { id: newId(), label: "Day 1", eto: "", rain: "" },
    { id: newId(), label: "Day 2", eto: "", rain: "" },
    { id: newId(), label: "Day 3", eto: "", rain: "" },
  ]);

  const forecastQuery = useQuery<IrrigationForecastResult>({
    queryKey: ["irrigation-forecast", selectedVineyardId, duration],
    queryFn: async () =>
      selectedVineyardId
        ? fetchIrrigationForecast(selectedVineyardId, duration)
        : ({ available: false, reason: "no_coords" } as IrrigationForecastResult),
    enabled: !!selectedVineyardId,
    staleTime: 1000 * 60 * 30,
  });

  // Paddocks for the scope selector. Pull infrastructure too so we can
  // compute mm/hr from row spacing × emitter spacing × flow per emitter.
  const paddocksQuery = useQuery({
    queryKey: ["irrigation-paddocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id, name, row_width, emitter_spacing, flow_per_emitter, polygon_points, variety_allocations")
        .eq("vineyard_id", selectedVineyardId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        name: string | null;
        row_width: number | null;
        emitter_spacing: number | null;
        flow_per_emitter: number | null;
        polygon_points: unknown;
        variety_allocations: unknown;
      }>;
    },
  });

  const paddockOptions = useMemo(() => {
    return (paddocksQuery.data ?? []).map((paddock) => {
      const computedRate = calculateIrrigationRateFromInfrastructure({
        rowSpacingMetres: paddock.row_width,
        emitterSpacingMetres: paddock.emitter_spacing,
        emitterFlowLitresPerHour: paddock.flow_per_emitter,
      });
      const areaHectares = polygonAreaHectares(parsePolygonPoints(paddock.polygon_points));

      return {
        ...paddock,
        areaHectares,
        computedRate,
      };
    });
  }, [paddocksQuery.data]);

  const vineyardComputedFallback = useMemo(() => {
    return calculateVineyardIrrigationRateFromBlocks(
      paddockOptions.map((paddock) => ({
        paddockId: paddock.id,
        areaHectares: paddock.areaHectares,
        infrastructure: {
          rowSpacingMetres: paddock.row_width,
          emitterSpacingMetres: paddock.emitter_spacing,
          emitterFlowLitresPerHour: paddock.flow_per_emitter,
        },
      })),
    );
  }, [paddockOptions]);

  // Auto-populate application rate from the full fallback chain whenever
  // scope changes. Shared (database-backed) rates aren't available yet —
  // pass null so the resolver falls through to computed/device-saved.
  useEffect(() => {
    if (!selectedVineyardId) return;
    const paddockId = selectedPaddockId === "__vineyard__" ? null : selectedPaddockId;
    const paddock = paddockId ? paddockOptions.find((p) => p.id === paddockId) : null;
    const { rate, source } = resolveIrrigationRate({
      vineyardId: selectedVineyardId,
      paddockId,
      paddockSharedRate: null,
      vineyardSharedRate: null,
      paddockInfrastructure: paddock
        ? {
            rowSpacingMetres: paddock.row_width,
            emitterSpacingMetres: paddock.emitter_spacing,
            emitterFlowLitresPerHour: paddock.flow_per_emitter,
          }
        : null,
      vineyardPaddocks: paddockOptions.map((item) => ({
        paddockId: item.id,
        areaHectares: item.areaHectares,
        infrastructure: {
          rowSpacingMetres: item.row_width,
          emitterSpacingMetres: item.emitter_spacing,
          emitterFlowLitresPerHour: item.flow_per_emitter,
        },
      })),
    });
    if (rate !== null) {
      setSettings((s) => ({ ...s, irrigationApplicationRateMmPerHour: rate }));
      setRateSource(source);
    } else {
      setSettings((s) => ({ ...s, irrigationApplicationRateMmPerHour: 0 }));
      setRateSource("none");
    }
  }, [selectedVineyardId, selectedPaddockId, paddockOptions]);

  // Soil profile lookups indexed by paddock id, plus auto-buffer derivation.
  const soilByPaddock = useMemo(() => {
    const m = new Map<string, typeof vineyardSoilProfiles[number]>();
    for (const p of vineyardSoilProfiles) {
      if (p?.paddock_id) m.set(p.paddock_id as string, p);
    }
    return m;
  }, [vineyardSoilProfiles]);

  useEffect(() => {
    if (selectedPaddockId === "__vineyard__") {
      const buf =
        deriveSoilBufferMm(vineyardDefaultSoil ?? null) ??
        aggregateConservativeBuffer(vineyardSoilProfiles);
      if (buf != null && Number.isFinite(buf)) {
        setSettings((s) => ({ ...s, soilMoistureBufferMm: Number(buf.toFixed(1)) }));
      }
    } else {
      const profile = soilByPaddock.get(selectedPaddockId) ?? null;
      const buf = deriveSoilBufferMm(profile);
      if (buf != null && Number.isFinite(buf)) {
        setSettings((s) => ({ ...s, soilMoistureBufferMm: Number(buf.toFixed(1)) }));
      }
    }
  }, [selectedPaddockId, vineyardDefaultSoil, vineyardSoilProfiles, soilByPaddock]);

  const wizardItems = useMemo(() => {
    return buildWizardItems({
      scope: selectedPaddockId === "__vineyard__" ? "vineyard" : "paddock",
      selectedPaddockId: selectedPaddockId === "__vineyard__" ? null : selectedPaddockId,
      paddocks: paddockOptions.map((p) => ({
        id: p.id,
        name: p.name,
        variety_allocations: (p as any).variety_allocations,
        infrastructure: {
          rowSpacingMetres: p.row_width,
          emitterSpacingMetres: p.emitter_spacing,
          emitterFlowLitresPerHour: p.flow_per_emitter,
        },
        soilProfile: soilByPaddock.get(p.id) ?? null,
        areaHectares: p.areaHectares,
      })),
      grapeVarieties,
      varietyCatalog,
      vineyardSoilProfile: vineyardDefaultSoil ?? null,
      forecastAvailable: !!forecastQuery.data?.available,
      forecastSource: forecastQuery.data?.available
        ? forecastQuery.data.forecast.source
        : null,
      hasRecentRainSet: true, // resolved automatically — never a wizard blocker
      hasGrowthStage: true, // growth stage UI is not yet on portal; treat as set
      hasEfficiencySettings: true,
    });
  }, [
    selectedPaddockId,
    paddockOptions,
    soilByPaddock,
    grapeVarieties,
    varietyCatalog,
    vineyardDefaultSoil,
    forecastQuery.data,
    recentRain,
  ]);


  const updateSetting = <K extends keyof IrrigationSettings>(k: K, v: string) => {
    const num = parseFloat(v);
    setSettings((s) => ({ ...s, [k]: Number.isFinite(num) ? num : 0 }));
    if (k === "irrigationApplicationRateMmPerHour") {
      setRateSource("manual");
    }
  };

  const currentRate = settings.irrigationApplicationRateMmPerHour;
  const canSave = Number.isFinite(currentRate) && currentRate > 0;
  const hasAnyComputedBlockRate = paddockOptions.some((paddock) => (paddock.computedRate ?? 0) > 0);

  const handleSaveVineyard = () => {
    if (!selectedVineyardId) return;
    if (!canSave) {
      toast({
        title: "Invalid value",
        description: "Enter an irrigation application rate greater than 0 mm/hr.",
        variant: "destructive",
      });
      return;
    }
    saveVineyardIrrigationRate(selectedVineyardId, currentRate);
    if (selectedPaddockId === "__vineyard__") setRateSource("vineyard-device");
    toast({ title: "Saved on this device." });
  };

  const handleSavePaddock = () => {
    if (selectedPaddockId === "__vineyard__") return;
    if (!canSave) {
      toast({
        title: "Invalid value",
        description: "Enter an irrigation application rate greater than 0 mm/hr.",
        variant: "destructive",
      });
      return;
    }
    savePaddockIrrigationRate(selectedPaddockId, currentRate);
    setRateSource("paddock-device");
    toast({ title: "Saved on this device." });
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
  const appRateMissing = settings.irrigationApplicationRateMmPerHour <= 0;
  const hasDays = activeDays.length > 0;
  const recent = parseFloat(recentRain) || 0;

  // Always compute breakdown/deficits when we have days (uses temp rate when missing).
  const preview = useMemo(() => {
    if (!hasDays) return null;
    const ratedSettings = appRateMissing
      ? { ...settings, irrigationApplicationRateMmPerHour: 1 }
      : settings;
    return calculateIrrigation(activeDays, ratedSettings, recent);
  }, [activeDays, settings, recent, hasDays, appRateMissing]);

  // Final result only when app rate is set.
  const result = !appRateMissing && hasDays ? preview : null;
  const dormant = useMemo(() => isDormantSeason(), []);

  const interpretation = useMemo(() => {
    if (forecastQuery.isLoading && mode === "forecast" && !hasDays) {
      return {
        status: "none" as const,
        label: "Loading forecast",
        headline: "Loading forecast…",
        detail: "Fetching ETo and rainfall for your vineyard location.",
      };
    }
    if (mode === "forecast" && !hasDays && forecastQuery.data && forecastQuery.data.available === false) {
      const reason = forecastQuery.data.reason;
      return {
        status: "none" as const,
        label: "Forecast unavailable",
        headline:
          reason === "no_coords"
            ? "Forecast unavailable because this vineyard does not have a weather station or location configured."
            : "Forecast data could not be loaded. You can enter forecast values manually.",
        detail: "Switch to Manual Calculator to enter ETo and rainfall by hand.",
      };
    }
    if (hasDays && appRateMissing) {
      return {
        status: "none" as const,
        label: "Application rate needed",
        headline:
          "Forecast loaded. Enter your irrigation application rate in mm/hr to calculate the recommended irrigation time.",
        detail: "All other forecast figures are shown below.",
      };
    }
    return interpretRecommendation(result, { dormant });
  }, [forecastQuery.isLoading, forecastQuery.data, mode, hasDays, appRateMissing, result, dormant]);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Irrigation Advisor</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Irrigation Advisor estimates irrigation requirements from forecast ETo, rainfall, crop
            coefficient, irrigation efficiency, and your irrigation application rate.
          </p>
        </div>
        <AdvisorConfigSheet
          recentRain={
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-0.5">
                <div>
                  <span className="text-muted-foreground">Recent rain used:</span>{" "}
                  <span className="font-medium">{fmt(parseFloat(recentRain) || 0)} mm</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Source:</span>{" "}
                  <span>
                    {recentRainUserEdited
                      ? "Manual override"
                      : recentRainResolution?.sourceLabel ?? "Loading…"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Lookback:</span>{" "}
                  <span>{describeLookback(recentRainLookbackHours)}</span>
                </div>
                {recentRainResolution?.status === "error" && (
                  <div className="text-amber-700 dark:text-amber-300 mt-1">
                    Rainfall source query failed — using 0 mm fallback.
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Recent actual rain (mm)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={recentRain}
                  onChange={(e) => handleRecentRainChange(e.target.value)}
                  className="h-9"
                />
                {recentRainUserEdited && (
                  <button
                    type="button"
                    className="text-[11px] text-primary underline"
                    onClick={resetRecentRainToAuto}
                  >
                    Reset to auto-resolved value
                  </button>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Lookback window</Label>
                <Select
                  value={String(recentRainLookbackHours)}
                  onValueChange={(v) => setRecentRainLookbackHours(Number(v))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24">24 hr</SelectItem>
                    <SelectItem value="48">48 hr</SelectItem>
                    <SelectItem value="168">7 days</SelectItem>
                    <SelectItem value="336">14 days</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Lookback is session-only on the portal until the shared vineyard-level setting ships in Supabase.
                </p>
              </div>
            </div>
          }
          calculationAssumptions={
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { k: "cropCoefficientKc", label: "Crop coefficient Kc", step: "0.01" },
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
            </div>
          }
          blockSettings={
            <p className="text-xs text-muted-foreground">
              Application rates and emitter details are managed per block on the Block detail page.
            </p>
          }
          soilProfile={
            <p className="text-xs text-muted-foreground">
              Soil profiles are managed per block in the Soil section of each Block detail page.
            </p>
          }
        />
      </div>

      <AdvisorWizard items={wizardItems} />
      {isSystemAdmin && (
        <VarietyResolverDiagnostics
          paddocks={paddockOptions.map((p) => ({
            id: p.id,
            name: p.name,
            variety_allocations: (p as any).variety_allocations,
          }))}
          grapeVarieties={grapeVarieties}
          varietyCatalog={varietyCatalog}
        />
      )}
      {/* Scope selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Apply to</CardTitle>
          <CardDescription>
            Choose whole vineyard or a specific block. Saved application rates are remembered on
            this device for next time.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[1fr_auto] items-end">
          <div className="space-y-1">
            <Label className="text-xs">Scope</Label>
            <Select value={selectedPaddockId} onValueChange={setSelectedPaddockId}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__vineyard__">
                  {vineyardComputedFallback?.rate
                    ? `Whole vineyard${vineyardComputedFallback.source === "vineyard-computed-average" ? ` · Avg ${fmt(vineyardComputedFallback.rate)} mm/hr` : ` · ${fmt(vineyardComputedFallback.rate)} mm/hr`}`
                    : "Whole vineyard"}
                </SelectItem>
                {paddockOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name || "Unnamed block"}
                    {p.computedRate ? ` · ${fmt(p.computedRate)} mm/hr` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPaddockId === "__vineyard__" && !vineyardComputedFallback?.rate && hasAnyComputedBlockRate ? (
              <p className="text-xs text-muted-foreground">Select a block to use its calculated irrigation rate.</p>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {describeRateSource(rateSource)}
          </div>
        </CardContent>
        {canSave && (
          <CardContent className="pt-0 space-y-2">
            <div className="flex flex-wrap gap-2">
              {selectedPaddockId === "__vineyard__" ? (
                <Button size="sm" onClick={handleSaveVineyard}>
                  <Save className="h-4 w-4 mr-1" /> Save on this device
                </Button>
              ) : (
                <>
                  <Button size="sm" onClick={handleSavePaddock}>
                    <Save className="h-4 w-4 mr-1" /> Save for this block on this device
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleSaveVineyard}>
                    Also save as vineyard rate on this device
                  </Button>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              This value will be remembered on this browser. Shared saving across devices is coming
              soon.
            </p>
          </CardContent>
        )}
      </Card>

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
          {selectedPaddockId === "__vineyard__" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Runtime is estimated per block using the vineyard average rate. Select an individual block for a more accurate runtime.
            </p>
          )}
          {!recentRainUserEdited &&
            recentRainResolution &&
            recentRainResolution.status !== "resolved" && (
              <p className="mt-2 text-xs text-muted-foreground">
                No recent rain data was available for the selected lookback period
                ({describeLookback(recentRainLookbackHours)}), so 0 mm was used.
              </p>
            )}
        </CardHeader>
        {preview && (
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <Stat label="Forecast crop use" value={`${fmt(preview.forecastCropUseMm)} mm`} />
            <Stat
              label="Forecast effective rain"
              value={`${fmt(preview.forecastEffectiveRainMm)} mm`}
            />
            <Stat label="Recent rain offset" value={`${fmt(preview.recentActualRainMm)} mm`} />
            <Stat label="Net deficit" value={`${fmt(preview.netDeficitMm)} mm`} />
            <Stat
              label="Gross irrigation required"
              value={result ? `${fmt(result.grossIrrigationMm)} mm` : "—"}
            />
            <Stat
              label="Application rate used"
              value={
                appRateMissing
                  ? "Not set"
                  : `${fmt(settings.irrigationApplicationRateMmPerHour)} mm/hr`
              }
            />
            <Stat
              label={dormant ? "Calculated irrigation equivalent" : "Recommended duration"}
              value={result ? formatHoursMinutes(result.recommendedIrrigationMinutes) : "—"}
              highlight={!dormant}
            />
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
              <Label className="text-xs flex items-center gap-1">
                {f.label}
                {FIELD_HELP[f.k] ? <InfoTip text={FIELD_HELP[f.k]} /> : null}
              </Label>
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
            <Label className="text-xs flex items-center gap-1">
              Recent actual rain (mm)
              <InfoTip text={FIELD_HELP.recentRain} />
            </Label>
            <Input
              type="number"
              step="0.1"
              value={recentRain}
              onChange={(e) => handleRecentRainChange(e.target.value)}
              className="h-9"
            />
          </div>
        </CardContent>
      </Card>

      {preview && activeDays.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Daily breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>
                    <span className="inline-flex items-center gap-1">
                      ETo <InfoTip text={FIELD_HELP.eto} />
                    </span>
                  </TableHead>
                  <TableHead>Rain</TableHead>
                  <TableHead>Crop use</TableHead>
                  <TableHead>Effective rain</TableHead>
                  <TableHead>Daily deficit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.dailyBreakdown.map((d, i) => (
                  <TableRow key={i}>
                    <TableCell>{formatDateLabel(d.date)}</TableCell>
                    <TableCell>{fmt(d.forecastEToMm)} mm</TableCell>
                    <TableCell className={d.forecastRainMm > 0 ? "text-blue-600 font-medium dark:text-blue-400" : ""}>
                      {fmt(d.forecastRainMm)} mm
                    </TableCell>
                    <TableCell>{fmt(d.cropUseMm)} mm</TableCell>
                    <TableCell className={d.effectiveRainMm > 0 ? "text-blue-600 font-medium dark:text-blue-400" : ""}>
                      {fmt(d.effectiveRainMm)} mm
                    </TableCell>
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
  query: ReturnType<typeof useQuery<IrrigationForecastResult>>;
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
        {data && data.available === false && (
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
                  <TableHead>
                    <span className="inline-flex items-center gap-1">
                      ETo (mm) <InfoTip text={FIELD_HELP.eto} />
                    </span>
                  </TableHead>
                  <TableHead>Rain (mm)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.forecast.days.map((d: ForecastDay) => {
                  const effectiveRain =
                    rainOverrides[d.date] != null && rainOverrides[d.date] !== ""
                      ? parseFloat(rainOverrides[d.date])
                      : d.forecastRainMm;
                  const rainIsWet = Number.isFinite(effectiveRain) && effectiveRain > 0;
                  return (
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
                          className={`h-9 max-w-[120px] ${rainIsWet ? "text-blue-600 font-medium dark:text-blue-400" : ""}`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
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
