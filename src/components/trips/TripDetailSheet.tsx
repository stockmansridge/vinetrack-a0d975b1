// Canonical trip detail drawer shared by Trips and Spray Records.
// One component so linked spray records open the exact same map, worksheet,
// actuals, costing and PDF as the Trips page.
import { VINTAGE_OPTIONS_KEY } from "@/lib/availableVintages";
import { useMemo, useState, useEffect, useRef, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { ReorderableHead } from "@/components/table/ReorderableHead";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { useSortableTable } from "@/lib/useSortableTable";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchTripsForVineyard, softDeleteTrip, describeTripDeleteError, completeTrip, describeTripCompleteError, updateTripTitle, describeTripTitleError, type Trip } from "@/lib/tripsQuery";
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
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { fetchWorkTasksForVineyard, workTaskShortLabel } from "@/lib/workTasksQuery";
import { Button } from "@/components/ui/button";
import TripRouteAppleMap from "@/components/TripRouteAppleMap";
import {
  parseCorrections,
  parseSeeding,
  summarizeCoverage,
  formatCorrectionLine,
  tripToCsvRow,
  rowsToCsv,
  downloadCsv,
  downloadTripPdf,
} from "@/lib/tripReport";
import { isSprayingTrip } from "@/lib/sprayReportV1";
import SprayTripWorksheet from "@/components/spray/SprayTripWorksheet";
import EditTripDetailsDialog from "@/components/trips/EditTripDetailsDialog";

import { downloadSprayReport } from "@/lib/sprayReportExport";
import { useSprayLinkedTripIds } from "@/lib/sprayLinkedTrips";

import { useVineyardLogo } from "@/hooks/useVineyardLogo";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { countTripPins } from "@/lib/tripPinCount";
import { useCanSeeCosts } from "@/lib/permissions";
import { fetchOperatorCategoriesForVineyard } from "@/lib/operatorCategoriesQuery";
import { fetchVineyardMembersWithCategory } from "@/lib/teamMembersQuery";
import { fetchFuelPurchasesForVineyard } from "@/lib/fuelPurchasesQuery";
import { fetchSprayRecordsForVineyard } from "@/lib/sprayRecordsQuery";
import { useTripChemicalCosting } from "@/lib/useTripChemicalCosting";
import { formatTripChemicalCost } from "@/lib/chemicalCostResolver";
import { fetchSavedInputsForVineyard } from "@/lib/savedInputsQuery";
import { fetchYieldReportsForVineyard } from "@/lib/yieldReportsQuery";
import { computeTripCost, fmtCurrency, fmtHa, fmtHours, fmtTonnes, type TractorLite } from "@/lib/tripCosting";
import { computeFuelEstimate } from "@/lib/fuelEstimate";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import { fetchAllVineyardMachines, resolveMachineForRecord, type VineyardMachine } from "@/lib/vineyardMachinesQuery";


interface PaddockLite {
  id: string;
  name: string | null;
}

const ANY = "__any__";
const SPRAY = "__spray__";
const MAINT = "__maint__";

import { TRIP_FUNCTION_LABELS, tripFunctionLabel } from "@/lib/tripFunctionLabels";
import { useVintageFilter } from "@/hooks/useVintageFilter";
import { VintageSelect } from "@/components/VintageSelect";
import {
  formatTripPatternLabel,
  formatTripNameLabel,
  formatTripDurationLabel,
} from "@/lib/tripDisplay";
const tripDisplayName = (t: Trip): string =>
  formatTripNameLabel(
    t.trip_title,
    t.tracking_pattern,
    tripFunctionLabel(t.trip_function) ?? t.paddock_name ?? null,
  );

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return formatDateTime(d);
};
const fmtDay = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return formatDate(d);
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtDuration = (start?: string | null, end?: string | null) =>
  formatTripDurationLabel(start, end);
const fmtKm = (m?: number | null) =>
  m == null ? "—" : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;

function tripStatus(t: Trip): "active" | "paused" | "completed" {
  if (t.is_active) return "active";
  if (t.is_paused) return "paused";
  return "completed";
}

function arrayLen(v: any): number | null {
  return Array.isArray(v) ? v.length : null;
}

export default function TripDetailSheet({
  trip,
  paddockNameById,
  workTaskLabelById,
  vineyardName,
  vineyardId,
  open,
  onOpenChange,
  onTitleSaved,
  showLifecycleActions = true,
}: {
  trip: Trip | null;
  paddockNameById: Map<string, string | null>;
  workTaskLabelById: Map<string, string>;
  vineyardName: string | null;
  vineyardId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onTitleSaved: (tripId: string, tripTitle: string | null, syncVersion: number) => void;
  /** Complete/Delete Trip. Off for entrypoints that must not add lifecycle privileges. */
  showLifecycleActions?: boolean;
}) {
  const { data: vineyardLogoUrl } = useVineyardLogo();
  const formatters = useRegionFormatters();
  const canSeeCosts = useCanSeeCosts();
  // Deletion/completion are restricted to owners, managers and supervisors.
  const { currentRole, selectedVineyardId: sprayScopeVineyardId } = useVineyard();
  const { data: sprayLinkedTripIds } = useSprayLinkedTripIds(sprayScopeVineyardId);

  const canDeleteTrip =
    currentRole === "owner" || currentRole === "manager" || currentRole === "supervisor";
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [editTitle, setEditTitle] = useState(trip?.trip_title ?? "");
  const [savingTitle, setSavingTitle] = useState(false);
  const savingTitleRef = useRef(false);
  const savedTitleRef = useRef(trip?.trip_title ?? "");

  useEffect(() => {
    // Only reset when a different trip is opened. A query refresh for the same
    // trip must not replace text the operator is currently editing.
    const nextTitle = trip?.trip_title ?? "";
    setEditTitle(nextTitle);
    savedTitleRef.current = nextTitle;
  }, [trip?.id]);

  const isCompletable = !!trip && !trip.end_time && (trip.is_active || trip.is_paused);

  const handleSaveTitle = async (nextTitle?: string) => {
    if (!trip || !canDeleteTrip || savingTitleRef.current) return;
    const tripTitle = (nextTitle ?? editTitle).trim() || null;
    const savedTitle = savedTitleRef.current.trim() || null;
    if (tripTitle === savedTitle) return;

    savingTitleRef.current = true;
    setSavingTitle(true);
    const syncVersion = (trip.sync_version ?? 0) + 1;
    try {
      await updateTripTitle({
        tripId: trip.id,
        tripTitle,
        currentSyncVersion: trip.sync_version ?? null,
        userId: user?.id ?? null,
      });
      savedTitleRef.current = tripTitle ?? "";
      setEditTitle(tripTitle ?? "");
      onTitleSaved(trip.id, tripTitle, syncVersion);
      await queryClient.invalidateQueries({ queryKey: ["trips"] });
      toast({ title: "Trip name updated" });
    } catch (err) {
      toast({
        title: "Could not update trip name",
        description: describeTripTitleError(err),
        variant: "destructive",
      });
    } finally {
      savingTitleRef.current = false;
      setSavingTitle(false);
    }
  };

  const handleCompleteTrip = async () => {
    if (!trip) return;
    setCompleting(true);
    try {
      await completeTrip({
        tripId: trip.id,
        currentSyncVersion: (trip as any).sync_version ?? null,
        userId: user?.id ?? null,
        existingEndTime: trip.end_time ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: [VINTAGE_OPTIONS_KEY] });
      toast({ title: "Trip completed", description: "The trip has been marked as completed." });
      setConfirmComplete(false);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not complete trip",
        description: describeTripCompleteError(err),
        variant: "destructive",
      });
    } finally {
      setCompleting(false);
    }
  };

  const handleDeleteTrip = async () => {
    if (!trip) return;
    setDeleting(true);
    try {
      await softDeleteTrip({
        tripId: trip.id,
        currentSyncVersion: (trip as any).sync_version ?? null,
        userId: user?.id ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: [VINTAGE_OPTIONS_KEY] });
      toast({ title: "Trip deleted", description: "The trip has been removed from your records." });
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not delete trip",
        description: describeTripDeleteError(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };
  const [editDetailsOpen, setEditDetailsOpen] = useState(false);

  const padName = trip?.paddock_name ?? (trip?.paddock_id ? paddockNameById.get(trip.paddock_id) ?? null : null);

  const points = arrayLen(trip?.path_points);
  const completed = arrayLen(trip?.completed_paths);
  const skipped = arrayLen(trip?.skipped_paths);
  const pins = arrayLen(trip?.pin_ids);
  const corrections = trip ? parseCorrections(trip.manual_correction_events) : [];
  const seeding = trip ? parseSeeding(trip.seeding_details) : null;
  const cov = trip ? summarizeCoverage(trip) : null;

  // Cost Summary inputs (owner/manager only) — only fetch when allowed.
  const costEnabled = !!trip && canSeeCosts && !!vineyardId;
  const { data: costCategories } = useQuery({
    queryKey: ["cost-categories", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchOperatorCategoriesForVineyard(vineyardId!),
  });
  const { data: costMembers } = useQuery({
    queryKey: ["cost-members", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchVineyardMembersWithCategory(vineyardId!),
  });
  const { data: costFuel } = useQuery({
    queryKey: ["cost-fuel", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchFuelPurchasesForVineyard(vineyardId!),
  });
  const { data: costSpray } = useQuery({
    queryKey: ["cost-spray", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchSprayRecordsForVineyard(vineyardId!),
  });
  const { data: costTractors } = useQuery({
    queryKey: ["cost-tractors", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchList<TractorLite>("tractors", vineyardId!),
  });
  const chemCostTrips = useMemo(() => (trip && costEnabled ? [trip] : []), [trip, costEnabled]);
  const chemCosting = useTripChemicalCosting(vineyardId, chemCostTrips, costSpray?.records ?? []);
  const { data: costSavedInputs } = useQuery({
    queryKey: ["cost-saved-inputs", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchSavedInputsForVineyard(vineyardId!),
  });
  const { data: costPaddocks } = useQuery({
    queryKey: ["cost-paddocks-geo", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchList<{ id: string; name: string | null; polygon_points?: any }>("paddocks", vineyardId!),
  });
  const { data: costYields } = useQuery({
    queryKey: ["cost-yields", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchYieldReportsForVineyard(vineyardId!),
  });

  // Tractors for the Fuel estimate section (visible to all users — non-sensitive).
  const fuelEnabled = !!trip && !!vineyardId;
  const { data: allTractors } = useQuery({
    queryKey: ["trip-tractors", vineyardId],
    enabled: fuelEnabled,
    queryFn: () => fetchList<TractorLite>("tractors", vineyardId!),
  });
  // Fuel purchases for cost/L — may RLS to owner/manager only; failures
  // bubble up as no rows which we render as "cost unavailable".
  const { data: allFuel } = useQuery({
    queryKey: ["trip-fuel-purchases", vineyardId],
    enabled: fuelEnabled,
    queryFn: async () => {
      try { return await fetchFuelPurchasesForVineyard(vineyardId!); }
      catch { return []; }
    },
  });

  const { data: allMachines = [] } = useQuery<VineyardMachine[]>({
    queryKey: ["trip-machines", vineyardId],
    enabled: fuelEnabled,
    queryFn: () => fetchAllVineyardMachines(vineyardId!),
  });

  const allMachinesById = useMemo(() => {
    const m = new Map<string, VineyardMachine>();
    (allMachines ?? []).forEach((x) => m.set(x.id, x));
    return m;
  }, [allMachines]);
  const allTractorsById = useMemo(() => {
    const m = new Map<string, TractorLite>();
    (allTractors ?? []).forEach((t) => m.set(t.id, t));
    return m;
  }, [allTractors]);

  const resolvedMachine = useMemo(() => {
    if (!trip) return null;
    return resolveMachineForRecord(
      { machine_id: trip.machine_id, tractor_id: trip.tractor_id },
      allMachinesById,
      allTractorsById,
    );
  }, [trip, allMachinesById, allTractorsById]);

  const fuelEstimate = useMemo(() => {
    if (!trip || !resolvedMachine || resolvedMachine.source === "none") return null;
    const tractorShape: TractorLite = {
      id: resolvedMachine.id ?? "",
      name: resolvedMachine.name,
      fuel_usage_l_per_hour: resolvedMachine.fuel_l_per_hour,
    };
    return computeFuelEstimate(trip, tractorShape, allFuel ?? []);
  }, [trip, resolvedMachine, allFuel]);

  const tractorName = resolvedMachine?.name ?? null;

  const cost = useMemo(() => {
    if (!trip || !canSeeCosts) return null;
    const tractor = trip.tractor_id ? (costTractors ?? []).find((t) => t.id === trip.tractor_id) ?? null : null;
    return computeTripCost({
      trip,
      tractor,
      operatorCategories: costCategories?.categories ?? [],
      members: costMembers ?? [],
      fuelPurchases: costFuel ?? [],
      sprayRecords: costSpray?.records ?? [],
      chemicalPricing: chemCosting.contextFor(trip),
      savedInputs: costSavedInputs?.inputs ?? [],
      paddocks: costPaddocks ?? [],
      historicalYields: costYields?.historical ?? [],
    });
  }, [trip, canSeeCosts, costTractors, costCategories, costMembers, costFuel, costSpray, chemCosting, costSavedInputs, costPaddocks, costYields]);

  // Resolve block names from paddock_ids jsonb (if present) or scalar paddock_id
  const blockNames: string[] = (() => {
    if (!trip) return [];
    const ids = Array.isArray(trip.paddock_ids) ? (trip.paddock_ids as string[]) : [];
    if (ids.length) {
      return ids
        .map((id) => paddockNameById.get(id) ?? null)
        .filter((v): v is string => !!v);
    }
    if (padName) return [padName];
    return [];
  })();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-screen sm:w-[95vw] md:w-[90vw] lg:w-[50vw] sm:max-w-[1000px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{trip ? (canDeleteTrip ? (editTitle || tripDisplayName(trip)) : tripDisplayName(trip)) : "Trip"} — {fmtDay(trip?.start_time)}</SheetTitle>
          {trip?.work_task_id && (
            <div className="pt-1">
              <Badge variant="outline" className="font-normal">
                {workTaskLabelById.get(trip.work_task_id)
                  ? `Task: ${workTaskLabelById.get(trip.work_task_id)}`
                  : "Task linked"}
              </Badge>
            </div>
          )}
        </SheetHeader>
        {trip && (() => {
          // Spraying trips are corrected inline in the worksheet, so the
          // separate dialog is only offered for other trip types.
          const sprayingTrip = isSprayingTrip({
            tripFunction: trip.trip_function,
            hasLinkedSprayRecord: sprayLinkedTripIds?.has(trip.id),
          });
          return (
          <div className="mt-4 space-y-4 text-sm">
            <div className="flex flex-wrap justify-end gap-2">
              {canDeleteTrip && !sprayingTrip && (
                <Button size="sm" variant="outline" onClick={() => setEditDetailsOpen(true)}>
                  Edit trip details
                </Button>
              )}

              {showLifecycleActions && canDeleteTrip && isCompletable && (

                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setConfirmComplete(true)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Complete Trip
                </Button>
              )}
              {showLifecycleActions && canDeleteTrip && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete Trip
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  // Spraying trips (by function or by linked spray record) are
                  // always exported as the canonical Spray Report.
                  if (isSprayingTrip({
                    tripFunction: trip.trip_function,
                    hasLinkedSprayRecord: sprayLinkedTripIds?.has(trip.id),
                  })) {
                    const res = await downloadSprayReport({
                      tripId: trip.id,
                      formatters,
                      pathPoints: trip.path_points,
                      canSeeCosts,
                    });
                    if (!res.ok) {
                      toast({
                        title: "Spray Report unavailable",
                        description: res.error,
                        variant: "destructive",
                      });
                    }
                    return;
                  }
                  const pinCount = await countTripPins(trip);
                  await downloadTripPdf(trip, {
                    paddockName: padName ?? null,
                    tripDisplay: tripDisplayName(trip),
                    tripFunctionLabel: tripFunctionLabel(trip.trip_function),
                    vineyardName,
                    blockNames,
                    pinCount,
                    vineyardLogoUrl: vineyardLogoUrl ?? null,
                    paddockNameById,
                    cost: canSeeCosts ? cost : null,
                    formatters,
                    linkedTaskLabel: trip.work_task_id ? workTaskLabelById.get(trip.work_task_id) ?? "Task linked" : null,
                  });
                }}
              >
                {isSprayingTrip({
                  tripFunction: trip.trip_function,
                  hasLinkedSprayRecord: sprayLinkedTripIds?.has(trip.id),
                })
                  ? "Download Spray Report PDF"
                  : "Download Trip Report PDF"}
              </Button>

            </div>
            {!sprayingTrip && (
              <EditTripDetailsDialog
                trip={trip}
                vineyardId={vineyardId ?? null}
                open={editDetailsOpen}
                onOpenChange={setEditDetailsOpen}
              />
            )}
            <Section title="Route map">
              <TripRouteAppleMap pathPoints={trip.path_points} height={280} />
            </Section>
            {sprayingTrip && (
              <Section title="Spray worksheet">
                <SprayTripWorksheet
                  tripId={trip.id}
                  trip={trip}
                  vineyardId={vineyardId ?? null}
                  canEdit={canDeleteTrip}
                  summary={{
                    status: tripStatus(trip),
                    functionLabel: tripFunctionLabel(trip.trip_function),
                    title: trip.trip_title ?? null,
                    pattern: trip.tracking_pattern
                      ? formatTripPatternLabel(trip.tracking_pattern)
                      : null,
                    created: fmtDate(trip.created_at),
                    updated: fmtDate(trip.updated_at),
                    recordId: trip.id,
                  }}
                  coverage={{
                    rowsCovered: cov?.rowsCovered ?? 0,
                    completed: cov?.completed ?? completed,
                    partial: cov?.partial ?? 0,
                    skipped: cov?.skipped ?? skipped,
                    manuallyMarkedComplete: cov?.manuallyMarkedComplete ?? 0,
                    totalDistance:
                      trip.total_distance == null
                        ? null
                        : formatters.distance(Number(trip.total_distance) / 1000, 2),
                    pathPoints: points ?? null,
                    pins: pins ?? null,
                    activeTank:
                      trip.active_tank_number == null ? null : String(trip.active_tank_number),
                    totalTanks: trip.total_tanks == null ? null : String(trip.total_tanks),
                  }}
                />
              </Section>
            )}


            {!sprayingTrip && (
              <Section title="Schedule">
                <Field label="Date" value={fmtDate(trip.start_time)} />
                <Field label="Start time" value={trip.start_time ? new Date(trip.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} />
                <Field label="Finish time" value={trip.end_time ? new Date(trip.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} />
                <Field label="Duration" value={fmtDuration(trip.start_time, trip.end_time)} />
                <Field label="Status" value={tripStatus(trip)} />
              </Section>
            )}
            <Section title="Job record">
              {!sprayingTrip && (
                <Field label="Trip type / function" value={fmt(tripFunctionLabel(trip.trip_function))} />
              )}
              {canDeleteTrip ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <Label className="text-muted-foreground">Title / details</Label>
                  <div className="flex-1 flex items-center gap-2">
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={(e) => void handleSaveTitle(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleSaveTitle(e.currentTarget.value);
                        }
                      }}
                      disabled={savingTitle}
                      placeholder="Trip name"
                      className="h-8 text-right"
                    />
                    {savingTitle && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                </div>
              ) : (
                !sprayingTrip && <Field label="Title / details" value={fmt(trip.trip_title)} />
              )}
              {!sprayingTrip && (
                <>
                  <Field label={formatters.blockLabel} value={fmt(padName)} />
                  <Field label="Pattern" value={trip.tracking_pattern ? formatTripPatternLabel(trip.tracking_pattern) : "—"} />
                  <Field label="Person" value={fmt(trip.person_name)} />
                </>
              )}
            </Section>
            {fuelEstimate && (
              <Section title="Fuel estimate">
                <Field label="Machine" value={fmt(tractorName)} />
                <Field label="Trip function" value={fmt(tripFunctionLabel(trip.trip_function))} />
                <Field label="Basis" value={fuelEstimate.basisLabel} />
                {fuelEstimate.basis === "engine_hours" && (
                  <Field
                    label="Engine hour delta"
                    value={fuelEstimate.engineHourDelta != null ? `${fuelEstimate.engineHourDelta.toFixed(2)} hr` : "—"}
                  />
                )}
                {fuelEstimate.basis !== "engine_hours" && (
                  <Field label="Active hours" value={fmtHours(fuelEstimate.activeHours)} />
                )}
                <Field
                  label="Fuel rate"
                  value={
                    fuelEstimate.rateMissing
                      ? "Fuel rate missing"
                      : fuelEstimate.litresPerHour != null
                        ? `${fuelEstimate.litresPerHour.toFixed(2)} L/hr`
                        : "—"
                  }
                />
                <Field
                  label="Estimated litres"
                  value={fuelEstimate.litres != null ? `${fuelEstimate.litres.toFixed(1)} L` : "—"}
                />
                {canSeeCosts && (
                  <>
                    <Field
                      label="Fuel cost/L"
                      value={fuelEstimate.costPerLitre != null ? `${fmtCurrency(fuelEstimate.costPerLitre)}/L` : "Unavailable"}
                    />
                    <Field
                      label="Estimated fuel cost"
                      value={fuelEstimate.cost != null ? fmtCurrency(fuelEstimate.cost) : "Unavailable"}
                    />
                  </>
                )}
                {fuelEstimate.warnings.length > 0 && (
                  <div className="mt-2 rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {fuelEstimate.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                    </ul>
                  </div>
                )}
              </Section>
            )}
            {!sprayingTrip && canSeeCosts && cost && (
              <Section title="Estimated trip cost">
                <Field label="Active hours" value={fmtHours(cost.activeHours)} />
                <Field
                  label={`Labour${cost.labour.categoryName ? ` (${cost.labour.categoryName})` : ""}`}
                  value={
                    cost.labour.cost != null
                      ? `${fmtCurrency(cost.labour.cost)}${cost.labour.ratePerHour != null ? ` · ${fmtCurrency(cost.labour.ratePerHour)}/h` : ""}`
                      : "—"
                  }
                />
                <Field
                  label={`Fuel${cost.fuel.basisLabel ? ` (${cost.fuel.basisLabel})` : ""}`}
                  value={
                    cost.fuel.rateMissing
                      ? "Fuel rate missing"
                      : cost.fuel.litres == null
                        ? "—"
                        : `${cost.fuel.litres.toFixed(1)} L${cost.fuel.cost != null ? ` · ${fmtCurrency(cost.fuel.cost)}` : " · cost unavailable"}${cost.fuel.costPerLitre != null ? ` @ ${fmtCurrency(cost.fuel.costPerLitre)}/L` : ""}`
                  }
                />
                {cost.fuel.basis === "engine_hours" && cost.fuel.engineHourDelta != null && (
                  <Field label="Engine hour delta" value={`${cost.fuel.engineHourDelta.toFixed(2)} hr`} />
                )}
                {cost.fuel.basis === "trip_duration" && cost.fuel.hours != null && (
                  <Field label="Active hours (fuel)" value={fmtHours(cost.fuel.hours)} />
                )}
                {cost.fuel.litresPerHour != null && cost.fuel.litresPerHour > 0 && (
                  <Field label="Fuel rate" value={`${cost.fuel.litresPerHour.toFixed(2)} L/hr`} />
                )}
                <Field
                  label={`Chemicals${cost.chemicals.lineCount ? ` (${cost.chemicals.lineCount} line${cost.chemicals.lineCount === 1 ? "" : "s"})` : ""}`}
                  value={formatTripChemicalCost(cost.chemicals, fmtCurrency)}
                />
                {cost.inputs.lineCount > 0 && (
                  <Field
                    label={`Seed / inputs (${cost.inputs.lineCount} line${cost.inputs.lineCount === 1 ? "" : "s"})`}
                    value={cost.inputs.cost != null ? fmtCurrency(cost.inputs.cost) : "—"}
                  />
                )}
                <div className="border-t my-2" />
                <Field label="Estimated total" value={cost.total != null ? fmtCurrency(cost.total) : "—"} />
                <Field label="Treated area" value={cost.treatedAreaHa != null ? formatters.area(cost.treatedAreaHa) : "—"} />
                <Field label={`Cost per ${formatters.areaUnitLabel}`} value={cost.costPerHa != null ? `${fmtCurrency(formatters.areaUnitLabel === "ac" ? cost.costPerHa * 0.40468564224 : cost.costPerHa)} / ${formatters.areaUnitLabel}` : "Unavailable"} />
                <Field label="Yield tonnes" value={cost.yieldTonnes != null ? fmtTonnes(cost.yieldTonnes) : "Unavailable"} />
                <Field label="Cost per tonne" value={cost.costPerTonne != null ? `${fmtCurrency(cost.costPerTonne)} / t` : "Unavailable"} />
                {cost.warnings.length > 0 && (
                  <div className="mt-2 rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    <div className="font-medium mb-1">Missing data</div>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {cost.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                    </ul>
                  </div>
                )}
              </Section>
            )}
            {!sprayingTrip && (
              <Section title="Rows / paths">
                <Field label="Rows covered" value={String(cov?.rowsCovered ?? 0)} />
                <Field label="Completed" value={String(cov?.completed ?? completed)} />
                <Field label="Partial" value={String(cov?.partial ?? 0)} />
                <Field label="Skipped" value={String(cov?.skipped ?? skipped)} />
                <Field label="Manually marked complete" value={String(cov?.manuallyMarkedComplete ?? 0)} />
                <Field label="Total distance" value={trip.total_distance == null ? "—" : formatters.distance(Number(trip.total_distance) / 1000, 2)} />
                <Field label="Path points" value={points == null ? "—" : String(points)} />
                <Field label="Pins" value={pins == null ? "—" : String(pins)} />
              </Section>
            )}
            {corrections.length > 0 && (
              <Section title="Manual corrections">
                <ul className="space-y-1 list-disc pl-5">
                  {corrections.map((c, i) => (
                    <li key={i}>{formatCorrectionLine(c)}</li>
                  ))}
                </ul>
              </Section>
            )}
            {seeding && trip.trip_function === "seeding" && (
              <Section title="Seeding details">
                {seeding.boxes.map((b) => (
                  <Field
                    key={b.name}
                    label={b.name}
                    value={[b.contents, b.rate, b.notes].filter(Boolean).join(" · ") || "—"}
                  />
                ))}
                {seeding.sowing_depth_cm != null && (
                  <Field label="Sowing depth" value={`${seeding.sowing_depth_cm} cm`} />
                )}
                {seeding.mix_lines.map((line, i) => (
                  <Field
                    key={i}
                    label={`Mix line ${i + 1}`}
                    value={[line.name, line.percent && `${line.percent}%`, line.kg_per_ha && `${line.kg_per_ha} kg/ha`, line.supplier]
                      .filter(Boolean)
                      .join(" · ") || JSON.stringify(line.raw)}
                  />
                ))}
              </Section>
            )}
            {!sprayingTrip && (trip.total_tanks != null || trip.active_tank_number != null) && (
              <Section title="Tanks">
                <Field label="Active tank" value={fmt(trip.active_tank_number)} />
                <Field label="Total tanks" value={fmt(trip.total_tanks)} />
                <Field label="Filling" value={trip.is_filling_tank ? `Yes (#${trip.filling_tank_number ?? "?"})` : "No"} />
              </Section>
            )}
            {!sprayingTrip && (
              <Section title="Meta">
                <Field label="Created" value={fmtDate(trip.created_at)} />
                <Field label="Updated" value={fmtDate(trip.updated_at)} />
                <Field label="Record ID" value={trip.id} mono />
              </Section>
            )}
          </div>
          );
        })()}

        <AlertDialog open={confirmComplete} onOpenChange={(o) => !completing && setConfirmComplete(o)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Complete this trip?</AlertDialogTitle>
              <AlertDialogDescription>
                The trip will be marked as completed. The finish time will be set
                to now (unless one is already recorded), and the trip will no
                longer appear as paused or active.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={completing}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); void handleCompleteTrip(); }}
                disabled={completing}
              >
                {completing && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Complete trip
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={confirmDelete} onOpenChange={(o) => !deleting && setConfirmDelete(o)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this trip?</AlertDialogTitle>
              <AlertDialogDescription>
                The trip will be removed from the portal and the mobile app. It is a
                recoverable delete — the underlying record is retained and can be
                restored by VineTrack support if needed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); void handleDeleteTrip(); }}
                disabled={deleting}
              >
                {deleting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Delete trip
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>

    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      <div className="rounded-md border bg-card/50 p-3 space-y-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs break-all text-right" : "text-right"}>{value}</span>
    </div>
  );
}
