// Shared Work Task labour fields + calculations.
//
// This is the ONE implementation of the labour-type / people / hours-per-person
// block and its derived totals. It is used by the Work Tasks page labour-line
// editor and by any wrapper that creates a Work Task (e.g. the pruning
// activity editor). Wrappers may prefill it, never reduce it.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  fetchOperatorCategoriesForVineyard, type OperatorCategory,
} from "@/lib/operatorCategoriesQuery";

export const LABOUR_TYPE_NONE = "__none__";

export interface LabourFieldsValue {
  /** Operator category (worker type) id, or null for none. */
  workerTypeId: string | null;
  /** Raw text inputs so the fields stay controlled and clearable. */
  workerCount: string;
  hoursPerWorker: string;
  /** Manual rate override used only when no labour type is selected. */
  hourlyRate?: string;
}

export const emptyLabourValue = (): LabourFieldsValue => ({
  workerTypeId: null, workerCount: "", hoursPerWorker: "", hourlyRate: "",
});

/**
 * Elapsed hours per person between two "HH:MM" times. Overnight work
 * (finish <= start) rolls into the next day.
 */
export function elapsedHoursBetween(start: string, finish: string): number | null {
  const parse = (v: string) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = parse(start);
  const b = parse(finish);
  if (a == null || b == null) return null;
  let mins = b - a;
  if (mins <= 0) mins += 24 * 60; // overnight
  return Math.round((mins / 60) * 100) / 100;
}

export interface LabourTotals {
  people: number | null;
  hoursEach: number | null;
  rate: number | null;
  /** people × hours each */
  totalHours: number | null;
  /** total person-hours × rate */
  totalCost: number | null;
}

export function labourTotals(
  value: LabourFieldsValue,
  categories: OperatorCategory[],
  fallbackRate?: number | null,
): LabourTotals {
  const cat = value.workerTypeId
    ? categories.find((c) => c.id === value.workerTypeId) ?? null
    : null;
  const manual = value.hourlyRate != null && value.hourlyRate !== "" ? Number(value.hourlyRate) : null;
  const rate =
    cat?.cost_per_hour != null ? Number(cat.cost_per_hour)
      : manual != null && Number.isFinite(manual) ? manual
      : fallbackRate ?? null;

  const people = value.workerCount === "" ? null : Number(value.workerCount);
  const hoursEach = value.hoursPerWorker === "" ? null : Number(value.hoursPerWorker);
  const valid = people != null && hoursEach != null && Number.isFinite(people) && Number.isFinite(hoursEach);
  const totalHours = valid ? Math.round(people! * hoursEach! * 100) / 100 : null;
  const totalCost = totalHours != null && rate != null ? Math.round(totalHours * rate * 100) / 100 : null;

  return { people, hoursEach, rate, totalHours, totalCost };
}

export function labourTypeName(
  value: LabourFieldsValue, categories: OperatorCategory[], fallback?: string | null,
): string | null {
  const cat = value.workerTypeId ? categories.find((c) => c.id === value.workerTypeId) : null;
  return cat?.name ?? fallback ?? null;
}

/** Operator categories for a vineyard, shared cache key. */
export function useLabourTypes(vineyardId: string | null | undefined) {
  return useQuery({
    queryKey: ["operator-categories", vineyardId],
    enabled: !!vineyardId,
    queryFn: async () => (await fetchOperatorCategoriesForVineyard(vineyardId!)).categories,
  });
}

interface Props {
  vineyardId?: string | null;
  /** Provide categories to avoid a second fetch; otherwise they are loaded. */
  categories?: OperatorCategory[];
  value: LabourFieldsValue;
  onChange: (next: LabourFieldsValue) => void;
  disabled?: boolean;
  /** Currency formatter from the caller's region settings. */
  money?: (n: number) => string;
  className?: string;
}

export default function WorkTaskLabourFields({
  vineyardId, categories, value, onChange, disabled, money, className,
}: Props) {
  const loaded = useLabourTypes(categories ? null : vineyardId);
  const cats = categories ?? loaded.data ?? [];
  const fmt = money ?? ((n: number) => `$${n.toFixed(2)}`);

  const totals = useMemo(() => labourTotals(value, cats), [value, cats]);
  const set = (patch: Partial<LabourFieldsValue>) => onChange({ ...value, ...patch });

  return (
    <div className={className ?? "space-y-2"}>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Labour type</Label>
          <Select
            value={value.workerTypeId ?? LABOUR_TYPE_NONE}
            onValueChange={(v) => set({ workerTypeId: v === LABOUR_TYPE_NONE ? null : v })}
            disabled={disabled}
          >
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={LABOUR_TYPE_NONE}>None</SelectItem>
              {cats.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {(c.name ?? c.id.slice(0, 8)) +
                    (c.cost_per_hour != null ? ` — ${fmt(Number(c.cost_per_hour))}/h` : "")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Hourly rate</Label>
          {value.workerTypeId ? (
            <Input value={totals.rate != null ? fmt(totals.rate) : "—"} readOnly disabled />
          ) : (
            <Input type="number" step="0.01" min="0" placeholder="Rate per hour"
              value={value.hourlyRate ?? ""} disabled={disabled}
              onChange={(e) => set({ hourlyRate: e.target.value })} />
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Number of people</Label>
          <Input type="number" step="1" min="0" value={value.workerCount} disabled={disabled}
            onChange={(e) => set({ workerCount: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Hours per person</Label>
          <Input type="number" step="0.25" min="0" value={value.hoursPerWorker} disabled={disabled}
            onChange={(e) => set({ hoursPerWorker: e.target.value })} />
        </div>
      </div>

      <div className="rounded border bg-muted/40 px-3 py-2">
        <div className="text-xs text-muted-foreground mb-1">Labour calculation</div>
        <div className="text-sm flex flex-wrap items-center gap-1 tabular-nums">
          <span>{value.workerCount || "—"} people</span>
          <span className="text-muted-foreground">×</span>
          <span>{value.hoursPerWorker || "—"}h each</span>
          <span className="text-muted-foreground">=</span>
          <span className="font-semibold">
            {totals.totalHours != null ? `${totals.totalHours.toFixed(2)} h` : "—"}
          </span>
          <span className="text-muted-foreground">
            @ {totals.rate != null ? `${fmt(totals.rate)}/h` : "no rate"}
          </span>
          <span className="text-muted-foreground">=</span>
          <span className="font-semibold">
            {totals.totalCost != null ? fmt(totals.totalCost) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
