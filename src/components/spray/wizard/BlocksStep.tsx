// Stage 3B — Blocks step: block selection by UUID plus per-block geometry.
import { useState } from "react";
import { AlertTriangle, Settings2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  GEOMETRY_SOURCE_FRIENDLY,
  blockGeometrySummary,
  fmtHa,
  fmtLitres,
  fmtNum,
  fmtQuantity,
} from "@/lib/sprayFormat";
import type { StepProps } from "./types";

const blockName = (p: any) => p?.name ?? p?.block_name ?? "Unnamed block";
const blockVariety = (p: any) => p?.variety ?? p?.grape_variety ?? null;
const blockAreaHa = (p: any): number | null => {
  const v = Number(p?.area_ha ?? p?.hectares ?? NaN);
  return Number.isFinite(v) && v > 0 ? v : null;
};

export function BlocksStep({ app, patch, geometry, calc, lookups, canEdit }: StepProps) {
  const [showOverride, setShowOverride] = useState(
    !!(app.geometryOverride.grossAreaHa ||
      app.geometryOverride.rowSpacingMetres ||
      app.geometryOverride.canonicalRowLengthMetres),
  );

  const toggle = (id: string) =>
    patch({
      blockIds: app.blockIds.includes(id)
        ? app.blockIds.filter((x) => x !== id)
        : [...app.blockIds, id],
    });

  const setOverride = (key: keyof typeof app.geometryOverride, value: string) =>
    patch({
      geometryOverride: {
        ...app.geometryOverride,
        [key]: value === "" ? null : Number(value),
      },
    });

  if (app.isTemplate) {
    return (
      <div className="rounded-md border bg-muted/30 p-4 text-sm">
        <div className="font-medium">Templates do not carry blocks</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Blocks are chosen when the template is used, so geometry and quantities are always
          calculated fresh for the job being planned.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Select blocks</h3>
        <div className="divide-y rounded-md border">
          {lookups.paddocks.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground">No blocks for this vineyard.</div>
          )}
          {lookups.paddocks.map((p: any) => {
            const checked = app.blockIds.includes(p.id);
            const spacing = Number(p.row_width);
            return (
              <label
                key={p.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40",
                  checked && "bg-primary/5",
                )}
              >
                <Checkbox checked={checked} disabled={!canEdit} onCheckedChange={() => toggle(p.id)} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{blockName(p)}</span>
                  {blockVariety(p) && (
                    <span className="ml-2 text-xs text-muted-foreground">{blockVariety(p)}</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {Number.isFinite(spacing) && spacing > 0 ? `${fmtNum(spacing, 2)} m rows` : "Row spacing unknown"}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Geometry</h3>
          {canEdit && (
            <Button type="button" size="sm" variant="outline" onClick={() => setShowOverride((v) => !v)}>
              <Settings2 className="mr-1 h-3.5 w-3.5" /> Adjust geometry
            </Button>
          )}
        </div>

        {app.blockIds.length === 0 && (
          <p className="text-xs text-muted-foreground">Select blocks to see their geometry.</p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {geometry.blocks.map((b) => (
            <div key={b.blockId} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{b.blockName ?? "Block"}</span>
                <Badge variant={b.geometryQuality === "incomplete" ? "destructive" : "secondary"}>
                  {b.geometryQuality === "incomplete"
                    ? "Geometry incomplete"
                    : GEOMETRY_SOURCE_FRIENDLY[b.geometrySource]}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{blockGeometrySummary(b)}</div>
              {b.treatedAreaHa != null && app.mode === "banded" && (
                <div className="mt-1 text-xs">Treated: {fmtHa(b.treatedAreaHa)}</div>
              )}
              {b.issues.length > 0 && (
                <div className="mt-2 flex items-start gap-1 text-xs text-warning-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {b.issues.includes("missing_row_spacing") && "Row spacing is not recorded. "}
                    {b.issues.includes("missing_gross_area") && "Block area is not recorded. "}
                    {b.issues.includes("missing_row_length") && "Row length is not available. "}
                    {b.issues.includes("missing_band_width") && "Total treated band width is not set. "}
                    {b.issues.includes("missing_treated_area") && "Treated area cannot be calculated."}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        {app.blockIds.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <Fact label="Gross area" value={fmtHa(geometry.grossAreaHa)} />
              <Fact
                label="Row spacing"
                value={
                  geometry.uniformRowSpacing && geometry.rowSpacingMetres != null
                    ? `${fmtNum(geometry.rowSpacingMetres, 2)} m`
                    : "Mixed across selected blocks"
                }
              />
              <Fact
                label="Total row length"
                value={
                  geometry.canonicalRowLengthMetres != null
                    ? `${Math.round(geometry.canonicalRowLengthMetres).toLocaleString()} m`
                    : "Unavailable"
                }
              />
            </div>
          </div>
        )}

        {showOverride && (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="text-sm font-medium">Geometry override for this application</div>
            <p className="text-xs text-muted-foreground">
              These values are used for this application only. Block records are not changed.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Gross area (ha)</Label>
                <Input
                  type="number"
                  step="0.01"
                  disabled={!canEdit}
                  value={app.geometryOverride.grossAreaHa ?? ""}
                  onChange={(e) => setOverride("grossAreaHa", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Row spacing (m)</Label>
                <Input
                  type="number"
                  step="0.01"
                  disabled={!canEdit}
                  value={app.geometryOverride.rowSpacingMetres ?? ""}
                  onChange={(e) => setOverride("rowSpacingMetres", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Total row length (m)</Label>
                <Input
                  type="number"
                  step="1"
                  disabled={!canEdit}
                  value={app.geometryOverride.canonicalRowLengthMetres ?? ""}
                  onChange={(e) => setOverride("canonicalRowLengthMetres", e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
