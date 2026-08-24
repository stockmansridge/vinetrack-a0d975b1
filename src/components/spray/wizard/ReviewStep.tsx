// Stage 3B — Review step: full summary, tank plan and grouped diagnostics.
import type { ReactNode } from "react";
import { sprayTargetLabel } from "@/lib/sprayTargetLibrary";
import { useVineyardSprayTargets } from "@/hooks/useVineyardSprayTargets";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CARRIER_BASIS_LABEL,
  HEAD_TARGET_LABEL,
  OPERATION_TYPE_LABEL,
} from "@/lib/sprayApplicationDomain";
import { GROWTH_STAGE_LABEL } from "@/lib/vspWaterRate";
import {
  PRODUCT_BASIS_FRIENDLY,
  fmtHa,
  fmtLitres,
  fmtNum,
  fmtQuantity,
  groupDiagnostics,
} from "@/lib/sprayFormat";
import type { StepProps } from "./types";

export function ReviewStep({
  app,
  geometry,
  calc,
  lookups,
  extra,
  resistance,
  vineyardId,
}: StepProps & { extra?: ReactNode; resistance?: ReactNode }) {
  const { labels: targetLabels } = useVineyardSprayTargets(vineyardId);
  const groups = groupDiagnostics(calc.diagnostics);
  const blockNames = app.blockIds.map((id) => lookups.maps.paddocks.get(id) ?? "Block");

  return (
    <div className="space-y-6">
      {resistance}
      <section className="grid gap-3 sm:grid-cols-2">
        <Card title="Application">
          <Row label="Name" value={app.name || "—"} />
          <Row label="Type" value={app.operationType ? OPERATION_TYPE_LABEL[app.operationType] : "—"} />
          {!app.isTemplate && <Row label="Planned date" value={app.plannedDate || "—"} />}
          <Row label="Status" value={app.isTemplate ? "Template" : app.status ?? "draft"} />
          <Row
            label="Growth stage"
            value={
              app.growthStageCode
                ? `${app.growthStageCode} — ${GROWTH_STAGE_LABEL.get(app.growthStageCode) ?? ""}`
                : "—"
            }
          />
        </Card>

        <Card title="Target">
          <Row
            label="Targets"
            value={(app.targets ?? []).map((t) => sprayTargetLabel(t, targetLabels)).join(", ") || "—"}
          />
          {app.otherTargetNote && <Row label="Other" value={app.otherTargetNote} />}
          <Row label="Head target" value={app.headTarget ? HEAD_TARGET_LABEL[app.headTarget] : "—"} />
        </Card>

        <Card title="Blocks & geometry">
          <Row label="Blocks" value={app.isTemplate ? "Chosen when used" : blockNames.join(", ") || "—"} />
          <Row label="Gross area" value={fmtHa(geometry.grossAreaHa)} />
          {app.mode === "banded" && <Row label="Treated area" value={fmtHa(geometry.treatedAreaHa)} />}
          <Row
            label="Total row length"
            value={
              geometry.canonicalRowLengthMetres != null
                ? `${Math.round(geometry.canonicalRowLengthMetres).toLocaleString()} m`
                : "—"
            }
          />
        </Card>

        <Card title="Equipment">
          <Row label="Tractor" value={(app.tractorId && lookups.maps.tractors.get(app.tractorId)) || "—"} />
          <Row label="Sprayer" value={(app.equipmentId && lookups.maps.equipment.get(app.equipmentId)) || "—"} />
          <Row label="Operator" value={(app.operatorUserId && lookups.maps.members.get(app.operatorUserId)) || "—"} />
          <Row
            label="Tank capacity"
            value={app.tankCapacityLitres ? fmtLitres(app.tankCapacityLitres) : "—"}
          />
          {!app.isTemplate && (
            <Row label="Confirmed" value={app.equipmentConfirmed ? "Yes" : "Not confirmed"} />
          )}
        </Card>
      </section>

      {app.operationType !== "spreader" && (
        <Card title="Canopy & spray volume">
          <div className="grid gap-2 sm:grid-cols-4">
            <Row label="Basis" value={calc.carrier.basis ? CARRIER_BASIS_LABEL[calc.carrier.basis] : "—"} />
            <Row
              label={calc.carrier.derivedRatesAreReferenceOnly ? "L/ha (ref)" : "L/ha"}
              value={calc.carrier.litresPerHectare != null ? fmtNum(calc.carrier.litresPerHectare, 1) : "—"}
            />
            <Row
              label={calc.carrier.derivedRatesAreReferenceOnly ? "L/100 m (ref)" : "L/100 m"}
              value={calc.carrier.litresPer100m != null ? fmtNum(calc.carrier.litresPer100m, 2) : "—"}
            />
            <Row label="Total water" value={fmtLitres(calc.carrier.totalCarrierLitres)} />
          </div>

          {(app.carrier.canopyType || app.carrier.canopySize || app.carrier.canopyDensity) && (
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <Row
                label="Trellis"
                value={app.carrier.canopyType ? CANOPY_TYPE_LABEL[app.carrier.canopyType] : "—"}
              />
              <Row
                label="Canopy size"
                value={app.carrier.canopySize ? CANOPY_SIZE_LABEL[app.carrier.canopySize] : "—"}
              />
              <Row
                label="Density"
                value={app.carrier.canopyDensity ? CANOPY_DENSITY_LABEL[app.carrier.canopyDensity] : "—"}
              />
              <Row
                label="Recommended dilute"
                value={
                  calc.carrier.recommendedDiluteLitresPer100m != null
                    ? `${fmtNum(calc.carrier.recommendedDiluteLitresPer100m, 0)} L/100 m`
                    : "—"
                }
              />
            </div>
          )}

          {/* Show the math — every figure above traced back to its inputs. */}
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {calc.carrier.basis === "manual" && (
              <li>Total water = entered directly ({fmtLitres(calc.carrier.totalCarrierLitres)}). Any L/ha or L/100 m shown is a derived reference only.</li>
            )}
            {calc.carrier.basis === "l_per_100m" && (
              <li>
                Total water = {fmtNum(app.carrier.appliedLitresPer100m, 2)} L/100 m ×
                {" "}
                {geometry.canonicalRowLengthMetres != null
                  ? `(${Math.round(geometry.canonicalRowLengthMetres).toLocaleString()} m ÷ 100)`
                  : "(total row length ÷ 100)"}
                {" = "}
                {fmtLitres(calc.carrier.totalCarrierLitres)}
              </li>
            )}
            {calc.carrier.basis === "l_per_ha" && (
              <li>
                Total water = {fmtNum(app.carrier.litresPerHectare, 1)} L/ha × {fmtHa(calc.carrier.carrierAreaHa)}
                {" = "}
                {fmtLitres(calc.carrier.totalCarrierLitres)}
              </li>
            )}
            {calc.carrier.basis === "l_per_100m" && geometry.rowSpacingMetres != null && (
              <li>
                L/ha = L/100 m × 100 ÷ {fmtNum(geometry.rowSpacingMetres, 2)} m row spacing.
              </li>
            )}
            {calc.carrier.concentrationFactor != null && (
              <li>
                Concentration factor ×{fmtNum(calc.carrier.concentrationFactor, 2)}{" "}
                {calc.carrier.concentrationFactorSource === "persisted"
                  ? "(recorded with the job)"
                  : calc.carrier.concentrationFactorSource === "manual"
                    ? "(manual total water is never concentrated)"
                    : "= max(1.00, dilute ÷ applied)"}
                .
              </li>
            )}
          </ul>
        </Card>
      )}


      <Card title="Products">
        {calc.products.length === 0 && <p className="text-xs text-muted-foreground">No products added.</p>}
        {calc.products.map((p) => (
          <div key={p.index} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm last:border-0">
            <span className="font-medium">{p.productName ?? "Product not set"}</span>
            <span className="text-xs text-muted-foreground">
              {p.rate != null ? `${fmtNum(p.rate, 2)} ${p.unit ?? ""}` : "Rate not set"}
              {p.rateBasis ? ` · ${PRODUCT_BASIS_FRIENDLY[p.rateBasis]}` : ""}
            </span>
            <span>{fmtQuantity(p.totalQuantity, p.unit)}</span>
          </div>
        ))}
      </Card>

      {calc.tanks.tanks.length > 0 && (
        <Card title={`Tank plan — ${calc.tanks.tanks.length} load${calc.tanks.tanks.length === 1 ? "" : "s"}`}>
          <div className="space-y-2">
            {calc.tanks.tanks.map((t) => (
              <div key={t.tankNumber} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    Tank {t.tankNumber} {t.isPartial && <Badge variant="outline" className="ml-1">Part load</Badge>}
                  </span>
                  <span>{fmtLitres(t.carrierLitres)}</span>
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {t.products.map((p) => (
                    <li key={p.index} className="flex justify-between">
                      <span>{p.productName ?? "Product"}</span>
                      <span>{fmtQuantity(p.quantity, p.unit)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Checks</h3>
        {groups.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Everything needed for this application is present.
          </div>
        ) : (
          groups.map(({ group, items }) => (
            <div key={group} className="rounded-md border p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>
              <ul className="mt-1 space-y-1 text-sm">
                {items.map((d, i) => (
                  <li key={`${d.code}-${i}`} className="flex items-start gap-2">
                    {d.severity === "info" ? (
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <AlertTriangle
                        className={`mt-0.5 h-4 w-4 shrink-0 ${d.severity === "error" ? "text-destructive" : "text-muted-foreground"}`}
                      />
                    )}
                    <span>{d.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {app.compatibilityNotes.length > 0 && (
        <Card title="From the previous version of this job">
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {app.compatibilityNotes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </Card>
      )}

      {extra && (
        <>
          <Separator />
          {extra}
        </>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
