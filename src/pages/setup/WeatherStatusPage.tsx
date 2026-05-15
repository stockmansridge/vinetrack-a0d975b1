import { useEffect, useMemo, useRef, useState } from "react";
import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useVineyard } from "@/context/VineyardContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Cloud,
  CloudRain,
  Droplets,
  Thermometer,
  Wind,
  Leaf,
  Check,
  X,
  Save,
  TestTube2,
  Trash2,
  Loader2,
  Copy,
  HelpCircle,
} from "lucide-react";
import {
  deleteWeatherIntegration,
  fetchLiveWeather,
  fetchWeatherStatusForVineyard,
  saveWeatherIntegration,
  testSavedDavis,
  testTypedDavis,
  type LiveWeatherResult,
  type WeatherIntegrationStatus,
  type WeatherProvider,
} from "@/lib/weatherStatusQuery";
import {
  fetchWillyWeatherStatus,
  getForecastProvider,
  setForecastProvider,
  searchWillyLocations,
  searchNearestWillyLocation,
  setWillyLocation,
  testWillyConnection,
  deleteWillyIntegration,
  type ForecastProvider,
  type WillyLocation,
  type WillyIntegrationStatus,
} from "@/lib/willyWeatherProxy";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { WillyWeatherAttribution } from "@/components/weather/WillyWeatherAttribution";

const DAVIS: WeatherProvider = "davis_weatherlink";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString();
};

export default function WeatherStatusPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["weather_status", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchWeatherStatusForVineyard(selectedVineyardId!),
  });

  const davis = data?.davis;
  const wu = data?.wunderground;

  // Caller role: prefer server-reported caller_role from RPC; fall back to
  // membership role from the vineyard context.
  const callerRole =
    davis?.caller_role ?? wu?.caller_role ?? currentRole ?? null;
  const canEdit = callerRole === "owner" || callerRole === "manager";

  const rainfallSource =
    davis?.configured && davis.is_active && davis.has_rain
      ? "Davis WeatherLink"
      : wu?.configured && wu.is_active && wu.has_rain
        ? "Weather Underground"
        : "Open-Meteo Archive (fallback)";

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[WeatherStatusPage] diagnostics", {
      selectedVineyardId,
      callerRole,
      canEdit,
      safeRpc: data?.rpcUsed,
      davisConfigured: davis?.configured ?? false,
      wundergroundConfigured: wu?.configured ?? false,
      rpcErrors: { davis: davis?.error ?? null, wunderground: wu?.error ?? null },
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Weather</h1>
        <p className="text-sm text-muted-foreground">
          Vineyard-level weather settings. Changes apply to all app users in this vineyard.
        </p>
      </div>

      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        Production data. Weather credentials are stored securely server-side
        and are never displayed in the portal or app.
      </div>

      {isLoading && (
        <Card className="p-6 text-center text-muted-foreground">Loading weather status…</Card>
      )}
      {error && (
        <Card className="p-6 text-center text-destructive">{(error as Error).message}</Card>
      )}

      {data && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <SourceCard
              icon={<Cloud className="h-4 w-4" />}
              label="Forecast source"
              value="Open-Meteo Forecast"
              hint="App-level default for all vineyards."
            />
            <SourceCard
              icon={<CloudRain className="h-4 w-4" />}
              label="Rainfall actuals source"
              value={rainfallSource}
              hint={
                rainfallSource.startsWith("Open-Meteo")
                  ? "No active station configured — using archive fallback."
                  : "From your configured weather station."
              }
            />
            <SourceCard
              icon={<Droplets className="h-4 w-4" />}
              label="Observation source"
              value={
                davis?.configured && davis.is_active
                  ? "Davis WeatherLink"
                  : wu?.configured && wu.is_active
                    ? "Weather Underground"
                    : "None"
              }
              hint="Live in-vineyard observations."
            />
            <SourceCard
              icon={<Cloud className="h-4 w-4" />}
              label="Historical rainfall fallback"
              value="Open-Meteo Archive"
              hint="Used when station data is unavailable."
            />
          </div>

          <ForecastProviderCard
            vineyardId={selectedVineyardId!}
            canEdit={canEdit}
          />

          <WillyWeatherCard
            vineyardId={selectedVineyardId!}
            canEdit={canEdit}
          />

          <LiveWeatherCard
            vineyardId={selectedVineyardId!}
            anyConfigured={!!(davis?.configured || wu?.configured)}
          />

          <DavisCard
            status={davis}
            canEdit={canEdit}
            callerRole={callerRole}
            vineyardId={selectedVineyardId!}
            onChanged={() =>
              qc.invalidateQueries({ queryKey: ["weather_status", selectedVineyardId] })
            }
          />

          <ProviderStatusCard title="Weather Underground" status={wu} />

          <p className="text-xs text-muted-foreground">
            Weather credentials are stored securely server-side and are never
            displayed in the portal or app.
          </p>
        </>
      )}
    </div>
  );
}

function SourceCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="p-4 space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function YN({ v }: { v: boolean | null | undefined }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  return v ? (
    <Badge variant="secondary" className="gap-1"><Check className="h-3 w-3" /> Yes</Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-muted-foreground"><X className="h-3 w-3" /> No</Badge>
  );
}

// ISS / outdoor Davis sensor_type codes that imply temp/humidity + wind + rain.
const ISS_LIKE_SENSOR_TYPES = new Set(["23", "37", "43", "45", "46", "48", "55"]);

/** Returns 'detected' | 'not_detected' | 'unknown' for a sensor capability,
 *  combining the explicit boolean from the RPC with sensor_type fallback. */
function sensorState(
  explicit: boolean | null | undefined,
  detected: string[] | null | undefined,
  capability: "wind" | "temp_humidity" | "rain",
): "detected" | "not_detected" | "unknown" {
  if (explicit === true) return "detected";
  const tags = (detected ?? []).map((s) => String(s).toLowerCase());
  // Direct tag match (e.g. "wind", "temp", "rain", "iss").
  const tagHit =
    (capability === "wind" && tags.some((t) => t.includes("wind"))) ||
    (capability === "temp_humidity" &&
      tags.some((t) => t.includes("temp") || t.includes("hum") || t.includes("iss"))) ||
    (capability === "rain" && tags.some((t) => t.includes("rain") || t.includes("iss")));
  // Numeric sensor_type fallback (ISS-like => temp/hum + wind + rain).
  const issHit = tags.some((t) => ISS_LIKE_SENSOR_TYPES.has(t));
  if (tagHit || issHit) return "detected";
  if (explicit === false) return "not_detected";
  return "unknown";
}

function SensorBadge({ state }: { state: "detected" | "not_detected" | "unknown" }) {
  if (state === "detected")
    return (
      <Badge variant="secondary" className="gap-1">
        <Check className="h-3 w-3" /> Detected
      </Badge>
    );
  if (state === "not_detected")
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <X className="h-3 w-3" /> Not detected
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <HelpCircle className="h-3 w-3" /> Unknown
    </Badge>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 last:border-0 py-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function StatusBlock({ status }: { status?: WeatherIntegrationStatus }) {
  if (!status) return null;
  const wind = sensorState(status.has_wind, status.detected_sensors, "wind");
  const th = sensorState(status.has_temperature_humidity, status.detected_sensors, "temp_humidity");
  const rain = sensorState(status.has_rain, status.detected_sensors, "rain");
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        <Row label="Configured" value={<YN v={status.configured} />} />
        <Row label="Active" value={<YN v={status.is_active} />} />
        <Row label="Station name" value={status.station_name ?? "—"} />
        <Row label="Station ID" value={status.station_id ?? "—"} />
        <Row label="API key stored" value={<YN v={status.has_api_key} />} />
        <Row label="API secret stored" value={<YN v={status.has_api_secret} />} />
        <Row label="Last test" value={fmtDate(status.last_tested_at)} />
        <Row label="Last test status" value={status.last_test_status ?? "—"} />
        <Row label="Updated" value={fmtDate(status.updated_at)} />
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Sensors</div>
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <Row label={<span className="flex items-center gap-1"><Wind className="h-3 w-3" /> Wind</span>} value={<SensorBadge state={wind} />} />
          <Row label={<span className="flex items-center gap-1"><Thermometer className="h-3 w-3" /> Temp / humidity</span>} value={<SensorBadge state={th} />} />
          <Row label={<span className="flex items-center gap-1"><CloudRain className="h-3 w-3" /> Rain</span>} value={<SensorBadge state={rain} />} />
          <Row label={<span className="flex items-center gap-1"><Leaf className="h-3 w-3" /> Leaf wetness</span>} value={<YN v={status.has_leaf_wetness} />} />
        </div>
        {status.detected_sensors && status.detected_sensors.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {status.detected_sensors.map((s) => (
              <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
            ))}
          </div>
        )}
        {(wind === "detected" || th === "detected" || rain === "detected") && (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {wind === "detected" && (
              <div>Wind sensor detected. Live wind readings render in the iOS app when Davis returns them.</div>
            )}
            {th === "detected" && (
              <div>Temp/Humidity sensor detected. Live readings render in the iOS app when Davis returns them.</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ProviderStatusCard({
  title,
  status,
}: {
  title: string;
  status?: WeatherIntegrationStatus;
}) {
  const configured = !!status?.configured;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        {configured ? (
          <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-600/30">
            Configured
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">Not configured</Badge>
        )}
      </div>
      {status?.error && <div className="text-xs text-destructive">RPC error: {status.error}</div>}
      {configured && <StatusBlock status={status} />}
    </Card>
  );
}

function DavisCard({
  status,
  canEdit,
  callerRole,
  vineyardId,
  onChanged,
}: {
  status?: WeatherIntegrationStatus;
  canEdit: boolean;
  callerRole: string | null;
  vineyardId: string;
  onChanged: () => void;
}) {
  const configured = !!status?.configured;
  const hasKey = !!status?.has_api_key;
  const hasSecret = !!status?.has_api_secret;

  // Form state — initialised from status, reset when status changes.
  const [enabled, setEnabled] = useState<boolean>(!!status?.is_active);
  const [stationId, setStationId] = useState<string>(status?.station_id ?? "");
  const [stationName, setStationName] = useState<string>(status?.station_name ?? "");
  const [apiKey, setApiKey] = useState<string>("");
  const [apiSecret, setApiSecret] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lastTestCode, setLastTestCode] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(!!status?.is_active);
    setStationId(status?.station_id ?? "");
    setStationName(status?.station_name ?? "");
    setApiKey("");
    setApiSecret("");
  }, [status?.is_active, status?.station_id, status?.station_name, status?.configured]);

  const saveMut = useMutation({
    mutationFn: async () => {
      await saveWeatherIntegration({
        vineyardId,
        provider: DAVIS,
        isActive: enabled,
        stationId: stationId.trim() || null,
        stationName: stationName.trim() || null,
        // Blank → null so the server COALESCEs existing creds.
        apiKey: apiKey.trim() === "" ? null : apiKey,
        apiSecret: apiSecret.trim() === "" ? null : apiSecret,
      });
    },
    onSuccess: async () => {
      toast.success("Weather settings saved");
      setApiKey("");
      setApiSecret("");
      await onChanged();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const testSavedMut = useMutation({
    mutationFn: () => testSavedDavis(vineyardId),
    onSuccess: (r) => {
      setLastTestCode(r.code ?? (r.ok ? "ok" : null));
      if (r.ok) toast.success("Saved credentials tested OK");
      else toast.error(`Test failed${r.message ? `: ${r.message}` : ""}`);
      onChanged();
    },
    onError: (e: any) => toast.error(e?.message ?? "Test failed"),
  });

  const testTypedMut = useMutation({
    mutationFn: () =>
      testTypedDavis({
        vineyardId,
        apiKey,
        apiSecret,
        stationId: stationId.trim() || null,
      }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Typed credentials tested OK");
      else toast.error(`Test failed${r.message ? `: ${r.message}` : ""}`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Test failed"),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteWeatherIntegration(vineyardId, DAVIS),
    onSuccess: () => {
      toast.success("Davis WeatherLink settings cleared");
      setConfirmDelete(false);
      onChanged();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to clear"),
  });

  const typedHasNew = apiKey.trim() !== "" || apiSecret.trim() !== "";

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Davis WeatherLink</h2>
        {configured ? (
          <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-600/30">
            Configured
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">Not configured</Badge>
        )}
      </div>

      {status?.error && <div className="text-xs text-destructive">RPC error: {status.error}</div>}

      {configured && <StatusBlock status={status} />}

      {lastTestCode === "function_not_found" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          Test connection is unavailable: the <code>davis-proxy</code> server function is not deployed on the production backend yet.
          Saved credentials are still stored securely and used by the iOS app —
          this only blocks the in-portal connection test. Use the Copy diagnostics button below when reporting this to support.
        </div>
      )}

      {!canEdit && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Only vineyard Owners and Managers can change weather integration settings.
          {callerRole && <> Your role: <span className="font-medium">{callerRole}</span>.</>}
        </div>
      )}

      {canEdit && (
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="weather-enabled" className="text-sm font-medium">Enabled</Label>
              <p className="text-xs text-muted-foreground">
                Turn the Davis integration on or off for this vineyard.
              </p>
            </div>
            <Switch id="weather-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="station-id">Station ID</Label>
              <Input
                id="station-id"
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
                placeholder="e.g. 123456"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="station-name">Station name</Label>
              <Input
                id="station-name"
                value={stationName}
                onChange={(e) => setStationName(e.target.value)}
                placeholder="e.g. North block"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="api-key">API key</Label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? "Stored — leave blank to keep existing" : "Enter API key"}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="api-secret">API secret</Label>
              <Input
                id="api-secret"
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder={hasSecret ? "Stored — leave blank to keep existing" : "Enter API secret"}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Leaving API key or secret blank preserves the values already stored
            server-side. Stored credentials are never displayed.
          </p>

          {(configured || hasKey || hasSecret) && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              The API key and API secret inputs clear after save by design. Use the stored-status rows above to confirm whether credentials are saved for this vineyard.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="gap-2"
            >
              {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save settings
            </Button>

            <Button
              variant="outline"
              onClick={() => testSavedMut.mutate()}
              disabled={testSavedMut.isPending || !configured}
              className="gap-2"
              title={!configured ? "Save settings first" : "Test stored credentials"}
            >
              {testSavedMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
              Test saved credentials
            </Button>

            {typedHasNew && (
              <Button
                variant="outline"
                onClick={() => testTypedMut.mutate()}
                disabled={testTypedMut.isPending}
                className="gap-2"
              >
                {testTypedMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
                Test typed credentials
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              onClick={async () => {
                const wind = sensorState(status?.has_wind, status?.detected_sensors, "wind");
                const th = sensorState(status?.has_temperature_humidity, status?.detected_sensors, "temp_humidity");
                const rain = sensorState(status?.has_rain, status?.detected_sensors, "rain");
                const diag = {
                  vineyardId,
                  provider: DAVIS,
                  configured,
                  has_api_key: status?.has_api_key ?? null,
                  has_api_secret: status?.has_api_secret ?? null,
                  is_active: status?.is_active ?? null,
                  station_id: status?.station_id ?? null,
                  station_name: status?.station_name ?? null,
                  last_tested_at: status?.last_tested_at ?? null,
                  last_test_status: status?.last_test_status ?? null,
                  detectedSensors: status?.detected_sensors ?? [],
                  hasWindSensor: wind,
                  hasTemperatureHumiditySensor: th,
                  hasRainSensor: rain,
                  has_leaf_wetness: status?.has_leaf_wetness ?? null,
                  caller_role: status?.caller_role ?? null,
                  rpc_error: status?.error ?? null,
                  last_portal_test_code: lastTestCode,
                  generated_at: new Date().toISOString(),
                };
                try {
                  await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
                  toast.success("Davis diagnostics copied to clipboard");
                } catch {
                  toast.error("Could not copy diagnostics");
                }
              }}
            >
              <Copy className="h-4 w-4" />
              Copy diagnostics
            </Button>

            <div className="ml-auto">
              <Button
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={!configured || deleteMut.isPending}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Clear settings
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Davis WeatherLink settings for this vineyard?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the stored Davis WeatherLink configuration and
              credentials for this vineyard. The VineTrack app will fall back to
              forecast/archive sources until new settings are saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteMut.mutate();
              }}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Clearing…" : "Clear settings"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function fmtNum(v: number | null | undefined, digits = 1, suffix = "") {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Number(v).toFixed(digits)}${suffix}`;
}

function compassFrom(deg?: number | null) {
  if (deg == null || Number.isNaN(deg)) return "";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((deg % 360) / 22.5)) % 16];
}

function LiveWeatherCard({
  vineyardId,
  anyConfigured,
}: {
  vineyardId: string;
  anyConfigured: boolean;
}) {
  const { data, isLoading, refetch, isFetching } = useQuery<LiveWeatherResult>({
    queryKey: ["live_weather", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchLiveWeather(vineyardId),
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Cloud className="h-4 w-4" /> Live weather
          </h2>
          <p className="text-xs text-muted-foreground">
            Latest in-vineyard observations from your configured station.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1"
        >
          {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground">Loading current weather…</div>
      )}

      {!isLoading && data && data.available === false && (
        <LiveEmptyState
          reason={data.reason}
          message={data.message}
          anyConfigured={anyConfigured}
        />
      )}

      {!isLoading && data && data.available === true && (
        <div className="space-y-3">
          {data.stale && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              Reading is stale (&gt; 1 hour old). Station may be offline.
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3 text-sm">
            <Reading icon={<Thermometer className="h-3.5 w-3.5" />} label="Temperature" value={fmtNum(data.reading.temperature_c, 1, " °C")} />
            <Reading icon={<Droplets className="h-3.5 w-3.5" />} label="Humidity" value={fmtNum(data.reading.humidity_pct, 0, " %")} />
            <Reading
              icon={<Wind className="h-3.5 w-3.5" />}
              label="Wind"
              value={
                data.reading.wind_speed_kmh == null
                  ? "—"
                  : `${fmtNum(data.reading.wind_speed_kmh, 1, " km/h")}${
                      data.reading.wind_direction_deg != null
                        ? ` ${compassFrom(data.reading.wind_direction_deg)}`
                        : ""
                    }`
              }
            />
            <Reading icon={<CloudRain className="h-3.5 w-3.5" />} label="Rain today" value={fmtNum(data.reading.rain_today_mm, 1, " mm")} />
            <Reading icon={<CloudRain className="h-3.5 w-3.5" />} label="Rain rate" value={fmtNum(data.reading.rain_rate_mm_per_hr, 2, " mm/h")} />
            <Reading icon={<Cloud className="h-3.5 w-3.5" />} label="Station" value={data.reading.station_name ?? "—"} />
          </div>
          <div className="text-xs text-muted-foreground border-t pt-2 flex flex-wrap gap-x-4 gap-y-1">
            <span>Source: {data.reading.source ?? "—"}</span>
            <span>Last observation: {fmtDate(data.reading.observed_at)}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function LiveEmptyState({
  reason,
  message,
  anyConfigured,
}: {
  reason: "rpc_missing" | "not_configured" | "no_data" | "error";
  message?: string;
  anyConfigured: boolean;
}) {
  if (reason === "rpc_missing") {
    return (
      <div className="rounded-md border bg-muted/40 px-3 py-3 text-sm space-y-1">
        <div className="font-medium">Live weather temporarily unavailable</div>
        <p className="text-xs text-muted-foreground">
          Live readings are not available in the portal right now. Live weather
          continues to render in the VineTrack iOS app. Please contact support
          if this persists.
        </p>
      </div>
    );
  }
  if (reason === "not_configured" || !anyConfigured) {
    return (
      <div className="rounded-md border bg-muted/40 px-3 py-3 text-sm">
        No weather provider is configured for this vineyard yet. Configure Davis
        WeatherLink below to start collecting in-vineyard observations.
      </div>
    );
  }
  if (reason === "no_data") {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-3 text-sm text-amber-900 dark:text-amber-200">
        Configured, but no live readings are available right now. The station
        may be offline, or no observations have been received yet.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
      Could not load live weather{message ? `: ${message}` : "."}
    </div>
  );
}

function Reading({
  icon, label, value,
}: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border p-2.5">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forecast Provider preference (Auto / Open-Meteo / WillyWeather)
// ---------------------------------------------------------------------------

function ForecastProviderCard({
  vineyardId,
  canEdit,
}: {
  vineyardId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["forecast_provider", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => getForecastProvider(vineyardId),
  });
  const [pending, setPending] = useState<ForecastProvider | null>(null);

  const onChange = async (next: ForecastProvider) => {
    if (!canEdit || pending) return;
    setPending(next);
    const r = await setForecastProvider(vineyardId, next);
    setPending(null);
    if (!r.ok) {
      toast.error(r.message ?? "Could not save forecast provider");
      return;
    }
    toast.success("Forecast provider updated");
    qc.invalidateQueries({ queryKey: ["forecast_provider", vineyardId] });
  };

  const value: ForecastProvider = data ?? "auto";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Forecast Provider</h2>
          <p className="text-xs text-muted-foreground">
            Which service provides 7-day forecasts. Auto uses WillyWeather when configured, otherwise Open-Meteo.
          </p>
        </div>
        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <RadioGroup
          value={value}
          onValueChange={(v) => onChange(v as ForecastProvider)}
          className="grid gap-2 sm:grid-cols-3"
        >
          {(
            [
              { v: "auto", label: "Auto", hint: "WillyWeather if set, else Open-Meteo" },
              { v: "open_meteo", label: "Open-Meteo", hint: "Free global forecast service" },
              { v: "willyweather", label: "WillyWeather", hint: "Australian forecast (location required)" },
            ] as { v: ForecastProvider; label: string; hint: string }[]
          ).map((opt) => (
            <label
              key={opt.v}
              htmlFor={`fp-${opt.v}`}
              className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                canEdit ? "cursor-pointer hover:bg-muted/40" : "opacity-60"
              } ${value === opt.v ? "border-primary bg-primary/5" : ""}`}
            >
              <RadioGroupItem id={`fp-${opt.v}`} value={opt.v} disabled={!canEdit} className="mt-0.5" />
              <div>
                <div className="font-medium">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.hint}</div>
              </div>
            </label>
          ))}
        </RadioGroup>
      )}
      {!canEdit && (
        <div className="text-xs text-muted-foreground">
          Only vineyard Owners and Managers can change the forecast provider.
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WillyWeather setup (no API key — key is server-side only)
// ---------------------------------------------------------------------------

function WillyWeatherCard({
  vineyardId,
  canEdit,
}: {
  vineyardId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery<WillyIntegrationStatus>({
    queryKey: ["willyweather_status", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchWillyWeatherStatus(vineyardId),
  });

  // Forecast provider preference — shared cache key with ForecastProviderCard.
  const { data: provider } = useQuery({
    queryKey: ["forecast_provider", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => getForecastProvider(vineyardId),
  });

  // Vineyard centre coordinates (for auto-assignment of nearest WW location).
  const { data: vineyardCenter } = useQuery<{ lat: number; lon: number } | null>({
    queryKey: ["vineyard_center", vineyardId],
    enabled: !!vineyardId,
    queryFn: async () => {
      try {
        const { data } = await iosSupabase
          .from("vineyards")
          .select("latitude, longitude")
          .eq("id", vineyardId)
          .maybeSingle();
        const lat = (data as any)?.latitude;
        const lon = (data as any)?.longitude;
        if (typeof lat === "number" && typeof lon === "number" && !isNaN(lat) && !isNaN(lon)) {
          return { lat, lon };
        }
      } catch {
        // ignore — vineyards table may not expose coords to this caller
      }
      return null;
    },
  });

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WillyLocation[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssigned, setAutoAssigned] = useState(false);
  const autoTriedRef = useRef(false);

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["willyweather_status", vineyardId] });

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    const r = await searchWillyLocations(vineyardId, query.trim());
    setSearching(false);
    if (!r.ok) {
      toast.error((r as any).message);
      setResults([]);
      return;
    }
    setResults(r.locations);
    if (r.locations.length === 0) toast.info("No locations matched that search.");
  };

  const handleNearest = async () => {
    if (status?.station_latitude == null || status?.station_longitude == null) {
      toast.error("Set a location first, or use search.");
      return;
    }
    setSearching(true);
    const r = await searchNearestWillyLocation(
      vineyardId,
      status.station_latitude,
      status.station_longitude,
    );
    setSearching(false);
    if (!r.ok) {
      toast.error((r as any).message);
      return;
    }
    setResults(r.locations);
  };

  const handleSelect = async (loc: WillyLocation) => {
    setBusy("set");
    const r = await setWillyLocation(vineyardId, {
      id: loc.id,
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
    });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.message ?? "Could not set location");
      return;
    }
    toast.success(`Location set: ${loc.name}`);
    setResults(null);
    setQuery("");
    refresh();
  };

  const handleTest = async () => {
    setBusy("test");
    const r = await testWillyConnection(vineyardId);
    setBusy(null);
    if (!r.ok) {
      toast.error(r.message ?? "Test failed");
    } else {
      toast.success("WillyWeather connection OK");
    }
    refresh();
  };

  const handleDelete = async () => {
    setBusy("delete");
    const r = await deleteWillyIntegration(vineyardId);
    setBusy(null);
    setConfirmDelete(false);
    if (!r.ok) {
      toast.error(r.message ?? "Could not remove location");
      return;
    }
    toast.success("WillyWeather location removed");
    refresh();
  };

  const configured = !!status?.configured && !!status?.station_id;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">WillyWeather</h2>
        {configured ? (
          <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-600/30">
            Configured
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">Not configured</Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        WillyWeather provides Australian-region forecasts. The API key is managed centrally — no key is needed here. Set a location and test the connection.
      </p>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <Row label="Location" value={status?.station_name ?? "—"} />
          <Row label="Location ID" value={status?.station_id ?? "—"} />
          <Row
            label="Coordinates"
            value={
              status?.station_latitude != null && status?.station_longitude != null
                ? `${status.station_latitude.toFixed(3)}, ${status.station_longitude.toFixed(3)}`
                : "—"
            }
          />
          <Row label="Active" value={<YN v={status?.is_active ?? null} />} />
          <Row label="Last test" value={fmtDate(status?.last_tested_at)} />
          <Row label="Last test status" value={status?.last_test_status ?? "—"} />
        </div>
      )}

      {canEdit ? (
        <div className="space-y-3 border-t pt-4">
          <div className="space-y-1">
            <Label htmlFor="ww-query">Search location</Label>
            <div className="flex gap-2">
              <Input
                id="ww-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Orange NSW"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
              />
              <Button onClick={handleSearch} disabled={searching || !query.trim()} className="gap-2">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Search
              </Button>
              {configured && (
                <Button
                  variant="outline"
                  onClick={handleNearest}
                  disabled={searching}
                  title="Find locations nearest the current coordinates"
                >
                  Find nearest
                </Button>
              )}
            </div>
          </div>

          {results && results.length > 0 && (
            <div className="rounded-md border divide-y max-h-72 overflow-auto">
              {results.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => handleSelect(loc)}
                  disabled={busy === "set"}
                  className="w-full text-left px-3 py-2 hover:bg-muted/40 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-sm font-medium">{loc.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[loc.region, loc.state, loc.postcode].filter(Boolean).join(" · ") || `${loc.latitude}, ${loc.longitude}`}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {loc.distanceKm != null ? `${loc.distanceKm.toFixed(1)} km` : "Select"}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={busy === "test" || !configured}
              className="gap-2"
              title={!configured ? "Set a location first" : "Test WillyWeather connection"}
            >
              {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
              Test connection
            </Button>
            <div className="ml-auto">
              <Button
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={!configured || busy === "delete"}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Remove location
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Only vineyard Owners and Managers can change the WillyWeather location.
        </div>
      )}

      <WillyWeatherAttribution />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove WillyWeather location?</AlertDialogTitle>
            <AlertDialogDescription>
              The vineyard will fall back to Open-Meteo for forecasts (or whatever the Forecast Provider preference resolves to).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "delete"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={busy === "delete"}
            >
              {busy === "delete" ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
