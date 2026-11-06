// Correct the operational details of a recorded trip: which machine did the
// work, who drove it and the engine-hour readings. Frozen spray quantities,
// tracking data and the machine's global default fuel rate are never changed.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/ios-supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import {
  updateTripDetails,
  describeTripDetailsError,
  validateTripEngineHours,
  TRIP_FUEL_RATE_OVERRIDE_UNAVAILABLE,
  type Trip,
} from "@/lib/tripsQuery";
import {
  fetchAllVineyardMachines,
  machineTypeLabel,
  type VineyardMachine,
} from "@/lib/vineyardMachinesQuery";

const NONE = "__none__";

interface VineyardBlock {
  id: string;
  name: string | null;
}

async function fetchVineyardBlocks(vineyardId: string): Promise<VineyardBlock[]> {
  const { data, error } = await supabase
    .from("paddocks")
    .select("id, name")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as VineyardBlock[];
}

/** Current block selection for a trip: the jsonb list, else the legacy scalar. */
export function tripBlockIds(trip: Trip): string[] {
  const ids = Array.isArray(trip.paddock_ids)
    ? (trip.paddock_ids as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  if (ids.length) return ids;
  return trip.paddock_id ? [trip.paddock_id] : [];
}

function numOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) ? n : NaN;
}

export interface EditTripDetailsDialogProps {
  trip: Trip | null;
  vineyardId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save so the page and worksheet can refresh. */
  onSaved?: () => void;
}

export default function EditTripDetailsDialog({
  trip,
  vineyardId,
  open,
  onOpenChange,
  onSaved,
}: EditTripDetailsDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [machineId, setMachineId] = useState<string>(NONE);
  const [personName, setPersonName] = useState("");
  const [startHours, setStartHours] = useState("");
  const [endHours, setEndHours] = useState("");
  const [blockIds, setBlockIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: machines = [], isLoading: machinesLoading } = useQuery<VineyardMachine[]>({
    queryKey: ["edit-trip-machines", vineyardId],
    enabled: open && !!vineyardId,
    queryFn: () => fetchAllVineyardMachines(vineyardId!),
  });

  const { data: blocks = [], isLoading: blocksLoading } = useQuery<VineyardBlock[]>({
    queryKey: ["edit-trip-blocks", vineyardId],
    enabled: open && !!vineyardId,
    queryFn: () => fetchVineyardBlocks(vineyardId!),
  });

  // Hydrate from the trip only when the dialog opens, so typing is never
  // overwritten by a background refetch.
  useEffect(() => {
    if (!open || !trip) return;
    setMachineId(trip.machine_id ?? trip.tractor_id ?? NONE);
    setPersonName(trip.person_name ?? "");
    setStartHours(trip.start_engine_hours != null ? String(trip.start_engine_hours) : "");
    setEndHours(trip.end_engine_hours != null ? String(trip.end_engine_hours) : "");
    setBlockIds(tripBlockIds(trip));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trip?.id]);

  const toggleBlock = (id: string, checked: boolean) => {
    setBlockIds((prev) =>
      checked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((b) => b !== id),
    );
  };

  const selectedMachine = useMemo(
    () => machines.find((m) => m.id === machineId) ?? null,
    [machines, machineId],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!trip) return;
      const start = numOrNull(startHours);
      const end = numOrNull(endHours);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new Error("Engine hours must be numbers.");
      }
      const invalid = validateTripEngineHours(start, end);
      if (invalid) throw new Error(invalid);
      await updateTripDetails({
        tripId: trip.id,
        currentSyncVersion: trip.sync_version ?? null,
        userId: user?.id ?? null,
        edits: {
          // The chosen machine is the single source of truth for this trip:
          // write it to machine_id and clear the legacy tractor pointer so the
          // report, worksheet and costing all agree.
          machineId: machineId === NONE ? null : machineId,
          tractorId: null,
          personName: personName.trim() || null,
          startEngineHours: start,
          endEngineHours: end,
        },
      });
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries();
      toast({ title: "Trip details saved" });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e) => setError(describeTripDetailsError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit trip details</DialogTitle>
          <DialogDescription>
            Corrections apply to this trip only. Recorded spray quantities and the
            machine's saved default fuel rate are not changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="trip-machine">Tractor or machine</Label>
            <Select value={machineId} onValueChange={setMachineId} disabled={machinesLoading}>
              <SelectTrigger id="trip-machine">
                <SelectValue placeholder={machinesLoading ? "Loading…" : "Not recorded"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not recorded</SelectItem>
                {machines.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} · {machineTypeLabel(m.machine_type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trip-operator">Operator</Label>
            <Input
              id="trip-operator"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="Who drove this trip"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="trip-start-hours">Start engine hours</Label>
              <Input
                id="trip-start-hours"
                inputMode="decimal"
                value={startHours}
                onChange={(e) => setStartHours(e.target.value)}
                placeholder="Not recorded"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trip-end-hours">End engine hours</Label>
              <Input
                id="trip-end-hours"
                inputMode="decimal"
                value={endHours}
                onChange={(e) => setEndHours(e.target.value)}
                placeholder="Not recorded"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trip-fuel-rate">Fuel consumption for this trip (L/hr)</Label>
            <Input
              id="trip-fuel-rate"
              disabled
              value={
                selectedMachine?.fuel_usage_l_per_hour != null
                  ? `${selectedMachine.fuel_usage_l_per_hour} (machine default)`
                  : "Not recorded"
              }
              aria-describedby="trip-fuel-rate-note"
            />
            <p id="trip-fuel-rate-note" className="text-xs text-muted-foreground">
              {TRIP_FUEL_RATE_OVERRIDE_UNAVAILABLE}
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            The spray unit is recorded on the linked spray record, not on the trip.
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !trip}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
