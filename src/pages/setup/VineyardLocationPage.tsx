import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, RefreshCw, Save } from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchVineyardLocation,
  setVineyardLocation,
  describeLocationError,
} from "@/lib/vineyardLocationQuery";

function listTimezones(): string[] {
  // @ts-expect-error - supportedValuesOf is widely available
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      // @ts-expect-error
      return Intl.supportedValuesOf("timeZone") as string[];
    } catch {
      /* fall through */
    }
  }
  return [
    "UTC",
    "Australia/Sydney",
    "Australia/Melbourne",
    "Australia/Adelaide",
    "Australia/Brisbane",
    "Australia/Perth",
    "Australia/Hobart",
    "Pacific/Auckland",
    "Europe/London",
    "Europe/Paris",
    "America/Los_Angeles",
    "America/New_York",
  ];
}

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const fmtNum = (n: number | null): string => (n == null ? "" : String(n));

export default function VineyardLocationPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const qc = useQueryClient();
  const { toast } = useToast();
  const timezones = useMemo(listTimezones, []);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["vineyard-location", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVineyardLocation(selectedVineyardId!),
  });

  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [elev, setElev] = useState("");
  const [tz, setTz] = useState<string>("");

  useEffect(() => {
    if (!data) return;
    setLat(fmtNum(data.latitude));
    setLng(fmtNum(data.longitude));
    setElev(fmtNum(data.elevation_metres));
    setTz(data.timezone ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!selectedVineyardId) throw new Error("No vineyard selected");
      return setVineyardLocation({
        vineyard_id: selectedVineyardId,
        latitude: numOrNull(lat),
        longitude: numOrNull(lng),
        elevation_metres: numOrNull(elev),
        timezone: tz.trim() === "" ? null : tz.trim(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vineyard-location", selectedVineyardId] });
      toast({ title: "Location saved", description: "Synced to all devices." });
    },
    onError: (e) =>
      toast({
        title: "Couldn't save location",
        description: describeLocationError(e),
        variant: "destructive",
      }),
  });

  const useBrowserTz = () => {
    try {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (browserTz) setTz(browserTz);
    } catch {
      /* ignore */
    }
  };

  const useBrowserLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: "Geolocation not available", variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        if (pos.coords.altitude != null && Number.isFinite(pos.coords.altitude)) {
          setElev(Math.round(pos.coords.altitude).toString());
        }
      },
      (err) =>
        toast({
          title: "Couldn't read location",
          description: err.message,
          variant: "destructive",
        }),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Vineyard Location</h1>
          <p className="text-sm text-muted-foreground">
            Used for weather, GDD/BEDD, disease, and irrigation calculations.
            Shared with iOS — changes here appear on every device.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {!canEdit && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Read-only — only owners and managers can change vineyard location.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {describeLocationError(error)}
        </div>
      )}

      <Card className="p-4 space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="lat">Latitude</Label>
                <Input
                  id="lat"
                  inputMode="decimal"
                  placeholder="-34.123456"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lng">Longitude</Label>
                <Input
                  id="lng"
                  inputMode="decimal"
                  placeholder="138.654321"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="elev">Elevation (metres)</Label>
                <Input
                  id="elev"
                  inputMode="numeric"
                  placeholder="e.g. 240"
                  value={elev}
                  onChange={(e) => setElev(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tz">Timezone</Label>
                <Select
                  value={tz || undefined}
                  onValueChange={(v) => setTz(v)}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="tz">
                    <SelectValue placeholder="Select timezone…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {timezones.map((z) => (
                      <SelectItem key={z} value={z}>
                        {z}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={useBrowserLocation}
                >
                  <MapPin className="h-4 w-4 mr-2" /> Use browser location
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={useBrowserTz}
                >
                  Use browser timezone
                </Button>
                <div className="flex-1" />
                <Button
                  type="button"
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                >
                  {save.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save location
                </Button>
              </div>
            )}

            <p className="text-xs text-muted-foreground pt-2">
              Blank fields are preserved — leaving a value empty will not clear
              the saved value unless you explicitly remove it.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
