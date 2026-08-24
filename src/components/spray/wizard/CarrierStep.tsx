// Canopy & Spray Volume — the operator answers the canopy, sees the AWRI
// dilute/run-off recommendation, then records what the sprayer actually puts
// out. The recommendation is never written into the application by itself:
// the applied volume is always an explicit operator decision.
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CARRIER_BASES,
  CARRIER_BASIS_CHOICE_HINT,
  CARRIER_BASIS_CHOICE_LABEL,
} from "@/lib/sprayApplicationDomain";
import {
  CANOPY_DENSITIES,
  CANOPY_DENSITY_LABEL,
  CANOPY_SIZES,
  CANOPY_SIZE_DESCRIPTION,
  CANOPY_SIZE_LABEL,
  CANOPY_TYPES,
  CANOPY_TYPE_LABEL,
  canopyDiluteRange,
} from "@/lib/sprayCanopy";
import { fmtHa, fmtLitres, fmtNum, treatedProportionPct } from "@/lib/sprayFormat";
import type { StepProps } from "./types";

export function CarrierStep({ app, patch, geometry, calc, canEdit }: StepProps) {
  const carrier = calc.carrier;
  const setCarrier = (p: Partial<typeof app.carrier>) => patch({ carrier: { ...app.carrier, ...p } });
  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  if (app.operationType === "spreader") {
    return (
      <div className="rounded-md border bg-muted/30 p-4 text-sm">
        <div className="font-medium">No spray volume for spreader applications</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Solid product is spread directly, so canopy, water volume, dilute reference and tank loads
          do not apply. Product quantities are calculated from area on the Products step.
        </p>
      </div>
    );
  }

  const basis = app.carrier.basis;
  const isManual = basis === "manual";
  const treatedPct = treatedProportionPct(geometry.grossAreaHa, geometry.treatedAreaHa);
  const range = canopyDiluteRange(app.carrier.canopyType, app.carrier.canopySize);
  const recPer100m = carrier.recommendedDiluteLitresPer100m;
  const recPerHa = carrier.recommendedDiluteLitresPerHectare;

  /** Push the recommendation into the dilute reference for the active basis. */
  const useRecommendation = () => {
    if (basis === "l_per_100m") {
      setCarrier({ sprayerOutputChoice: "recommended", diluteLitresPer100m: recPer100m });
    } else if (basis === "l_per_ha") {
      setCarrier({ sprayerOutputChoice: "recommended", diluteLitresPerHectare: recPerHa });
    }
  };

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
        <h3 className="text-sm font-semibold">How do you know your spray volume?</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {CARRIER_BASES.map((b) => (
            <button
              key={b}
              type="button"
              disabled={!canEdit}
              aria-pressed={basis === b}
              onClick={() => setCarrier({ basis: b, sprayerOutputChoice: null })}
              className={cn(
                "rounded-md border px-3 py-2 text-left text-sm transition",
                basis === b ? "border-primary bg-primary/10 ring-2 ring-primary" : "hover:bg-muted/50",
              )}
            >
              <div className="font-medium">{CARRIER_BASIS_CHOICE_LABEL[b]}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{CARRIER_BASIS_CHOICE_HINT[b]}</div>
            </button>
          ))}
        </div>
      </section>

      {isManual ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Total spray water</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="manual-total">Total water for this application (L)</Label>
              <Input
                id="manual-total"
                type="number" min="0" step="1" disabled={!canEdit}
                value={app.carrier.manualTotalLitres ?? ""}
                onChange={(e) => setCarrier({ manualTotalLitres: numOrNull(e.target.value) })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Manual entry bypasses the canopy tables and row geometry. The concentration factor is
            ×1.00, so per-100 L product rates are used exactly as written on the label.
          </p>
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Canopy</h3>
              <p className="text-xs text-muted-foreground">
                Sets the AWRI dilute (spray to run-off) recommendation. It is a recommendation only —
                what you spray is recorded below.
              </p>
            </div>

            <div className="space-y-1">
              <Label>Trellis</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {CANOPY_TYPES.map((t) => (
                  <Choice
                    key={t}
                    selected={app.carrier.canopyType === t}
                    disabled={!canEdit}
                    onClick={() => setCarrier({ canopyType: t })}
                    title={CANOPY_TYPE_LABEL[t]}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label>Canopy size</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {CANOPY_SIZES.map((s) => (
                  <Choice
                    key={s}
                    selected={app.carrier.canopySize === s}
                    disabled={!canEdit}
                    onClick={() => setCarrier({ canopySize: s })}
                    title={CANOPY_SIZE_LABEL[s]}
                    hint={
                      app.carrier.canopyType
                        ? CANOPY_SIZE_DESCRIPTION[app.carrier.canopyType][s]
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label>Canopy density</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {CANOPY_DENSITIES.map((d) => (
                  <Choice
                    key={d}
                    selected={app.carrier.canopyDensity === d}
                    disabled={!canEdit}
                    onClick={() => setCarrier({ canopyDensity: d })}
                    title={CANOPY_DENSITY_LABEL[d]}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Recommended dilute volume
              </div>
              {recPer100m != null ? (
                <>
                  <div className="font-medium">
                    {fmtNum(recPer100m, 0)} L/100 m
                    {recPerHa != null ? ` · ${fmtNum(recPerHa, 0)} L/ha` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {range ? `AWRI range ${range.low}–${range.high} L/100 m for this canopy. ` : ""}
                    {recPerHa == null
                      ? "L/ha needs a known row spacing."
                      : `Converted with this vineyard's row spacing (${fmtNum(geometry.rowSpacingMetres, 2)} m).`}
                  </div>
                  {canEdit && (basis === "l_per_100m" || basis === "l_per_ha") && (
                    <button
                      type="button"
                      onClick={useRecommendation}
                      className="mt-2 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                    >
                      Use as my dilute reference
                    </button>
                  )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Answer trellis, size and density to see the recommendation.
                </div>
              )}
            </div>
          </section>

          {basis === "l_per_ha" && (
            <section className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Applied water (L/ha)</Label>
                <Input
                  type="number" min="0" step="1" disabled={!canEdit}
                  value={app.carrier.litresPerHectare ?? ""}
                  onChange={(e) =>
                    setCarrier({ litresPerHectare: numOrNull(e.target.value), sprayerOutputChoice: "custom" })
                  }
                />
                <p className="text-xs text-muted-foreground">What the sprayer actually puts out.</p>
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

          {basis === "l_per_100m" && (
            <section className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Applied water (L/100 m of row)</Label>
                <Input
                  type="number" min="0" step="0.1" disabled={!canEdit}
                  value={app.carrier.appliedLitresPer100m ?? ""}
                  onChange={(e) =>
                    setCarrier({ appliedLitresPer100m: numOrNull(e.target.value), sprayerOutputChoice: "custom" })
                  }
                />
                <p className="text-xs text-muted-foreground">What the sprayer actually puts out.</p>
              </div>
              <div className="space-y-1">
                <Label>Dilute reference (L/100 m)</Label>
                <Input
                  type="number" min="0" step="0.1" disabled={!canEdit}
                  value={app.carrier.diluteLitresPer100m ?? ""}
                  onChange={(e) => setCarrier({ diluteLitresPer100m: numOrNull(e.target.value) })}
                />
                {recPer100m != null && app.carrier.diluteLitresPer100m == null && (
                  <p className="text-xs text-muted-foreground">
                    Recommended {fmtNum(recPer100m, 0)} L/100 m.
                  </p>
                )}
              </div>
            </section>
          )}
        </>
      )}

      <section className="space-y-2 rounded-md border bg-muted/30 p-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Spray volume summary</h4>
          {carrier.concentrationFactor != null && (
            <Badge variant="secondary">
              {carrier.concentrationFactorSource === "persisted"
                ? "Recorded"
                : carrier.concentrationFactorSource === "manual"
                  ? "Manual"
                  : "Calculated"}{" "}
              CF ×{fmtNum(carrier.concentrationFactor, 2)}
            </Badge>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-3 text-sm">
          <Fact label="Total water" value={fmtLitres(carrier.totalCarrierLitres)} />
          <Fact
            label={carrier.derivedRatesAreReferenceOnly ? "L/ha (reference)" : "Effective L/ha"}
            value={carrier.litresPerHectare != null ? fmtNum(carrier.litresPerHectare, 1) : "—"}
          />
          <Fact
            label={carrier.derivedRatesAreReferenceOnly ? "L/100 m (reference)" : "Effective L/100 m"}
            value={carrier.litresPer100m != null ? fmtNum(carrier.litresPer100m, 2) : "—"}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {isManual
            ? "Total water is exactly what you entered. Any per-hectare or per-100 m figure shown is a derived reference only."
            : carrier.basis === "l_per_100m"
              ? "Total water = L/100 m × (total row length ÷ 100)."
              : "Total water = L/ha × whole block area."}
          {!isManual && carrier.carrierAreaHa != null && ` Applied over ${fmtHa(carrier.carrierAreaHa)}.`}
        </p>
        {carrier.concentrationFactor != null && carrier.concentrationFactor > 1 && (
          <p className="text-xs text-muted-foreground">
            CF = dilute ÷ applied, floored at 1.00. Per-100 L label rates are multiplied by it so the
            block still receives the labelled dose.
          </p>
        )}
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

function Choice({
  selected,
  disabled,
  onClick,
  title,
  hint,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-2 text-left text-sm transition",
        selected ? "border-primary bg-primary/10 ring-2 ring-primary" : "hover:bg-muted/50",
      )}
    >
      <div className="font-medium">{title}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </button>
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
