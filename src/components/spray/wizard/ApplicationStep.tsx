// Stage 3B — Application step: job information + application type.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  OPERATION_TYPES,
  OPERATION_TYPE_LABEL,
  type OperationType,
} from "@/lib/sprayApplicationDomain";
import { applyOperationType, applyTemplate, hydrateDraft } from "@/lib/sprayApplicationDraft";
import { chemicalLinesSummary, fetchSprayJobs } from "@/lib/sprayJobsQuery";
import { SelectTile } from "./controls";
import type { StepProps } from "./types";

const STATUS_OPTIONS = ["draft", "scheduled", "in_progress", "completed", "cancelled"];

const OPERATION_HELP: Record<OperationType, string> = {
  foliar: "Sprayed over the canopy — carrier volume and head target apply.",
  banded: "Sprayed as a band along the row — treated area is calculated from the band width.",
  spreader: "Solid product spread over the block — no liquid carrier.",
};

export function ApplicationStep({ app, patch, update, canEdit, vineyardId, intelligenceById }: StepProps) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Job information</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="spray-name">Name</Label>
            <Input
              id="spray-name"
              value={app.name ?? ""}
              disabled={!canEdit}
              placeholder={app.isTemplate ? "e.g. Powdery mildew preventive" : "e.g. Block A spray — week 14"}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          {!app.isTemplate && (
            <>
              <div className="space-y-1">
                <Label htmlFor="spray-date">Planned date</Label>
                <Input
                  id="spray-date"
                  type="date"
                  disabled={!canEdit}
                  value={app.plannedDate ?? ""}
                  onChange={(e) => patch({ plannedDate: e.target.value || null })}
                />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select
                  value={app.status ?? "draft"}
                  disabled={!canEdit}
                  onValueChange={(v) => patch({ status: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="flex items-center gap-2 sm:col-span-2">
            <Checkbox
              id="spray-template"
              disabled={!canEdit}
              checked={app.isTemplate}
              onCheckedChange={(c) => patch({ isTemplate: !!c })}
            />
            <Label htmlFor="spray-template">Reusable template</Label>
            <span className="text-xs text-muted-foreground">
              Templates keep settings and products, never blocks.
            </span>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="spray-notes">Operator notes</Label>
            <Textarea
              id="spray-notes"
              rows={3}
              disabled={!canEdit}
              value={app.notes ?? ""}
              onChange={(e) => patch({ notes: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Application type</h3>
        {/* Same shared selector as Canopy & Spray Volume — one selection
            language across the whole wizard. */}
        <div role="radiogroup" aria-label="Application type" className="grid gap-3 sm:grid-cols-3">
          {OPERATION_TYPES.map((op) => (
            <SelectTile
              key={op}
              selected={app.operationType === op}
              disabled={!canEdit}
              onSelect={() => update((a) => applyOperationType(a, op))}
              title={OPERATION_TYPE_LABEL[op]}
              hint={OPERATION_HELP[op]}
            />
          ))}
        </div>
        {app.operationType === "banded" && (
          <p className="text-xs text-muted-foreground">
            Head target does not apply to banded applications and has been cleared.
          </p>
        )}
      </section>

      {!app.isTemplate && !app.id && canEdit && (
        <TemplatePicker
          vineyardId={vineyardId}
          intelligenceById={intelligenceById}
          onUse={(tplDraft) => update((a) => applyTemplate(a, tplDraft))}
        />
      )}
    </div>
  );
}

function TemplatePicker({
  vineyardId,
  intelligenceById,
  onUse,
}: {
  vineyardId: string;
  intelligenceById: Map<string, any>;
  onUse: (draft: ReturnType<typeof hydrateDraft>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["spray_jobs", vineyardId, "templates"],
    queryFn: () => fetchSprayJobs(vineyardId, { template: true, archived: false }),
  });
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) =>
      [t.name, t.target, t.operation_type, chemicalLinesSummary(t.chemical_lines)]
        .filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [templates, search]);

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
      <div className="text-sm">
        <div className="font-medium">Start from a template?</div>
        <p className="text-xs text-muted-foreground">
          Loads settings and products. Blocks, geometry and totals are always recalculated for this job.
        </p>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            <FileText className="mr-1 h-3.5 w-3.5" /> Use template
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="end">
          <div className="border-b p-2">
            <Input
              className="h-8"
              placeholder="Search templates…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {isLoading && <div className="p-3 text-xs text-muted-foreground">Loading…</div>}
            {!isLoading && filtered.length === 0 && (
              <div className="p-3 text-xs text-muted-foreground">No templates available.</div>
            )}
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                className="w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/60"
                onClick={() => {
                  onUse(
                    hydrateDraft({
                      vineyardId,
                      job: t,
                      isTemplate: true,
                      paddockIds: [],
                      intelligenceById,
                    }),
                  );
                  setOpen(false);
                }}
              >
                <div className="truncate font-medium">{t.name || "Untitled template"}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {chemicalLinesSummary(t.chemical_lines)}
                </div>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
