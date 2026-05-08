import { useState } from "react";
import { Sparkles, Loader2, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { matchCategory, type ProductCategory } from "@/lib/chemicalCategories";

export interface AppliedSuggestion {
  name?: string;
  active_ingredient?: string;
  category?: ProductCategory | "";
  chemical_group?: string;
  manufacturer?: string;
  rate_per_ha?: number | null;
  rate_unit?: string;
  whp_days?: string;
  rei_hours?: string;
  notes?: string;
}

interface RawSuggestion {
  product_name?: string;
  active_ingredient?: string;
  category?: string;
  chemical_group?: string;
  manufacturer?: string;
  rate_per_ha?: number | null;
  rate_unit?: string;
  withholding_period_days?: number | null;
  re_entry_period_hours?: number | null;
  notes?: string;
  safety_note?: string;
  confidence?: "high" | "medium" | "low" | "unknown";
}

interface Props {
  initialName?: string;
  onApply: (s: AppliedSuggestion) => void;
}

export function ChemicalAILookup({ initialName = "", onApply }: Props) {
  const [name, setName] = useState(initialName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<RawSuggestion | null>(null);

  async function runLookup() {
    const q = name.trim();
    if (!q) {
      setError("Enter a product name to look up.");
      return;
    }
    setError(null);
    setSuggestion(null);
    setLoading(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("chemical-ai-lookup", {
        body: { product_name: q },
      });
      if (fnErr) throw fnErr;
      if (!data?.suggestion) throw new Error("No suggestion returned");
      setSuggestion(data.suggestion as RawSuggestion);
    } catch (e: any) {
      setError(e?.message ?? "AI lookup failed");
    } finally {
      setLoading(false);
    }
  }

  function applyAll() {
    if (!suggestion) return;
    const cat = matchCategory(suggestion.category) ?? (suggestion.category as ProductCategory | undefined);
    onApply({
      name: suggestion.product_name?.trim() || name.trim(),
      active_ingredient: suggestion.active_ingredient,
      category: cat ?? undefined,
      chemical_group: suggestion.chemical_group,
      manufacturer: suggestion.manufacturer,
      rate_per_ha: suggestion.rate_per_ha ?? null,
      rate_unit: suggestion.rate_unit,
      whp_days:
        suggestion.withholding_period_days != null
          ? String(suggestion.withholding_period_days)
          : undefined,
      rei_hours:
        suggestion.re_entry_period_hours != null
          ? String(suggestion.re_entry_period_hours)
          : undefined,
      notes: suggestion.notes,
    });
  }

  return (
    <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/30">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        AI Lookup (Australian labels)
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

      {suggestion && (
        <div className="space-y-2 rounded border bg-background p-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium">Suggested fields</span>
            <span className="text-muted-foreground">
              Confidence: {suggestion.confidence ?? "unknown"}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <Row label="Name" value={suggestion.product_name} />
            <Row label="Category" value={suggestion.category} />
            <Row label="Active ingredient" value={suggestion.active_ingredient} />
            <Row label="Chemical group" value={suggestion.chemical_group} />
            <Row label="Manufacturer" value={suggestion.manufacturer} />
            <Row
              label="Rate"
              value={
                suggestion.rate_per_ha != null
                  ? `${suggestion.rate_per_ha}${suggestion.rate_unit ? ` ${suggestion.rate_unit}` : ""}`
                  : undefined
              }
            />
            <Row
              label="WHP"
              value={
                suggestion.withholding_period_days != null
                  ? `${suggestion.withholding_period_days} days`
                  : undefined
              }
            />
            <Row
              label="REI"
              value={
                suggestion.re_entry_period_hours != null
                  ? `${suggestion.re_entry_period_hours} hours`
                  : undefined
              }
            />
          </dl>
          {suggestion.notes && (
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Notes</Label>
              <p className="text-xs">{suggestion.notes}</p>
            </div>
          )}
          <Button type="button" size="sm" variant="outline" onClick={applyAll} className="w-full">
            <Check className="h-3.5 w-3.5 mr-1" />
            Apply suggestions to form
          </Button>
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
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={value ? "" : "text-muted-foreground italic"}>{value || "—"}</dd>
    </>
  );
}
