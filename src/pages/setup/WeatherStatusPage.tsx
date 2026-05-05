import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cloud, CloudRain, Droplets, Thermometer, Wind, Leaf, Check, X } from "lucide-react";
import {
  fetchWeatherStatusForVineyard,
  type WeatherIntegrationStatus,
} from "@/lib/weatherStatusQuery";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString();
};

export default function WeatherStatusPage() {
  const { selectedVineyardId } = useVineyard();
  const { data, isLoading, error } = useQuery({
    queryKey: ["weather_status", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchWeatherStatusForVineyard(selectedVineyardId!),
  });

  const davis = data?.davis;
  const wu = data?.wunderground;

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
      safeRpc: data?.rpcUsed,
      weatherStatusReturned: !!data,
      davisConfigured: davis?.configured ?? false,
      wundergroundConfigured: wu?.configured ?? false,
      rpcErrors: { davis: davis?.error ?? null, wunderground: wu?.error ?? null },
      schemaGaps: [
        "no last successful sync timestamp distinct from last_tested_at",
        "no human-readable error detail beyond last_test_status string",
        "forecast/historical fallback sources are app-level, not exposed by RPC",
      ],
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Weather</h1>
        <p className="text-sm text-muted-foreground">
          Read-only status of this vineyard's weather integrations.
        </p>
      </div>

      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        Production data — read-only view. Credentials are stored server-side and are never displayed in the portal.
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

          {!data.anyConfigured && (
            <Card className="p-6 text-center text-muted-foreground">
              No weather integration configured for this vineyard.
            </Card>
          )}

          <ProviderCard
            title="Davis WeatherLink"
            status={davis}
          />
          <ProviderCard
            title="Weather Underground"
            status={wu}
          />

          <p className="text-xs text-muted-foreground">
            Credentials are stored server-side and are never displayed in the portal.
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

function ProviderCard({
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

      {status?.error && (
        <div className="text-xs text-destructive">RPC error: {status.error}</div>
      )}

      {configured && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 text-sm">
            <Row label="Active" value={<YN v={status?.is_active} />} />
            <Row label="Station name" value={status?.station_name ?? "—"} />
            <Row label="Station ID" value={status?.station_id ?? "—"} />
            <Row label="Last test" value={fmtDate(status?.last_tested_at)} />
            <Row label="Last test status" value={status?.last_test_status ?? "—"} />
            <Row label="Updated" value={fmtDate(status?.updated_at)} />
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Sensors</div>
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <Row label={<span className="flex items-center gap-1"><CloudRain className="h-3 w-3" /> Rain</span>} value={<YN v={status?.has_rain} />} />
              <Row label={<span className="flex items-center gap-1"><Wind className="h-3 w-3" /> Wind</span>} value={<YN v={status?.has_wind} />} />
              <Row label={<span className="flex items-center gap-1"><Thermometer className="h-3 w-3" /> Temp / humidity</span>} value={<YN v={status?.has_temperature_humidity} />} />
              <Row label={<span className="flex items-center gap-1"><Leaf className="h-3 w-3" /> Leaf wetness</span>} value={<YN v={status?.has_leaf_wetness} />} />
            </div>
            {status?.detected_sensors && status.detected_sensors.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {status.detected_sensors.map((s) => (
                  <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
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
