// Canopy & Spray Volume.
//
// The operator answers the canopy, sees the AWRI dilute (spray to run-off)
// reference, then says whether the sprayer is set to that recommendation or to
// their own rate. The dilute reference is NEVER typed in by hand: the canopy
// determines it, the operator only records what the sprayer actually applies,
// and the concentration factor is derived.
//
// A Program Step (`isTemplate`) is reusable configuration with no blocks by
// design, so nothing here requires block area, row length or row spacing.
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  SPRAY_HELP,
  canopyDiluteRange,
} from "@/lib/sprayCanopy";
import { CanopyReferenceImage } from "@/components/spray/CanopyReferenceImage";
import { fmtHa, fmtLitres, fmtNum, treatedProportionPct } from "@/lib/sprayFormat";
import { FieldHeading, HelpTip, SelectTile } from "./controls";
import type { StepProps } from "./types";

const LATER = "Calculated when blocks are selected";

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

  const isTemplate = !!app.isTemplate;
  const basis = app.carrier.basis;
  const isManual = basis === "manual";
  const treatedPct = treatedProportionPct(geometry.grossAreaHa, geometry.treatedAreaHa);
  const range = canopyDiluteRange(app.carrier.canopyType, app.carrier.canopySize);
  const recPer100m = carrier.recommendedDiluteLitresPer100m;
  const recPerHa = carrier.recommendedDiluteLitresPerHectare;
  const rowSpacing =
    geometry.uniformRowSpacing && geometry.rowSpacingMetres != null && geometry.rowSpacingMetres > 0
      ? geometry.rowSpacingMetres
      : null;
  const hasCanopy = !!app.carrier.canopyType && !!app.carrier.canopySize;

  const appliedValue =
    basis === "l_per_ha" ? app.carrier.litresPerHectare : app.carrier.appliedLitresPer100m;
  // Older rows never stored the choice; an entered rate means "my own rate".
  const choice = app.carrier.sprayerOutputChoice ?? (appliedValue != null ? "custom" : null);

  const chooseRecommended = () => {
    if (basis === "l_per_100m") {
      setCarrier({ sprayerOutputChoice: "recommended", appliedLitresPer100m: recPer100m });
    } else if (basis === "l_per_ha") {
      // With no row spacing we store the INTENT only — never an invented L/ha.
      setCarrier({
        sprayerOutputChoice: "recommended",
        litresPerHectare: recPerHa == null ? null : Math.round(recPerHa * 10) / 10,
      });
    }
  };

  const canopyAnswered = recPer100m != null;

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
              <div className="text-[11px] text-muted-foreground">Treated area</div>
              <div className="font-medium">{isTemplate ? LATER : fmtHa(geometry.treatedAreaHa)}</div>
              {!isTemplate && (
                <div className="text-xs text-muted-foreground">
                  {treatedPct != null
                    ? `${fmtNum(treatedPct, 1)}% of ${fmtHa(geometry.grossAreaHa)} gross`
                    : "Needs band width, row spacing and area"}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="space-y-2" role="radiogroup" aria-label="Spray volume basis">
        <FieldHeading label="How do you know your spray volume?" help={SPRAY_HELP.basis} />
        <div className="grid gap-2 sm:grid-cols-3">
          {CARRIER_BASES.map((b) => (
            <SelectTile
              key={b}
              selected={basis === b}
              disabled={!canEdit}
              // Switching representation must never destroy the canopy answer or
              // the output the operator already typed for the other basis.
              onSelect={() => setCarrier({ basis: b })}
              title={CARRIER_BASIS_CHOICE_LABEL[b]}
              hint={CARRIER_BASIS_CHOICE_HINT[b]}
            />
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
          <section className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
              <div className="space-y-4">
                <div className="space-y-1.5" role="radiogroup" aria-label="Canopy type">
                  <FieldHeading label="Canopy type" help={SPRAY_HELP.canopyType} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CANOPY_TYPES.map((t) => (
                      <SelectTile
                        key={t}
                        selected={app.carrier.canopyType === t}
                        disabled={!canEdit}
                        onSelect={() => setCarrier({ canopyType: t })}
                        title={CANOPY_TYPE_LABEL[t]}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5" role="radiogroup" aria-label="Canopy size">
                  <FieldHeading label="Canopy size" help={SPRAY_HELP.canopySize} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CANOPY_SIZES.map((s) => (
                      <SelectTile
                        key={s}
                        selected={app.carrier.canopySize === s}
                        disabled={!canEdit}
                        onSelect={() => setCarrier({ canopySize: s })}
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

                <div className="space-y-1.5" role="radiogroup" aria-label="Canopy density">
                  <FieldHeading label="Canopy density" help={SPRAY_HELP.canopyDensity} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CANOPY_DENSITIES.map((d) => (
                      <SelectTile
                        key={d}
                        selected={app.carrier.canopyDensity === d}
                        disabled={!canEdit}
                        onSelect={() => setCarrier({ canopyDensity: d })}
                        title={CANOPY_DENSITY_LABEL[d]}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <figure className="rounded-md border bg-muted/20 p-3">
                <div className="text-[11px] text-muted-foreground">
                  Canopy reference
                </div>
                {hasCanopy ? (
                  <CanopyReferenceImage
                    type={app.carrier.canopyType}
                    size={app.carrier.canopySize}
                    alt={`${CANOPY_TYPE_LABEL[app.carrier.canopyType!]} canopy at ${CANOPY_SIZE_LABEL[app.carrier.canopySize!].toLowerCase()} size`}
                    className="mt-2"
                  />
                ) : (
                  <div className="mt-2 flex aspect-square items-center justify-center rounded border border-dashed text-center text-xs text-muted-foreground">
                    Choose a canopy type and size
                  </div>
                )}
                <figcaption className="mt-2 text-xs text-muted-foreground">
                  {app.carrier.canopyType && app.carrier.canopySize
                    ? `${CANOPY_TYPE_LABEL[app.carrier.canopyType]} · ${CANOPY_SIZE_LABEL[app.carrier.canopySize]} — ${CANOPY_SIZE_DESCRIPTION[app.carrier.canopyType][app.carrier.canopySize]}`
                    : "Illustration changes with canopy type and size."}
                </figcaption>
              </figure>
            </div>
          </section>

          <section className="space-y-3 rounded-md border p-3">
            <div className="flex items-center gap-1">
              <h3 className="text-sm font-semibold">
                Recommended spray volume
              </h3>
              <HelpTip {...SPRAY_HELP.recommendation} />
            </div>

            {!canopyAnswered ? (
              <p className="text-xs text-muted-foreground">
                Answer canopy type, size and density to see the AWRI recommendation.
              </p>
            ) : basis === "l_per_100m" ? (
              <div>
                <div className="text-2xl font-semibold">{fmtNum(recPer100m, 0)} L/100 m</div>
                <p className="text-xs text-muted-foreground">
                  AWRI dilute (spray to run-off) reference
                  {range ? ` — range ${range.low}–${range.high} L/100 m for this canopy` : ""}.
                </p>
              </div>
            ) : recPerHa != null ? (
              <div>
                <div className="text-2xl font-semibold">{fmtNum(recPerHa, 1)} L/ha</div>
                <p className="text-xs text-muted-foreground">
                  {fmtNum(recPer100m, 0)} L/100 m canopy reference · {fmtNum(rowSpacing, 2)} m row
                  spacing ({fmtNum(recPer100m, 0)} × 100 ÷ {fmtNum(rowSpacing, 2)}).
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-sm">
                  <span className="text-muted-foreground">AWRI canopy reference </span>
                  <span className="font-semibold">{fmtNum(recPer100m, 0)} L/100 m</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Recommended L/ha </span>
                  <span className="font-medium">{LATER}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  The exact L/ha recommendation depends on row spacing and will be calculated when
                  you plan the spray.
                </p>
              </div>
            )}

            {canopyAnswered && (
              <div className="space-y-2" role="radiogroup" aria-label="Sprayer output">
                <span className="text-sm font-medium">Spray at the recommended volume?</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  <SelectTile
                    selected={choice === "recommended"}
                    disabled={!canEdit}
                    onSelect={chooseRecommended}
                    title="Use recommended volume"

                    hint={
                      basis === "l_per_100m"
                        ? `Sprayer set to ${fmtNum(recPer100m, 0)} L/100 m`
                        : recPerHa != null
                          ? `Sprayer set to ${fmtNum(recPerHa, 1)} L/ha`
                          : "Resolved from row spacing when you plan the spray"
                    }
                  />
                  <SelectTile
                    selected={choice === "custom"}
                    disabled={!canEdit}
                    onSelect={() => setCarrier({ sprayerOutputChoice: "custom" })}
                    title="Set my own volume"
                    hint="Enter what the sprayer is actually set to apply"
                  />
                </div>
              </div>
            )}

            {choice === "custom" && (
              <div className="max-w-xs space-y-1">
                <Label htmlFor="sprayer-output">What is your sprayer set to apply?</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="sprayer-output"
                    type="number"
                    min="0"
                    step={basis === "l_per_ha" ? "1" : "0.1"}
                    disabled={!canEdit}
                    value={appliedValue ?? ""}
                    onChange={(e) =>
                      setCarrier(
                        basis === "l_per_ha"
                          ? { litresPerHectare: numOrNull(e.target.value), sprayerOutputChoice: "custom" }
                          : { appliedLitresPer100m: numOrNull(e.target.value), sprayerOutputChoice: "custom" },
                      )
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {basis === "l_per_ha" ? "L/ha" : "L/100 m"}
                  </span>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {isTemplate ? (
        <ProgramDefaultSummary
          basisLabel={basis ? CARRIER_BASIS_CHOICE_LABEL[basis] : "—"}
          output={
            isManual
              ? app.carrier.manualTotalLitres != null
                ? `${fmtNum(app.carrier.manualTotalLitres, 0)} L total`
                : "—"
              : choice === "recommended"
                ? basis === "l_per_100m"
                  ? `${fmtNum(recPer100m, 0)} L/100 m (canopy recommendation)`
                  : recPerHa != null
                    ? `${fmtNum(recPerHa, 1)} L/ha (canopy recommendation)`
                    : "Canopy recommendation"
                : appliedValue != null
                  ? `${fmtNum(appliedValue, 1)} ${basis === "l_per_ha" ? "L/ha" : "L/100 m"}`
                  : "—"
          }
          canopy={
            isManual
              ? "Not used in Manual mode"
              : app.carrier.canopyType && app.carrier.canopySize && app.carrier.canopyDensity
                ? `${CANOPY_TYPE_LABEL[app.carrier.canopyType].split(" ")[0]} · ${CANOPY_SIZE_LABEL[app.carrier.canopySize]} · ${CANOPY_DENSITY_LABEL[app.carrier.canopyDensity]}`
                : "—"
          }
          awri={isManual ? "—" : recPer100m != null ? `${fmtNum(recPer100m, 0)} L/100 m` : "—"}
          equivalentDilute={
            isManual
              ? "—"
              : recPerHa != null
                ? `${fmtNum(recPerHa, 1)} L/ha`
                : "Calculated from block row spacing"
          }

          concentrationFactor={
            isManual
              ? "1.00× (manual total water)"
              : carrier.concentrationFactor != null
                ? `${fmtNum(carrier.concentrationFactor, 2)}× reference`
                : "Calculated when planning"
          }
        />
      ) : (
        <section className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <h4 className="text-sm font-semibold">Spray volume summary</h4>
              <HelpTip {...SPRAY_HELP.concentrationFactor} />
            </div>
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
            {!isManual && (
              <>
                <Fact
                  label="Dilute / run-off"
                  value={
                    recPer100m != null
                      ? `${fmtNum(recPer100m, 0)} L/100 m${recPerHa != null ? ` · ${fmtNum(recPerHa, 0)} L/ha` : ""}`
                      : "—"
                  }
                />
                <Fact
                  label="Actual sprayer output"
                  value={
                    carrier.litresPerHectare != null
                      ? `${fmtNum(carrier.litresPerHectare, 0)} L/ha`
                      : carrier.litresPer100m != null
                        ? `${fmtNum(carrier.litresPer100m, 1)} L/100 m`
                        : "—"
                  }
                />
              </>
            )}
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
          {carrier.appliedFromRecommendation && (
            <p className="text-xs text-muted-foreground">
              The sprayer output is the canopy recommendation, so this is a dilute application —
              concentration factor 1.00×.
            </p>
          )}

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
      )}
    </div>
  );
}

/**
 * Program Step summary. A Program Step stores DEFAULTS, so it never shows a
 * total water figure — there is no block to apply it to.
 */
function ProgramDefaultSummary(props: {
  basisLabel: string;
  output: string;
  canopy: string;
  awri: string;
  equivalentDilute: string;
  concentrationFactor: string;
}) {
  const rows: [string, string][] = [
    ["Basis", props.basisLabel],
    ["Sprayer output", props.output],
    ["Canopy", props.canopy],
    ["AWRI reference", props.awri],
    ["Equivalent dilute", props.equivalentDilute],
    ["Concentration factor", props.concentrationFactor],
  ];
  return (
    <section className="space-y-2 rounded-md border bg-muted/30 p-3">
      <h4 className="text-sm font-semibold">Spray volume default</h4>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        A Program Step stores reusable defaults. Total water and product quantities are calculated
        when you plan the spray against real blocks.
      </p>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
