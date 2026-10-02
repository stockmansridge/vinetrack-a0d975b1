// Chemical Lookup V3 — structured, human-readable review rendering.
// Never JSON-stringifies uses or rate options; never converts between bases.
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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

/** Collapsed-by-default detail section. Renders nothing when there is no content. */
export function CollapsibleText({ title, value, testId }: { title: string; value: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  if (!value) return null;
  return (
    <div data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {title}
      </button>
      {open && <p className="mt-1 whitespace-pre-wrap pl-5 text-sm">{value}</p>}
    </div>
  );
}

export const SHORT_METHOD_MAX = 30;

export function VineyardUseCard({ use }: { use: Row }) {
  const crop = textOf(pick(use, "crop_situation", "situation", "crop", "crops")) || "Situation not stated";
  const targets = textList(pick(use, "targets", "target", "weeds", "pests"));
  const withholding = textOf(pick(use, "withholding_statement", "withholding_text", "withholding_period", "withholding"));
  const reEntry = textOf(pick(use, "re_entry_statement", "re_entry_text", "re_entry_period", "re_entry"));
  const whRe = [withholding && `Withholding: ${withholding}`, reEntry && `Re-entry: ${reEntry}`].filter(Boolean).join("\n");
  return (
    <div className="space-y-1.5 rounded border p-3" data-testid="v3-use-card">
      <div className="font-medium">{crop}</div>
      {targets.length > 0 && <TargetList targets={targets} />}
      <CollapsibleText title="Application instructions" value={textOf(pick(use, "application_directions", "directions", "method", "methods", "application_method"))} />
      <CollapsibleText title="Restrictions" value={textOf(pick(use, "restrictions", "critical_comments", "comments"))} />
      <CollapsibleText title="Withholding / re-entry" value={whRe} />
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
  const shortMethod = methods && methods.length <= SHORT_METHOD_MAX ? methods : "";
  const directions = textOf(pick(option, "application_directions", "directions", "application"));
  const application = [shortMethod ? "" : methods, directions].filter(Boolean).join("\n");
  const condition = [textOf(pick(option, "condition", "conditions")), textOf(pick(option, "restrictions"))].filter(Boolean).join("\n");
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
      {shortMethod && <div className="text-xs font-medium">{shortMethod}</div>}
      <CollapsibleText title="Application instructions" value={application} testId="v3-rate-application" />
      <CollapsibleText title="Restrictions / conditions" value={condition} testId="v3-rate-conditions" />
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

/** Whole Vineyard uses section — collapsed by default so the cards are not rendered until asked. */
export function VineyardUsesSection({ uses }: { uses: Row[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-2 rounded border bg-card p-3" data-testid="v3-uses-section">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Vineyard uses ({uses.length})</h3>
        {uses.length > 0 && <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Show"}</Button>}
      </div>
      {!uses.length && <p className="text-sm text-muted-foreground">None extracted</p>}
      {open && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="v3-uses-grid">
          {uses.map((u, i) => <VineyardUseCard key={i} use={u} />)}
        </div>
      )}
    </section>
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
