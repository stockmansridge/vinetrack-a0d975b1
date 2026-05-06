import { useEffect, useMemo, useState } from "react";
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
  fetchWeatherStatusForVineyard,
  saveWeatherIntegration,
  testSavedDavis,
  testTypedDavis,
  type WeatherIntegrationStatus,
  type WeatherProvider,
} from "@/lib/weatherStatusQuery";

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
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2 text-sm">
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
          <Row label={<span className="flex items-center gap-1"><CloudRain className="h-3 w-3" /> Rain</span>} value={<YN v={status.has_rain} />} />
          <Row label={<span className="flex items-center gap-1"><Wind className="h-3 w-3" /> Wind</span>} value={<YN v={status.has_wind} />} />
          <Row label={<span className="flex items-center gap-1"><Thermometer className="h-3 w-3" /> Temp / humidity</span>} value={<YN v={status.has_temperature_humidity} />} />
          <Row label={<span className="flex items-center gap-1"><Leaf className="h-3 w-3" /> Leaf wetness</span>} value={<YN v={status.has_leaf_wetness} />} />
        </div>
        {status.detected_sensors && status.detected_sensors.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {status.detected_sensors.map((s) => (
              <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
            ))}
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
