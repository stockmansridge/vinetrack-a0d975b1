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
  country?: string;
  country_confirmed?: boolean;
  confidence?: "high" | "medium" | "low" | "unknown";
  cached?: boolean;
  was_applied?: boolean;
  times_seen?: number;
  source_hint?: string;
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
  const [applied, setApplied] = useState<{ name: string; manufacturer?: string; source: "ai" | "existing" | "manual" } | null>(null);
  const [resultsCollapsed, setResultsCollapsed] = useState(false);

  async function preserveAppliedCandidate(candidate: RawCandidate | ExistingLibraryItem, fallbackName?: string) {
    const queryName = name.trim() || fallbackName?.trim();
    const productName = (
      "product_name" in candidate
        ? candidate.product_name
        : (candidate as ExistingLibraryItem).name
    )?.trim() || fallbackName?.trim();
    if (!queryName || !productName) return;

    try {
      await supabase.functions.invoke("chemical-ai-lookup", {
        body: {
          product_name: queryName,
          country: country ?? null,
          mark_applied: true,
          applied_candidate: {
            product_name: productName,
            manufacturer: ("manufacturer" in candidate ? candidate.manufacturer : "") ?? "",
            active_ingredient: candidate.active_ingredient ?? null,
            category: "category" in candidate ? candidate.category ?? null : null,
            chemical_group: "chemical_group" in candidate ? candidate.chemical_group ?? null : null,
            product_type: "product_type" in candidate ? candidate.product_type ?? null : null,
            unit: "unit" in candidate ? candidate.unit ?? null : null,
            rate_basis: "rate_basis" in candidate ? candidate.rate_basis ?? null : null,
            rate_per_unit: "rate_per_unit" in candidate ? candidate.rate_per_unit ?? null : null,
            withholding_period_days: "withholding_period_days" in candidate ? candidate.withholding_period_days ?? null : null,
            re_entry_period_hours: "re_entry_period_hours" in candidate ? candidate.re_entry_period_hours ?? null : null,
            target: "target" in candidate ? candidate.target ?? null : null,
            notes: "notes" in candidate ? candidate.notes ?? null : null,
            safety_note: "safety_note" in candidate ? candidate.safety_note ?? null : null,
            country: "country" in candidate ? candidate.country ?? country ?? null : country ?? null,
            country_confirmed: "country_confirmed" in candidate ? candidate.country_confirmed ?? null : null,
            confidence: "confidence" in candidate ? candidate.confidence ?? "medium" : "medium",
            source_hint: "source_hint" in candidate ? candidate.source_hint ?? "manual_applied" : "manual_applied",
            times_seen: "times_seen" in candidate ? candidate.times_seen ?? 1 : 1,
          },
        },
      });
    } catch (error) {
      console.warn("Could not preserve applied chemical candidate", error);
    }
  }

  async function runLookup() {
    const q = name.trim();
    if (!q) {
      setError("Enter a product name to look up.");
      return;
    }
    setError(null);
    setCandidates(null);
    setExistingMatches([]);
    setApplied(null);
    setResultsCollapsed(false);
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
    const finalName = c.product_name?.trim() || name.trim();
    onApply({
      name: finalName,
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
    void preserveAppliedCandidate(c, finalName);
    setApplied({ name: finalName, manufacturer: c.manufacturer, source: "ai" });
    setResultsCollapsed(true);
  }

  function applyExisting(item: ExistingLibraryItem) {
    onApply({
      existing_chemical_id: item.id,
      name: item.name ?? undefined,
      active_ingredient: item.active_ingredient ?? undefined,
    });
    void preserveAppliedCandidate(item, item.name ?? name.trim());
    setApplied({ name: item.name ?? name.trim(), source: "existing" });
    setResultsCollapsed(true);
  }

  function applyManual() {
    const q = name.trim();
    onApply({ name: q });
    setApplied({ name: q, source: "manual" });
    setResultsCollapsed(true);
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

      {applied && resultsCollapsed && (
        <div className="rounded-md border bg-background p-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <Check className="h-3.5 w-3.5 text-primary shrink-0" />
            <span>
              <span className="text-muted-foreground">Applied:</span>{" "}
              <span className="font-medium">{applied.name}</span>
              {applied.manufacturer ? (
                <span className="text-muted-foreground"> — {applied.manufacturer}</span>
              ) : null}
              <span className="text-muted-foreground"> · review and save below</span>
            </span>
          </div>
          {(candidates?.length || existingMatches.length) ? (
            <button
              type="button"
              onClick={() => setResultsCollapsed(false)}
              className="text-[11px] underline text-primary hover:text-primary/80 shrink-0"
            >
              Change product
            </button>
          ) : null}
        </div>
      )}

      {!resultsCollapsed && existingMatches.length > 0 && (
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

      {!resultsCollapsed && candidates && candidates.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Lookup results ({candidates.length}) for "{name.trim()}"
              {country ? ` · ${country}` : ""}
            </div>
            <button
              type="button"
              onClick={applyManual}
              className="text-[11px] underline text-primary hover:text-primary/80"
            >
              Not the right product? Enter manually
            </button>
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
                  <div className="flex items-center gap-1">
                    {c.cached && (
                      <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                        Previously found
                      </Badge>
                    )}
                    {c.was_applied && (
                      <Badge variant="secondary" className="text-[10px] bg-primary/15 text-primary border-primary/30">
                        Previously applied
                      </Badge>
                    )}
                    {c.country && (
                      <Badge
                        variant={c.country_confirmed === false ? "outline" : "secondary"}
                        className="text-[10px]"
                      >
                        {c.country}
                        {c.country_confirmed === false ? " (unverified)" : ""}
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {c.confidence ?? "unknown"}
                    </span>
                  </div>
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
        Always confirm rates, withholding periods, re-entry intervals, and permitted uses against the current product label for your country.
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
