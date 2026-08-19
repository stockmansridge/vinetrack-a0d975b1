// Stage 3B — Products step: product lines, rate basis, label guidance.
import { useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PRODUCT_RATE_BASES,
  type ProductRateBasis,
  type SprayProductLine,
} from "@/lib/sprayApplicationDomain";
import { applyRegisteredUse, productLineFromChemical } from "@/lib/sprayApplicationDraft";
import {
  PRODUCT_BASIS_FRIENDLY,
  RATE_VALIDATION_FRIENDLY,
  RATE_VALIDATION_TONE,
  fmtQuantity,
} from "@/lib/sprayFormat";
import {
  VERIFICATION_LABEL,
  VERIFICATION_TONE,
  activityGroupSummary,
  formatLabelRate,
  type ChemicalIntelligence,
} from "@/lib/chemicalIntelligence";
import type { StepProps } from "./types";
import { useVineyard } from "@/context/VineyardContext";
import { JurisdictionNoticeBanner } from "@/components/chemicals/JurisdictionNotice";
import { countryLabel, jurisdictionSuitability, labelFactsAuthoritative } from "@/lib/chemicalJurisdiction";

const UNITS = ["L", "mL", "kg", "g"];

const basisFromLabel = (basis: string | null | undefined): ProductRateBasis | null => {
  const b = (basis ?? "").toLowerCase();
  if (b.includes("100")) return "per_100_litres";
  if (b.includes("hect") || b.includes("ha")) return "whole_block_area";
  return null;
};

export function ProductsStep({ app, patch, calc, intelligenceById, canEdit }: StepProps) {
  const chemicals = useMemo(
    () => Array.from(intelligenceById.values()).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [intelligenceById],
  );

  const setLine = (i: number, next: SprayProductLine) =>
    patch({ products: app.products.map((p, idx) => (idx === i ? next : p)) });

  const addLine = () =>
    patch({
      products: [
        ...app.products,
        productLineFromChemical({ savedChemicalId: null, productName: null, unit: null }),
      ],
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Products</h3>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <a href="/setup/chemicals" target="_blank" rel="noreferrer">
              Manage chemicals <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </a>
          </Button>
          {canEdit && (
            <Button type="button" size="sm" variant="outline" onClick={addLine}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add product
            </Button>
          )}
        </div>
      </div>

      {app.products.length === 0 && (
        <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          No products added yet.
        </p>
      )}

      <div className="space-y-3">
        {app.products.map((line, i) => (
          <ProductRow
            key={i}
            index={i}
            line={line}
            result={calc.products[i]}
            chemicals={chemicals}
            intelligenceById={intelligenceById}
            canEdit={canEdit}
            onChange={(next) => setLine(i, next)}
            onRemove={() => patch({ products: app.products.filter((_, idx) => idx !== i) })}
          />
        ))}
      </div>
    </div>
  );
}

function ProductRow({
  index,
  line,
  result,
  chemicals,
  intelligenceById,
  canEdit,
  onChange,
  onRemove,
}: {
  index: number;
  line: SprayProductLine;
  result: any;
  chemicals: ChemicalIntelligence[];
  intelligenceById: Map<string, ChemicalIntelligence>;
  canEdit: boolean;
  onChange: (next: SprayProductLine) => void;
  onRemove: () => void;
}) {
  const [showUses, setShowUses] = useState(false);
  const { currentCountry } = useVineyard();
  const intel = line.savedChemicalId ? intelligenceById.get(line.savedChemicalId) ?? null : null;
  // Label authority follows the vineyard, not the product record.
  const labelAuthoritative = labelFactsAuthoritative(
    jurisdictionSuitability(intel?.product.country, currentCountry),
  );
  const groups = intel ? activityGroupSummary(intel) : null;
  const validation = result?.rateValidation ?? "unable_to_validate";
  const tone = RATE_VALIDATION_TONE[validation as keyof typeof RATE_VALIDATION_TONE];

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Label className="text-xs">Product</Label>
          <Select
            value={line.savedChemicalId ?? "__none"}
            disabled={!canEdit}
            onValueChange={(v) => {
              if (v === "__none") {
                onChange({ ...line, savedChemicalId: null, productName: null, intelligence: null });
                return;
              }
              const chem = intelligenceById.get(v) ?? null;
              const fresh = productLineFromChemical({
                savedChemicalId: v,
                productName: chem?.name ?? null,
                unit: chem?.commercial.unit ?? line.unit,
                intelligence: chem,
                costPerUnit: chem?.commercial.costPerUnit ?? null,
              });
              onChange({ ...fresh, rate: line.rate, rateBasis: line.rateBasis, notes: line.notes });
            }}
          >
            <SelectTrigger><SelectValue placeholder="Choose a product" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Not set</SelectItem>
              {chemicals.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name ?? "Unnamed chemical"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {intel && (
              <Badge
                variant={
                  VERIFICATION_TONE[intel.verification.status] === "danger"
                    ? "destructive"
                    : VERIFICATION_TONE[intel.verification.status] === "success"
                      ? "secondary"
                      : "outline"
                }
              >
                {VERIFICATION_LABEL[intel.verification.status]}
              </Badge>
            )}
            {groups && <Badge variant="outline">{groups}</Badge>}
            {!line.savedChemicalId && line.productName && (
              <Badge variant="outline">Not linked to a saved chemical</Badge>
            )}
          </div>
        </div>
        {canEdit && (
          <Button type="button" size="icon" variant="ghost" onClick={onRemove} aria-label="Remove product">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Rate</Label>
          <Input
            type="number" min="0" step="0.01" disabled={!canEdit}
            value={line.rate ?? ""}
            onChange={(e) => onChange({ ...line, rate: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Unit</Label>
          <Select
            value={line.unit ?? "__none"}
            disabled={!canEdit}
            onValueChange={(v) => onChange({ ...line, unit: v === "__none" ? null : v })}
          >
            <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Not set</SelectItem>
              {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Rate basis</Label>
          <Select
            value={line.rateBasis ?? "__none"}
            disabled={!canEdit}
            onValueChange={(v) =>
              onChange({ ...line, rateBasis: v === "__none" ? null : (v as ProductRateBasis) })
            }
          >
            <SelectTrigger><SelectValue placeholder="Choose basis" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Not set</SelectItem>
              {PRODUCT_RATE_BASES.map((b) => (
                <SelectItem key={b} value={b}>{PRODUCT_BASIS_FRIENDLY[b]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Foreign label facts stay visible but are never authoritative here. */}
      {intel && (
        <JurisdictionNoticeBanner
          registrationCountry={intel.product.country}
          vineyardCountry={currentCountry}
          dense
        />
      )}

      {(line.labelMinRate != null || line.labelMaxRate != null) && (
        <div className="text-xs text-muted-foreground">
          Label rate:{" "}
          {formatLabelRate({
            min: line.labelMinRate ?? null,
            max: line.labelMaxRate ?? null,
            unit: line.labelRateUnit ?? null,
            basis: null,
          }) ?? "—"}
          {!labelAuthoritative && intel ? " (foreign label — not authoritative here)" : ""}
        </div>
      )}

      {intel && intel.registeredUses.length > 0 && (
        <div className="space-y-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowUses((v) => !v)}>
            {showUses ? "Hide" : "Show"} registered uses ({intel.registeredUses.length})
            {!labelAuthoritative
              ? ` — ${countryLabel(intel.product.country)} label`
              : ""}
          </Button>
          {showUses && (
            <div className="divide-y rounded-md border text-xs">
              {intel.registeredUses.map((use, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={!canEdit}
                  className="w-full px-2 py-1.5 text-left hover:bg-muted/60"
                  onClick={() =>
                    onChange(applyRegisteredUse(line, use, basisFromLabel(use.rate?.basis)))
                  }
                >
                  <span className="font-medium">{use.target ?? use.crop ?? "Registered use"}</span>
                  <span className="ml-2 text-muted-foreground">
                    {formatLabelRate(use.rate) ?? use.rateText ?? "Rate not stated"}
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {labelAuthoritative
              ? "Selecting a use fills the label range for guidance only — the rate stays yours to choose."
              : `These uses, rates, withholding and re-entry come from the ${countryLabel(
                  intel.product.country,
                )} label and are not authoritative for this vineyard.`}
          </p>
        </div>
      )}


      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
        <span>
          Total for this application:{" "}
          <span className="font-medium">{fmtQuantity(result?.totalQuantity ?? null, line.unit)}</span>
        </span>
        <Badge variant={tone === "warn" ? "destructive" : tone === "ok" ? "secondary" : "outline"}>
          {RATE_VALIDATION_FRIENDLY[validation as keyof typeof RATE_VALIDATION_FRIENDLY]}
        </Badge>
      </div>

      {(result?.diagnostics ?? []).length > 0 && (
        <ul className="space-y-1 text-xs">
          {result.diagnostics.map((d: any, i: number) => (
            <li key={`${d.code}-${i}`} className="flex items-start gap-1">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>{d.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
