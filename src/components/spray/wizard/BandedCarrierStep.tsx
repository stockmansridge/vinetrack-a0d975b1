// Ground Spray Volume — Banded (Undervine / Midrow) applications.
//
// A Banded spray is a direct ground application. No canopy, no AWRI dilute
// recommendation, no concentration factor and no L/100 m entry. The operator
// states the band width, the water basis (L/ha or Manual total) and — for
// L/ha — whether the rate is per treated or per gross hectare.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BANDED_CARRIER_BASES,
  CARRIER_AREA_BASES,
  CARRIER_AREA_BASIS_LABEL,
  type CarrierBasis,
  type SprayApplication,
} from "@/lib/sprayApplicationDomain";
import type { ApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import type { SprayCalculationResult } from "@/lib/sprayCalculation";
import { fmtHa, fmtLitres, fmtNum } from "@/lib/sprayFormat";
import { SelectTile } from "./controls";

const BASIS_TITLE: Record<string, string> = { l_per_ha: "L/ha", manual: "Manual total water" };
const BASIS_HINT: Record<string, string> = {
  l_per_ha: "Sprayer applies a set water rate per hectare.",
  manual: "You already know the total water for this job.",
};

export function bandedDeferredLabel(app: SprayApplication): string {
  return app.isTemplate ? "Calculated when blocks are selected" : "Calculated when blocks are confirmed";
}

export function BandedCarrierStep({
  app, patch, geometry, calc, canEdit,
}: {
  app: SprayApplication;
  patch: (p: Partial<SprayApplication>) => void;
  geometry: ApplicationGeometry;
  calc: SprayCalculationResult;
  canEdit: boolean;
}) {
  const setCarrier = (p: Partial<SprayApplication["carrier"]>) => patch({ carrier: { ...app.carrier, ...p } });
  const numOrNull = (v: string) => (v === "" ? null : Number(v));
  const later = bandedDeferredLabel(app);
  const deferred = app.isTemplate || calc.blocksDeferred;
  const basis = app.carrier.basis;
  const areaBasis = app.carrier.carrierAreaBasis ?? null;
  const unit = areaBasis === "treated_area" ? "L/treated ha" : areaBasis === "whole_block_area" ? "L/gross ha" : "L/ha";
  const carrier = calc.carrier;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Treated band</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="band-width">Total treated band width per row (m)</Label>
            <Input
              id="band-width" type="number" step="0.01" min="0" disabled={!canEdit}
              value={app.totalTreatedBandWidthMetres ?? ""}
              onChange={(e) => patch({ totalTreatedBandWidthMetres: numOrNull(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">Both sides combined — not the width of a single band.</p>
          </div>
          <Stat label="Gross / whole-block area" value={deferred ? later : fmtHa(geometry.grossAreaHa)} />
          <Stat label="Treated area" value={deferred ? later : fmtHa(geometry.treatedAreaHa)} />
        </div>
      </section>

      <section className="space-y-2" role="radiogroup" aria-label="Spray volume basis">
        <h3 className="text-sm font-semibold">Spray volume basis</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {BANDED_CARRIER_BASES.map((b: CarrierBasis) => (
            <SelectTile
              key={b} selected={basis === b} disabled={!canEdit}
              onSelect={() => setCarrier({ basis: b })}
              title={BASIS_TITLE[b]} hint={BASIS_HINT[b]}
            />
          ))}
        </div>
        {basis === "l_per_100m" && (
          <p className="text-xs text-destructive">
            This job was saved with L/100 m. Banded ground sprays use L/ha or Manual total water — choose one above.
          </p>
        )}
      </section>

      {basis === "l_per_ha" && (
        <>
          <section className="space-y-2" role="radiogroup" aria-label="Rate applies to">
            <h3 className="text-sm font-semibold">Rate applies to</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {CARRIER_AREA_BASES.map((a) => (
                <SelectTile
                  key={a} selected={areaBasis === a} disabled={!canEdit}
                  onSelect={() => setCarrier({ carrierAreaBasis: a })}
                  title={CARRIER_AREA_BASIS_LABEL[a]}
                  hint={a === "treated_area" ? "Water rate per hectare of band actually sprayed." : "Water rate per gross block hectare."}
                />
              ))}
            </div>
          </section>
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="banded-rate">Application rate ({unit})</Label>
              <Input
                id="banded-rate" type="number" min="0" step="1" disabled={!canEdit}
                value={app.carrier.litresPerHectare ?? ""}
                onChange={(e) => setCarrier({ litresPerHectare: numOrNull(e.target.value) })}
              />
            </div>
            <Stat label="Calculation area" value={deferred ? later : fmtHa(carrier.carrierAreaHa)} />
            <Stat label="Total spray water" value={deferred ? later : fmtLitres(carrier.totalCarrierLitres)} />
          </section>
          {!deferred && carrier.totalCarrierLitres != null && carrier.carrierAreaHa != null && (
            <p className="text-xs text-muted-foreground">
              {fmtNum(app.carrier.litresPerHectare, 0)} {unit} × {fmtHa(carrier.carrierAreaHa)} = {fmtLitres(carrier.totalCarrierLitres)} total
              {calc.blocksDeferred ? "" : " (planning estimate — recalculated from the confirmed blocks before the trip)"}
            </p>
          )}
        </>
      )}

      {basis === "manual" && (
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="manual-total">Total spray water (L)</Label>
            <Input
              id="manual-total" type="number" min="0" step="1" disabled={!canEdit}
              value={app.carrier.manualTotalLitres ?? ""}
              onChange={(e) => setCarrier({ manualTotalLitres: numOrNull(e.target.value) })}
            />
          </div>
          {carrier.litresPerHectare != null && (
            <Stat label="L/gross ha (reference only)" value={fmtNum(carrier.litresPerHectare, 1)} />
          )}
          {geometry.treatedAreaHa != null && app.carrier.manualTotalLitres != null && (
            <Stat
              label="L/treated ha (reference only)"
              value={fmtNum(app.carrier.manualTotalLitres / geometry.treatedAreaHa, 1)}
            />
          )}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Ground spray — canopy and concentration factor are not used. Each product's own label rate basis is set on the Products step.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
