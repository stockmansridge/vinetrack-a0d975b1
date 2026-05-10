import { useState } from "react";
import { Sparkles, Loader2, AlertCircle, Check, Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { matchCategory, type ProductCategory } from "@/lib/chemicalCategories";
import {
  inferProductType,
  inferRateBasis,
  normaliseUnit,
  type ProductType,
  type RateBasis,
  type ChemUnit,
} from "@/lib/rateBasis";

export interface AppliedSuggestion {
  name?: string;
  active_ingredient?: string;
  category?: ProductCategory | "";
  chemical_group?: string;
  manufacturer?: string;
  product_type?: ProductType;
  unit?: ChemUnit;
  rate_basis?: RateBasis;
  rate_per_ha?: number | null; // numeric rate value (per the basis)
  rate_unit?: string;          // composed text e.g. "mL/100L"
  whp_days?: string;
  rei_hours?: string;
  target?: string;
  notes?: string;
  /** Set when the user selected an existing library match instead of a new lookup row. */
  existing_chemical_id?: string;
}

interface RawCandidate {
  product_name?: string;
  active_ingredient?: string;
  category?: string;
  chemical_group?: string;
  manufacturer?: string;
  product_type?: "liquid" | "solid";
  unit?: ChemUnit;
  rate_basis?: RateBasis;
  rate_per_unit?: number | null;
  withholding_period_days?: number | null;
  re_entry_period_hours?: number | null;
  target?: string;
  notes?: string;
  safety_note?: string;
  confidence?: "high" | "medium" | "low" | "unknown";
}

export interface ExistingLibraryItem {
  id: string;
  name?: string | null;
  active_ingredient?: string | null;
}

interface Props {
  initialName?: string;
  /** Existing chemicals already in the vineyard library. Used to flag duplicate hits. */
  existingLibrary?: ExistingLibraryItem[];
  /** Vineyard country (e.g. "Australia", "New Zealand", "United States") used to bias results. */
  country?: string | null;
  /** Apply a candidate (AI lookup OR existing library item). */
  onApply: (s: AppliedSuggestion) => void;
}

function normalise(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function ChemicalAILookup({ initialName = "", existingLibrary = [], country, onApply }: Props) {
  const [name, setName] = useState(initialName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RawCandidate[] | null>(null);
  const [existingMatches, setExistingMatches] = useState<ExistingLibraryItem[]>([]);

  async function runLookup() {
    const q = name.trim();
    if (!q) {
      setError("Enter a product name to look up.");
      return;
    }
    setError(null);
    setCandidates(null);
    setExistingMatches([]);
    setLoading(true);

    // First, surface any existing library matches so the user can re-use them
    // instead of creating a duplicate.
    const qn = normalise(q);
    const matches = existingLibrary.filter((c) => {
      const haystack = `${normalise(c.name)} ${normalise(c.active_ingredient)}`;
      return qn.length >= 3 && haystack.includes(qn);
    });
    setExistingMatches(matches);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke("chemical-ai-lookup", {
        body: { product_name: q, country: country ?? null },
      });
      if (fnErr) throw fnErr;
      const list: RawCandidate[] = Array.isArray(data?.candidates)
        ? data.candidates
        : data?.suggestion
        ? [data.suggestion]
        : [];
      if (!list.length) throw new Error("No matches returned");
      setCandidates(list);
    } catch (e: any) {
      setError(e?.message ?? "AI lookup failed");
    } finally {
      setLoading(false);
    }
  }

  function applyCandidate(c: RawCandidate) {
    const cat = matchCategory(c.category) ?? (c.category as ProductCategory | undefined);
    const unit = (c.unit ?? normaliseUnit(c.unit)) as ChemUnit | "" | undefined;
    const productType: ProductType = c.product_type
      ? c.product_type
      : inferProductType(unit || undefined);
    const basis: RateBasis = c.rate_basis ?? "per_hectare";
    const composedUnit =
      unit ? `${unit}${basis === "per_100L" ? "/100L" : "/ha"}` : undefined;
    onApply({
      name: c.product_name?.trim() || name.trim(),
      active_ingredient: c.active_ingredient,
      category: cat ?? undefined,
      chemical_group: c.chemical_group,
      manufacturer: c.manufacturer,
      product_type: productType,
      unit: (unit || undefined) as ChemUnit | undefined,
      rate_basis: basis,
      rate_per_ha: c.rate_per_unit ?? null,
      rate_unit: composedUnit,
      whp_days:
        c.withholding_period_days != null
          ? String(c.withholding_period_days)
          : undefined,
      rei_hours:
        c.re_entry_period_hours != null
          ? String(c.re_entry_period_hours)
          : undefined,
      target: c.target,
      notes: c.notes,
    });
  }

  function applyExisting(item: ExistingLibraryItem) {
    onApply({
      existing_chemical_id: item.id,
      name: item.name ?? undefined,
      active_ingredient: item.active_ingredient ?? undefined,
    });
  }

  return (
    <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Lookup {country ? `(${country} labels)` : "(country not set)"}
        </div>
        {!country && (
          <span className="text-[10px] text-muted-foreground italic">
            Set vineyard country to improve results
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Product name e.g. Thiovit Jet, Flint, Ridomil…"
          className="h-9 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runLookup();
            }
          }}
        />
        <Button type="button" size="sm" onClick={runLookup} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              Looking up…
            </>
          ) : (
            "Lookup"
          )}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {existingMatches.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Already in your library
          </div>
          {existingMatches.slice(0, 5).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => applyExisting(m)}
              className="w-full text-left rounded border bg-background p-2 hover:bg-muted/50 focus:outline-none focus:bg-muted/60"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Library className="h-3.5 w-3.5 text-primary" />
                  {m.name ?? "Unnamed"}
                </div>
                <Badge variant="secondary" className="text-[10px]">Existing</Badge>
              </div>
              {m.active_ingredient && (
                <div className="text-xs text-muted-foreground">{m.active_ingredient}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {candidates && candidates.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            AI candidates ({candidates.length})
          </div>
          {candidates.map((c, i) => {
            const unit = c.unit ?? (normaliseUnit(c.unit) as ChemUnit | "");
            const basis = c.rate_basis ?? inferRateBasis(unit ? `${unit}/${"ha"}` : null);
            const productType = c.product_type ?? inferProductType(unit || undefined);
            const rateText =
              c.rate_per_unit != null
                ? `${c.rate_per_unit} ${unit || ""}${basis === "per_100L" ? "/100L" : "/ha"}`
                : "Rate varies — check label";
            return (
              <div key={i} className="rounded border bg-background p-2 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">
                    {c.product_name || "Unnamed"}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    Confidence: {c.confidence ?? "unknown"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <Row label="Active" value={c.active_ingredient} />
                  <Row label="Category" value={c.category} />
                  <Row label="Manufacturer" value={c.manufacturer} />
                  <Row label="Group" value={c.chemical_group} />
                  <Row label="Type" value={productType} />
                  <Row label="Rate" value={rateText} />
                  <Row
                    label="WHP"
                    value={
                      c.withholding_period_days != null
                        ? `${c.withholding_period_days} days`
                        : undefined
                    }
                  />
                  <Row
                    label="REI"
                    value={
                      c.re_entry_period_hours != null
                        ? `${c.re_entry_period_hours} hours`
                        : undefined
                    }
                  />
                  {c.target && <Row label="Target" value={c.target} />}
                </div>
                {c.notes && (
                  <p className="text-muted-foreground italic text-[11px]">{c.notes}</p>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => applyCandidate(c)}
                  className="w-full"
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Apply this product
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground leading-snug">
        AI lookup is a starting point only. Always confirm against the product label before use.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className={value ? "" : "text-muted-foreground italic"}>{value || "—"}</span>
    </>
  );
}
