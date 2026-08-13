// SQL 190 — the ONE labour editor for a pruning activity.
//
// A pruning activity owns its labour lines directly. This editor is the only
// place the portal captures pruning labour; the linked Work Task card is a
// read-only mirror and never offers a second labour editor.
import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import WorkTaskLabourFields, {
  emptyLabourValue, labourTotals, labourTypeName, useLabourTypes,
  type LabourFieldsValue,
} from "@/components/work-tasks/WorkTaskLabourFields";
import type { PruningActivityLabourLine, PruningLabourLinePayload } from "@/lib/pruningActivityLabour";

export interface PruningLabourLineDraft extends LabourFieldsValue {
  /** Stable key for React; not sent to the server. */
  key: string;
  /** Server id when this line already exists. */
  id: string | null;
  workDate: string;
  notes: string;
}

export const newLabourLineDraft = (workDate: string): PruningLabourLineDraft => ({
  ...emptyLabourValue(),
  key: crypto.randomUUID(),
  id: null,
  workDate,
  notes: "",
});

/** Server rows -> editor drafts. */
export function labourDraftsFromLines(
  lines: PruningActivityLabourLine[],
): PruningLabourLineDraft[] {
  return lines
    .filter((l) => !l.deleted_at)
    .map((l) => ({
      key: l.id,
      id: l.id,
      workDate: (l.work_date ?? "").slice(0, 10),
      workerTypeId: l.worker_type_id ?? null,
      workerCount: l.worker_count == null ? "" : String(l.worker_count),
      hoursPerWorker: l.hours_per_worker == null ? "" : String(Number(l.hours_per_worker)),
      hourlyRate: l.hourly_rate == null ? "" : String(Number(l.hourly_rate)),
      notes: l.notes ?? "",
    }));
}

/** Editor drafts -> the RPC payload. Empty lines are dropped. */
export function labourPayloadFromDrafts(
  drafts: PruningLabourLineDraft[],
  categories: { id: string; name: string | null; cost_per_hour?: number | string | null }[],
  fallbackWorker?: string | null,
): PruningLabourLinePayload[] {
  return drafts
    .map((d) => {
      const totals = labourTotals(d, categories as any);
      if (totals.people == null && totals.hoursEach == null) return null;
      return {
        id: d.id,
        work_date: d.workDate || null,
        worker_type_id: d.workerTypeId,
        worker_type: labourTypeName(d, categories as any, fallbackWorker ?? null),
        worker_count: totals.people,
        hours_per_worker: totals.hoursEach,
        hourly_rate: totals.rate,
        notes: d.notes || null,
      } as PruningLabourLinePayload;
    })
    .filter((l): l is PruningLabourLinePayload => !!l);
}

interface Props {
  vineyardId: string;
  value: PruningLabourLineDraft[];
  onChange: (next: PruningLabourLineDraft[]) => void;
  /** Default work date for new lines. */
  workDate: string;
  disabled?: boolean;
  money?: (n: number) => string;
}

export default function PruningLabourLinesEditor({
  vineyardId, value, onChange, workDate, disabled, money,
}: Props) {
  const cats = useLabourTypes(vineyardId).data ?? [];
  const fmt = money ?? ((n: number) => `$${n.toFixed(2)}`);

  const totals = useMemo(() => {
    let hours = 0;
    let cost = 0;
    let rated = 0;
    value.forEach((d) => {
      const t = labourTotals(d, cats);
      hours += t.totalHours ?? 0;
      if (t.rate != null && t.totalHours != null) { rated += 1; cost += t.totalCost ?? 0; }
    });
    return {
      hours: Math.round(hours * 100) / 100,
      cost: rated ? Math.round(cost * 100) / 100 : null,
      rated,
    };
  }, [value, cats]);

  const patch = (key: string, next: Partial<PruningLabourLineDraft>) =>
    onChange(value.map((d) => (d.key === key ? { ...d, ...next } : d)));

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label>Labour</Label>
          <p className="text-xs text-muted-foreground">
            Labour belongs to this pruning activity. Add one line per crew or worker type —
            each line is people × hours each, costed at its own rate.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={disabled}
          onClick={() => onChange([...value, newLabourLineDraft(workDate)])}>
          <Plus className="h-4 w-4 mr-1" /> Add labour line
        </Button>
      </div>

      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No labour lines. This activity will have no recorded labour hours or cost.
        </p>
      )}

      {value.map((line, i) => (
        <div key={line.key} className="space-y-2 rounded border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Line {i + 1}
            </span>
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
              aria-label={`Remove labour line ${i + 1}`} disabled={disabled}
              onClick={() => onChange(value.filter((d) => d.key !== line.key))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Work date</Label>
              <Input type="date" value={line.workDate} disabled={disabled}
                onChange={(e) => patch(line.key, { workDate: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Input value={line.notes} placeholder="Optional" disabled={disabled}
                onChange={(e) => patch(line.key, { notes: e.target.value })} />
            </div>
          </div>
          <WorkTaskLabourFields
            categories={cats}
            money={fmt}
            value={line}
            disabled={disabled}
            onChange={(next) => patch(line.key, next)}
          />
        </div>
      ))}

      {value.length > 0 && (
        <div className="rounded bg-muted/40 px-3 py-2 text-sm tabular-nums">
          <div className="text-xs text-muted-foreground mb-0.5">Activity labour total</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{totals.hours.toFixed(2)} h</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-semibold">{totals.cost != null ? fmt(totals.cost) : "—"}</span>
            {totals.cost == null && (
              <span className="text-xs text-muted-foreground">
                No rate on any line — cost is unknown, not zero.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
