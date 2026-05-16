// Variety allocation editor — manages a list of { id, varietyKey, name, percent }
// rows that get written to paddocks.variety_allocations. Pure controlled
// component: parent owns state and persistence.
import { useMemo } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import VarietyPicker from "./VarietyPicker";

export interface VarietyAllocationRow {
  id: string;
  varietyKey: string | null;
  name: string | null;
  /** Vineyard catalogue row id, if the variety came from the picker. */
  varietyId?: string | null;
  percent: number;
}

interface Props {
  vineyardId: string | null | undefined;
  value: VarietyAllocationRow[];
  onChange: (rows: VarietyAllocationRow[]) => void;
  disabled?: boolean;
}

export const newAllocationRow = (): VarietyAllocationRow => ({
  id:
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `tmp-${Math.random().toString(36).slice(2)}`,
  varietyKey: null,
  name: null,
  varietyId: null,
  percent: 100,
});

export function totalPercent(rows: VarietyAllocationRow[]): number {
  return rows.reduce((s, r) => s + (Number.isFinite(r.percent) ? r.percent : 0), 0);
}

export function isAllocationsValid(rows: VarietyAllocationRow[]): boolean {
  if (rows.length === 0) return false;
  if (rows.some((r) => !r.varietyKey || !r.name)) return false;
  return Math.abs(totalPercent(rows) - 100) < 0.01;
}

/** Serialise editor rows into the JSON shape stored in paddocks.variety_allocations. */
export function serialiseAllocations(rows: VarietyAllocationRow[]) {
  return rows
    .filter((r) => r.varietyKey && r.name)
    .map((r) => ({
      id: r.id,
      varietyKey: r.varietyKey!,
      name: r.name!,
      percent: r.percent,
      ...(r.varietyId ? { varietyId: r.varietyId } : {}),
    }));
}

/** Hydrate stored allocations into editor rows. */
export function deserialiseAllocations(raw: any): VarietyAllocationRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a === "object")
    .map((a) => ({
      id:
        a.id ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `tmp-${Math.random().toString(36).slice(2)}`),
      varietyKey: a.varietyKey ?? a.variety_key ?? null,
      name: a.name ?? a.varietyName ?? a.variety_name ?? a.variety ?? null,
      varietyId: a.varietyId ?? a.variety_id ?? null,
      percent: typeof a.percent === "number" ? a.percent : 0,
    }));
}

export default function VarietyAllocationEditor({
  vineyardId,
  value,
  onChange,
  disabled,
}: Props) {
  const total = useMemo(() => totalPercent(value), [value]);
  const totalOk = Math.abs(total - 100) < 0.01;
  const usedKeys = value
    .map((r) => r.varietyKey)
    .filter((k): k is string => !!k);

  const update = (id: string, patch: Partial<VarietyAllocationRow>) => {
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const remove = (id: string) => {
    onChange(value.filter((r) => r.id !== id));
  };
  const add = () => {
    const remaining = Math.max(0, 100 - total);
    onChange([...value, { ...newAllocationRow(), percent: remaining || 0 }]);
  };
  const distributeEvenly = () => {
    if (value.length === 0) return;
    const each = Math.floor((100 / value.length) * 10) / 10;
    const rows = value.map((r, i) => ({ ...r, percent: each }));
    // Put remainder on last row so it sums to exactly 100.
    const diff = 100 - each * value.length;
    rows[rows.length - 1] = {
      ...rows[rows.length - 1],
      percent: Math.round((rows[rows.length - 1].percent + diff) * 100) / 100,
    };
    onChange(rows);
  };

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No varieties assigned. Add at least one variety totalling 100%.
        </p>
      )}

      {value.map((row, idx) => (
        <div
          key={row.id}
          className="grid grid-cols-[1fr_110px_36px] items-end gap-2"
        >
          <div className="space-y-1">
            {idx === 0 && <Label className="text-xs">Variety</Label>}
            <VarietyPicker
              vineyardId={vineyardId}
              value={row.varietyKey && row.name ? { varietyKey: row.varietyKey, name: row.name } : null}
              excludeKeys={usedKeys.filter((k) => k !== row.varietyKey)}
              disabled={disabled}
              onSelect={(v) =>
                update(row.id, {
                  varietyKey: v.varietyKey,
                  name: v.name,
                  varietyId: v.id ?? null,
                })
              }
            />
          </div>
          <div className="space-y-1">
            {idx === 0 && <Label className="text-xs">Percent</Label>}
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              inputMode="decimal"
              value={Number.isFinite(row.percent) ? row.percent : 0}
              onChange={(e) =>
                update(row.id, { percent: Number(e.target.value) || 0 })
              }
              disabled={disabled}
            />
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => remove(row.id)}
            disabled={disabled}
            aria-label="Remove variety"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={add}
            disabled={disabled}
            className="gap-1"
          >
            <Plus className="h-3 w-3" /> Add variety
          </Button>
          {value.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={distributeEvenly}
              disabled={disabled}
            >
              Distribute evenly
            </Button>
          )}
        </div>
        <span className={totalOk ? "text-muted-foreground" : "text-destructive font-medium"}>
          Total: {total.toFixed(1)}% {totalOk ? "" : "(must equal 100%)"}
        </span>
      </div>

      {value.length > 0 && !totalOk && (
        <Alert variant="destructive">
          <AlertDescription>
            Variety percentages must total exactly 100%.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
