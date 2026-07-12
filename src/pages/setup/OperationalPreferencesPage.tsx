import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Loader2, Save, Sprout } from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  MONTHS,
  SEASON_DEFAULTS,
  clampSeasonDay,
  currentVintageForSeason,
  fetchVineyardSeasonSettings,
  isValidSeason,
  maxDayForMonth,
  saveVineyardSeasonSettings,
  seasonRangeForVintage,
} from "@/lib/vineyardSeasonSettingsQuery";
import { describeVineyardError } from "@/lib/vineyardSettingsQuery";

function describeReadError(err: unknown): string {
  const msg = describeVineyardError(err);
  if (/permission|denied|not.*allow/i.test(msg))
    return "Season settings could not be loaded (permission denied).";
  return "Season settings could not be loaded. Please try again.";
}

function describeWriteError(err: unknown): string {
  const msg = describeVineyardError(err);
  if (/permission|denied|not.*allow|role/i.test(msg))
    return "You do not have permission to change this vineyard's shared season settings.";
  if (/day|month|invalid|check/i.test(msg))
    return "The selected day is not valid for this month.";
  return msg || "Couldn't save season settings.";
}

export default function OperationalPreferencesPage() {
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const qc = useQueryClient();
  const { toast } = useToast();

  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;

  const q = useQuery({
    queryKey: ["vineyard-season-settings", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVineyardSeasonSettings(selectedVineyardId!),
  });

  const [month, setMonth] = useState<number>(SEASON_DEFAULTS.season_start_month);
  const [day, setDay] = useState<number>(SEASON_DEFAULTS.season_start_day);
  const [pendingVineyardSwitch, setPendingVineyardSwitch] = useState<string | null>(null);

  // Reset draft when vineyard or server value changes to prevent leaking
  // one vineyard's values into another.
  useEffect(() => {
    if (q.data) {
      setMonth(q.data.season_start_month);
      setDay(q.data.season_start_day);
    } else {
      setMonth(SEASON_DEFAULTS.season_start_month);
      setDay(SEASON_DEFAULTS.season_start_day);
    }
  }, [q.data, selectedVineyardId]);

  const dirty =
    !!q.data &&
    (q.data.season_start_month !== month || q.data.season_start_day !== day);

  // Warn on browser navigation / refresh while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async () => {
      if (!selectedVineyardId) throw new Error("No vineyard selected");
      if (!isValidSeason(month, day))
        throw new Error("The selected day is not valid for this month.");
      return saveVineyardSeasonSettings(selectedVineyardId, month, day);
    },
    onSuccess: (result) => {
      // Replace form values with the server-confirmed canonical values.
      setMonth(result.season_start_month);
      setDay(result.season_start_day);
      toast({
        title: "Season settings saved",
        description: "Applied to iOS, Android and the portal.",
      });
      qc.invalidateQueries({ queryKey: ["vineyard-season-settings", selectedVineyardId] });
      // Any query keyed on the season boundary should refresh.
      qc.invalidateQueries({ queryKey: ["vintage-spray-count"] });
      qc.invalidateQueries({ queryKey: ["work-tasks"] });
      qc.invalidateQueries({ queryKey: ["growth-stage-records"] });
    },
    onError: (e) =>
      toast({
        title: "Couldn't save season settings",
        description: describeWriteError(e),
        variant: "destructive",
      }),
  });

  const onMonthChange = (m: number) => {
    setMonth(m);
    setDay((d) => clampSeasonDay(m, d));
  };

  const onDayChange = (d: number) => {
    setDay(clampSeasonDay(month, d));
  };

  const dayMax = maxDayForMonth(month);
  const dayOptions = useMemo(
    () => Array.from({ length: dayMax }, (_, i) => i + 1),
    [dayMax],
  );

  const previewVintage = currentVintageForSeason(month, day);
  const previewRange = seasonRangeForVintage(month, day, previewVintage);
  const monthLabel = MONTHS.find((m) => m.value === month)?.label ?? "";
  const startDateLong = `${day} ${monthLabel} ${previewVintage - 1}`;
  const endMonth = MONTHS.find((m) => m.value === month)?.label ?? "";
  const endDateLong = `${
    // last day of season = day-1 of same month/year OR previous month if day===1
    day === 1 ? maxDayForMonth(month === 1 ? 12 : month - 1) : day - 1
  } ${
    day === 1
      ? (MONTHS.find((m) => m.value === (month === 1 ? 12 : month - 1))?.label ?? endMonth)
      : endMonth
  } ${day === 1 && month === 1 ? previewVintage - 1 : previewVintage}`;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <Sprout className="h-6 w-6 text-muted-foreground mt-1" />
        <div>
          <h1 className="text-2xl font-semibold">Operational Preferences</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Shared vineyard settings that drive how VineTrack groups records into
            vintages and seasons. Changes apply to iOS, Android and the portal.
          </p>
        </div>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Growing Season &amp; E-L</h2>
            {vineyardName && (
              <p className="text-sm text-muted-foreground">
                Vineyard: <span className="font-medium text-foreground">{vineyardName}</span>
              </p>
            )}
          </div>
        </div>

        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p>Season boundaries are used by the E-L growth stage report.</p>
          <p>
            Changing the season start affects how VineTrack groups records into vintages
            and “This Season” reports for everyone in this vineyard.
          </p>
          <p>
            This is a shared vineyard setting. Changes apply to all users on iOS, Android
            and the VineTrack portal.
          </p>
        </div>

        {!canEdit && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Only vineyard owners and managers can change the shared season settings.
          </div>
        )}

        {q.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {describeReadError(q.error)}
          </div>
        )}

        {q.isLoading || !selectedVineyardId ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />{" "}
            {selectedVineyardId ? "Loading…" : "Select a vineyard."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Season start month</Label>
                <Select
                  value={String(month)}
                  onValueChange={(v) => onMonthChange(Number(v))}
                  disabled={!canEdit}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Season start day</Label>
                <Select
                  value={String(day)}
                  onValueChange={(v) => onDayChange(Number(v))}
                  disabled={!canEdit}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {dayOptions.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Card className="p-3 bg-muted/30 border-dashed">
              <div className="flex items-start gap-2">
                <CalendarDays className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">Current vintage:</span>{" "}
                    <span className="font-semibold">{previewVintage}</span>
                    {dirty && (
                      <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        Unsaved
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    Season: {startDateLong} – {endDateLong}
                  </div>
                  <div className="text-xs text-muted-foreground/80">
                    Range: {previewRange.startISO} → {previewRange.endISO}
                  </div>
                </div>
              </div>
            </Card>

            {canEdit && (
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  onClick={() => save.mutate()}
                  disabled={save.isPending || !dirty || !isValidSeason(month, day)}
                >
                  {save.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save changes
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      <AlertDialog
        open={!!pendingVineyardSwitch}
        onOpenChange={(o) => !o && setPendingVineyardSwitch(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved season changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to the season settings for this vineyard.
              Switching vineyards will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={() => setPendingVineyardSwitch(null)}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
