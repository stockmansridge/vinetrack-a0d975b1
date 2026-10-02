// Chemical Lookup V3 — structured, human-readable review rendering.
// Never JSON-stringifies uses or rate options; never converts between bases.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRateOption, pick, textList, textOf } from "@/lib/chemicalV3";

type Row = Record<string, any>;
export const TARGET_PREVIEW_COUNT = 5;

export function TargetList({ targets }: { targets: string[] }) {
  const [all, setAll] = useState(false);
  if (!targets.length) return null;
  const shown = all ? targets : targets.slice(0, TARGET_PREVIEW_COUNT);
  const more = targets.length - shown.length;
  return (
    <div className="text-sm">
      {shown.join(", ")}
      {more > 0 && (
        <>
          {" "}<span className="text-muted-foreground">+{more} more</span>{" "}
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setAll(true)}>Show all {targets.length}</Button>
        </>
      )}
      {all && targets.length > TARGET_PREVIEW_COUNT && (
        <Button variant="link" size="sm" className="ml-2 h-auto p-0" onClick={() => setAll(false)}>Show fewer</Button>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-semibold uppercase text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function TextBlock({ title, value }: { title: string; value: string }) {
  if (!value) return null;
  return <Block title={title}><p className="whitespace-pre-wrap text-sm">{value}</p></Block>;
}

export function VineyardUseCard({ use }: { use: Row }) {
  const crop = textOf(pick(use, "crop_situation", "situation", "crop", "crops")) || "Situation not stated";
  const targets = textList(pick(use, "targets", "target", "weeds", "pests"));
  return (
    <div className="space-y-2 rounded border p-3" data-testid="v3-use-card">
      <div className="font-medium">{crop}</div>
      {targets.length > 0 && <Block title="Targets"><TargetList targets={targets} /></Block>}
      <TextBlock title="Application" value={textOf(pick(use, "application_directions", "directions", "method", "methods", "application_method"))} />
      <TextBlock title="Restrictions" value={textOf(pick(use, "restrictions", "critical_comments", "comments"))} />
      <TextBlock title="Withholding" value={textOf(pick(use, "withholding_statement", "withholding_text", "withholding_period", "withholding"))} />
      <TextBlock title="Re-entry" value={textOf(pick(use, "re_entry_statement", "re_entry_text", "re_entry_period", "re_entry"))} />
    </div>
  );
}

export interface RateEditHandlers {
  onEdit: (option: Row) => void;
  onDelete: (option: Row) => void;
  disabled?: boolean;
}

export function RateOptionCard({ option, edit }: { option: Row; edit?: RateEditHandlers }) {
  const targets = textList(pick(option, "targets", "target"));
  const methods = textOf(pick(option, "methods", "method"));
  const condition = textOf(pick(option, "condition", "conditions"));
  const hasId = pick(option, "id", "option_id") != null;
  return (
    <div className="space-y-1 rounded border p-2" data-testid="v3-rate-card">
      <div className="flex items-start justify-between gap-2">
        <div className="text-base font-semibold">{formatRateOption(option)}</div>
        {edit && (
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="outline" className="h-7" disabled={edit.disabled} onClick={() => edit.onEdit(option)}>Edit</Button>
            <Button size="sm" variant="outline" className="h-7 text-destructive" disabled={edit.disabled || !hasId} onClick={() => edit.onDelete(option)}>Delete</Button>
          </div>
        )}
      </div>
      {targets.length > 0 && <TargetList targets={targets} />}
      {methods && <div className="text-xs font-medium">{methods}</div>}
      {condition && <div className="text-xs text-muted-foreground">{condition}</div>}
    </div>
  );
}

export function RateColumn({ title, items, testId, edit, onAdd, addLabel }: {
  title: string; items: Row[]; testId?: string; edit?: RateEditHandlers; onAdd?: () => void; addLabel?: string;
}) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{title} ({items.length})</div>
        {onAdd && <Button size="sm" variant="outline" className="h-7" disabled={edit?.disabled} onClick={onAdd}>{addLabel ?? "+ Add rate"}</Button>}
      </div>
      {items.length === 0 ? <p className="text-xs text-muted-foreground">None extracted</p> : (
        <div className="space-y-2">{items.map((o, i) => <RateOptionCard key={pick(o, "id", "option_id") ?? i} option={o} edit={edit} />)}</div>
      )}
    </div>
  );
}

export function V3DataSummary({ uses, perHa, per100L }: { uses: number; perHa: number; per100L: number }) {
  return (
    <div className="flex flex-wrap gap-4 rounded border bg-muted/40 p-2 text-sm" data-testid="v3-data-summary">
      <span>Vineyard uses: <b>{uses}</b></span>
      <span>Per hectare options: <b>{perHa}</b></span>
      <span>Per 100 L options: <b>{per100L}</b></span>
    </div>
  );
}

export function V3Warnings({ warnings, className }: { warnings: unknown[]; className?: string }) {
  const items = warnings.map(textOf).filter(Boolean);
  return (
    <section
      data-testid="v3-warnings"
      className={cn("rounded border p-2", items.length ? "border-warning/50 bg-warning/10" : "border-border bg-muted/40", className)}
    >
      <h3 className="font-semibold">Warnings{items.length ? ` (${items.length}) — review before approval` : ""}</h3>
      {items.length ? <ul className="list-disc pl-5 text-sm">{items.map((w, i) => <li key={i}>{w}</li>)}</ul> : <p className="text-sm">None</p>}
    </section>
  );
}
