import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2, Loader2, Save } from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  AU_DEFAULTS,
  COUNTRY_OPTIONS,
  COUNTRY_PRESETS,
  CURRENCY_OPTIONS,
  CountryCode,
  RegionSettings,
  fetchVineyardRegionSettings,
  saveVineyardRegionSettings,
} from "@/lib/vineyardRegionSettingsQuery";
import { describeVineyardError } from "@/lib/vineyardSettingsQuery";

const AREA_UNITS = ["hectares", "acres"] as const;
const VOLUME_UNITS = ["litres", "gallons"] as const;
const DISTANCE_UNITS = ["metric", "imperial"] as const;
const FUEL_UNITS = ["litres", "gallons"] as const;
const SPRAY_AREA_UNITS = ["hectare", "acre"] as const;
const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
const TERMINOLOGY_REGIONS = [
  { value: "AU_NZ", label: "Australia / New Zealand" },
  { value: "US_CA", label: "United States / Canada" },
  { value: "UK_ZA", label: "United Kingdom / South Africa" },
] as const;

export default function VineyardRegionSettingsPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const qc = useQueryClient();
  const { toast } = useToast();

  const q = useQuery({
    queryKey: ["vineyard-region-settings", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVineyardRegionSettings(selectedVineyardId!),
  });

  const [draft, setDraft] = useState<RegionSettings>(AU_DEFAULTS);
  const [pendingCountry, setPendingCountry] = useState<CountryCode | null>(null);

  useEffect(() => {
    if (q.data) setDraft(q.data);
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!selectedVineyardId) throw new Error("No vineyard selected");
      await saveVineyardRegionSettings(selectedVineyardId, draft);
    },
    onSuccess: () => {
      toast({ title: "Region & units saved", description: "Synced with iOS." });
      qc.invalidateQueries({ queryKey: ["vineyard-region-settings", selectedVineyardId] });
    },
    onError: (e) =>
      toast({
        title: "Couldn't save settings",
        description: describeVineyardError(e),
        variant: "destructive",
      }),
  });

  const set = <K extends keyof RegionSettings>(key: K, value: RegionSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const onCountryChange = (code: CountryCode) => {
    if (code === draft.country_code) return;
    setPendingCountry(code);
  };

  const applyPreset = () => {
    if (!pendingCountry) return;
    setDraft(COUNTRY_PRESETS[pendingCountry]);
    setPendingCountry(null);
  };

  const keepCurrent = () => {
    if (!pendingCountry) return;
    setDraft((d) => ({ ...d, country_code: pendingCountry }));
    setPendingCountry(null);
  };

  const dirty =
    !!q.data &&
    (Object.keys(draft) as (keyof RegionSettings)[]).some((k) => draft[k] !== q.data![k]);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <Globe2 className="h-6 w-6 text-muted-foreground mt-1" />
        <div>
          <h1 className="text-2xl font-semibold">Region &amp; Units</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Region and unit settings control how vineyard records are displayed and
            exported. Changing these settings does not rewrite existing spray, fuel,
            task, maintenance, equipment, trip, or costing records.
          </p>
        </div>
      </div>

      {!canEdit && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Read-only — only owners and managers can edit region &amp; unit settings.
        </div>
      )}

      {q.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {describeVineyardError(q.error)}
        </div>
      )}

      <Card className="p-4 space-y-4">
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Country">
                <Select
                  value={draft.country_code}
                  onValueChange={(v) => onCountryChange(v as CountryCode)}
                  disabled={!canEdit}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COUNTRY_OPTIONS.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Currency">
                <Select
                  value={draft.currency_code}
                  onValueChange={(v) => set("currency_code", v)}
                  disabled={!canEdit}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Area unit">
                <SimpleSelect
                  value={draft.area_unit}
                  onChange={(v) => set("area_unit", v as RegionSettings["area_unit"])}
                  options={AREA_UNITS}
                  disabled={!canEdit}
                />
              </Field>

              <Field label="Volume unit">
                <SimpleSelect
                  value={draft.volume_unit}
                  onChange={(v) => set("volume_unit", v as RegionSettings["volume_unit"])}
                  options={VOLUME_UNITS}
                  disabled={!canEdit}
                />
              </Field>

              <Field label="Distance unit">
                <SimpleSelect
                  value={draft.distance_unit}
                  onChange={(v) => set("distance_unit", v as RegionSettings["distance_unit"])}
                  options={DISTANCE_UNITS}
                  disabled={!canEdit}
                />
              </Field>

              <Field label="Fuel unit">
                <SimpleSelect
                  value={draft.fuel_unit}
                  onChange={(v) => set("fuel_unit", v as RegionSettings["fuel_unit"])}
                  options={FUEL_UNITS}
                  disabled={!canEdit}
                />
              </Field>

              <Field label="Spray-rate area">
                <SimpleSelect
                  value={draft.spray_rate_area_unit}
                  onChange={(v) =>
                    set("spray_rate_area_unit", v as RegionSettings["spray_rate_area_unit"])
                  }
                  options={SPRAY_AREA_UNITS}
                  disabled={!canEdit}
                />
              </Field>

              <Field label="Date format">
                <SimpleSelect
                  value={draft.date_format}
                  onChange={(v) => set("date_format", v as RegionSettings["date_format"])}
                  options={DATE_FORMATS}
                  disabled={!canEdit}
                />
              </Field>

              <Field label="Terminology region">
                <Select
                  value={draft.terminology_region}
                  onValueChange={(v) =>
                    set("terminology_region", v as RegionSettings["terminology_region"])
                  }
                  disabled={!canEdit}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TERMINOLOGY_REGIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {canEdit && (
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
                  {save.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save changes
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Missing values fall back to Australian defaults. The vineyard timezone is
              managed in Vineyard Location.
            </p>
          </>
        )}
      </Card>

      <AlertDialog open={!!pendingCountry} onOpenChange={(o) => !o && setPendingCountry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply recommended defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              You changed the country to{" "}
              <span className="font-medium">
                {COUNTRY_OPTIONS.find((c) => c.code === pendingCountry)?.name}
              </span>
              . Would you like to apply the recommended currency, units and date format
              for this country, or keep your current settings?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingCountry(null)}>
              Cancel
            </AlertDialogCancel>
            <Button variant="outline" onClick={keepCurrent}>
              Keep current settings
            </Button>
            <AlertDialogAction onClick={applyPreset}>Apply defaults</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SimpleSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
