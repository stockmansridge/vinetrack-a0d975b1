// Stage 3B — Carrier step: water volume basis, dilute reference, band width.
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CARRIER_BASES, CARRIER_BASIS_LABEL } from "@/lib/sprayApplicationDomain";
import { fmtHa, fmtLitres, fmtNum, treatedProportionPct } from "@/lib/sprayFormat";
import type { StepProps } from "./types";

export function CarrierStep({ app, patch, geometry, calc, canEdit }: StepProps) {
  const carrier = calc.carrier;
  const setCarrier = (p: Partial<typeof app.carrier>) => patch({ carrier: { ...app.carrier, ...p } });
  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  if (app.operationType === "spreader") {
    return (
      <div className="rounded-md border bg-muted/30 p-4 text-sm">
        <div className="font-medium">No carrier volume for spreader applications</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Solid product is spread directly, so water volume, dilute reference and tank loads do not apply.
          Product quantities are calculated from area on the Products step.
        </p>
      </div>
    );
  }

  const treatedPct = treatedProportionPct(geometry.grossAreaHa, geometry.treatedAreaHa);

  return (
    <div className="space-y-6">
      {app.mode === "banded" && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Treated band</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="band-width">Total treated width per row (m)</Label>
              <Input
                id="band-width"
                type="number"
                step="0.01"
                min="0"
                disabled={!canEdit}
                value={app.totalTreatedBandWidthMetres ?? ""}
                onChange={(e) => patch({ totalTreatedBandWidthMetres: numOrNull(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">
                Both sides combined — not the width of a single band.
              </p>
            </div>
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Treated area</div>
              <div className="font-medium">{fmtHa(geometry.treatedAreaHa)}</div>
              <div className="text-xs text-muted-foreground">
                {treatedPct != null ? `${fmtNum(treatedPct, 1)}% of ${fmtHa(geometry.grossAreaHa)} gross` : "Needs band width, row spacing and area"}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Water volume basis</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {CARRIER_BASES.map((b) => (
            <button
              key={b}
              type="button"
              disabled={!canEdit}
              aria-pressed={app.carrier.basis === b}
              onClick={() => setCarrier({ basis: b })}
              className={cn(
                "rounded-md border px-3 py-2 text-left text-sm transition",
                app.carrier.basis === b ? "border-primary bg-primary/10 ring-2 ring-primary" : "hover:bg-muted/50",
              )}
            >
              {CARRIER_BASIS_LABEL[b]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Water volume per hectare is always applied to the whole block area, even for banded applications.
        </p>
      </section>

      {app.carrier.basis === "l_per_ha" && (
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Applied water (L/ha)</Label>
            <Input
              type="number" min="0" step="1" disabled={!canEdit}
              value={app.carrier.litresPerHectare ?? ""}
              onChange={(e) => setCarrier({ litresPerHectare: numOrNull(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label>Dilute reference (L/ha)</Label>
            <Input
              type="number" min="0" step="1" disabled={!canEdit}
              value={app.carrier.diluteLitresPerHectare ?? ""}
              onChange={(e) => setCarrier({ diluteLitresPerHectare: numOrNull(e.target.value) })}
            />
          </div>
        </section>
      )}

      {app.carrier.basis === "l_per_100m" && (
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Applied water (L/100 m of row)</Label>
            <Input
              type="number" min="0" step="0.1" disabled={!canEdit}
              value={app.carrier.appliedLitresPer100m ?? ""}
              onChange={(e) => setCarrier({ appliedLitresPer100m: numOrNull(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label>Dilute reference (L/100 m)</Label>
            <Input
              type="number" min="0" step="0.1" disabled={!canEdit}
              value={app.carrier.diluteLitresPer100m ?? ""}
              onChange={(e) => setCarrier({ diluteLitresPer100m: numOrNull(e.target.value) })}
            />
          </div>
        </section>
      )}

      <section className="space-y-2 rounded-md border bg-muted/30 p-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Carrier summary</h4>
          {carrier.concentrationFactor != null && (
            <Badge variant="secondary">
              {carrier.concentrationFactorSource === "persisted" ? "Recorded" : "Calculated"} CF ×
              {fmtNum(carrier.concentrationFactor, 2)}
            </Badge>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-3 text-sm">
          <Fact label="Effective L/ha" value={carrier.litresPerHectare != null ? fmtNum(carrier.litresPerHectare, 1) : "—"} />
          <Fact label="Effective L/100 m" value={carrier.litresPer100m != null ? fmtNum(carrier.litresPer100m, 2) : "—"} />
          <Fact label="Total water" value={fmtLitres(carrier.totalCarrierLitres)} />
        </div>
        <p className="text-xs text-muted-foreground">
          {carrier.basis === "l_per_100m"
            ? "Total water = L/100 m × (total row length ÷ 100)."
            : "Total water = L/ha × whole block area."}
          {carrier.carrierAreaHa != null && ` Applied over ${fmtHa(carrier.carrierAreaHa)}.`}
        </p>
        {carrier.diagnostics.length > 0 && (
          <ul className="space-y-1 text-xs">
            {carrier.diagnostics.map((d, i) => (
              <li key={`${d.code}-${i}`} className="flex items-start gap-1">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>{d.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
