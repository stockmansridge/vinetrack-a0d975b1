// Master Catalogue Review — registered uses rendered as structured cards.
// Registered uses are NEVER shown as JSON here; the raw patch stays behind the
// optional technical disclosure in the dialog.
import { useState } from "react";
import { ChevronDown, ChevronRight, Grape } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  diffRegisteredUses,
  groupUseDiff,
  isGrapeUse,
  type UseDiffRow,
  type UseView,
} from "@/lib/masterPreviewDiff";

function Field({
  label,
  value,
  changed,
}: {
  label: string;
  value: string;
  changed?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className={`whitespace-pre-wrap break-words ${
          changed ? "rounded bg-warning/20 px-1 font-medium" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function UsePanel({
  use,
  heading,
  changedFields,
}: {
  use: UseView;
  heading: string;
  changedFields: string[];
}) {
  const ch = (f: string) => changedFields.includes(f);
  return (
    <div className="min-w-0 rounded border border-border/50 bg-background/60 p-2">
      <div className="mb-1 text-[10px] font-semibold text-muted-foreground">
        {heading}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Crop" value={use.crop} />
        <Field label="Target" value={use.target} />
        <Field label="Rate" value={use.ratesText} changed={ch("Rate")} />
        <Field label="Rate basis" value={use.rateBasisText} changed={ch("Rate basis")} />
        <Field label="WHP" value={use.whp} changed={ch("WHP")} />
        <Field label="Source" value={use.source} />
      </div>
      <div className="mt-2">
        <Field label="Restrictions" value={use.restrictions} changed={ch("Restrictions")} />
      </div>
    </div>
  );
}

function UseCard({ row }: { row: UseDiffRow }) {
  const head = row.proposed ?? row.current!;
  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {head.crop} — {head.target}
        </span>
        {isGrapeUse(head) && (
          <Badge variant="secondary" className="text-[10px]">
            <Grape className="mr-1 h-3 w-3" />
            Grapes
          </Badge>
        )}
        {row.changedFields.map((f) => (
          <Badge key={f} variant="outline" className="text-[10px]">
            {f} changed
          </Badge>
        ))}
      </div>
      {row.status === "changed" ? (
        <div className="grid gap-2 lg:grid-cols-2">
          <UsePanel use={row.current!} heading="Current" changedFields={row.changedFields} />
          <UsePanel use={row.proposed!} heading="Proposed" changedFields={row.changedFields} />
        </div>
      ) : (
        <UsePanel
          use={head}
          heading={
            row.status === "added" ? "Proposed" : row.status === "removed" ? "Current" : "Current"
          }
          changedFields={[]}
        />
      )}
    </div>
  );
}

function Group({
  title,
  rows,
  defaultOpen,
}: {
  title: string;
  rows: UseDiffRow[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-1 text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
        {title} ({rows.length})
      </Button>
      {open && <div className="space-y-2">{rows.map((r) => <UseCard key={r.key} row={r} />)}</div>}
    </div>
  );
}

export function MasterPreviewUsesDiff({
  label,
  current,
  proposed,
}: {
  label: string;
  current: unknown;
  proposed: unknown;
}) {
  const groups = groupUseDiff(diffRegisteredUses(current, proposed));
  return (
    <div className="rounded-md border border-border/60">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5 font-semibold">
        <span>{label}</span>
        <span className="font-normal text-muted-foreground">
          {groups.added.length} added · {groups.changed.length} changed ·{" "}
          {groups.removed.length} removed · {groups.unchanged.length} unchanged
        </span>
      </div>
      <div className="space-y-3 p-3">
        {groups.total === 0 ? (
          <div className="text-muted-foreground">No registered uses resolved.</div>
        ) : (
          <>
            <Group title="Added uses" rows={groups.added} defaultOpen />
            <Group title="Changed uses" rows={groups.changed} defaultOpen />
            <Group title="Removed uses" rows={groups.removed} defaultOpen />
            <Group title="Unchanged uses" rows={groups.unchanged} defaultOpen={false} />
          </>
        )}
      </div>
    </div>
  );
}
