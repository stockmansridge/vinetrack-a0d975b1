// Presentation for the upgraded `chemical-info-lookup` resolver contract.
//
// Authoritative data and AI assistance are visually and functionally separate:
// the authoritative card is the only thing that can be applied to the form,
// the AI suggestion panel is read-only reference that can never be applied.
import { Check, AlertTriangle, FileText, Info, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { countryLabel } from "@/lib/chemicalJurisdiction";
import {
  LOOKUP_VERIFICATION_LABEL,
  LOOKUP_VERIFICATION_TONE,
  type AiSuggestionView,
  type ChemicalLookupResult,
} from "@/lib/chemicalLookupResolver";

const TONE_CLASS: Record<string, string> = {
  success: "border-transparent bg-primary/15 text-primary",
  warning: "border-transparent bg-warning/20 text-warning-foreground",
  danger: "border-transparent bg-destructive text-destructive-foreground",
  neutral: "border-transparent bg-muted text-muted-foreground",
};

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className={value ? "" : "text-muted-foreground italic"}>{value || "Not stated on label"}</span>
    </>
  );
}

export function AiSuggestionPanel({ suggestion }: { suggestion: AiSuggestionView }) {
  const rows: Array<[string, string | undefined]> = [
    ["Product", suggestion.productName],
    ["Active", suggestion.activeIngredient],
    ["Category", suggestion.category],
    ["Group / MOA", suggestion.chemicalGroup],
    ["Registrant", suggestion.registrant],
    ["Rate", suggestion.rateText],
    ["WHP", suggestion.withholdingText],
    ["REI", suggestion.reEntryText],
    ["Target", suggestion.target],
  ].filter(([, v]) => !!v) as Array<[string, string]>;
  if (!rows.length && !suggestion.notes) return null;
  return (
    <div className="rounded border border-dashed border-muted-foreground/40 bg-muted/40 p-2 text-xs space-y-1">
      <div className="flex items-center gap-1.5 font-medium">
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
        Unverified AI suggestion — reference only
      </div>
      <p className="text-[11px] text-muted-foreground">
        This was not confirmed against a registered label and has not been applied to any field.
        Check it against the product label before using it.
      </p>
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {rows.map(([k, v]) => (
            <Row key={k} label={k} value={v} />
          ))}
        </div>
      )}
      {suggestion.notes && (
        <p className="text-[11px] italic text-muted-foreground">{suggestion.notes}</p>
      )}
    </div>
  );
}

export function ChemicalLookupResultCard({
  result,
  onApply,
  onManual,
}: {
  result: ChemicalLookupResult;
  onApply: () => void;
  onManual: () => void;
}) {
  const { fields, jurisdiction, verificationStatus } = result;

  if (!result.authoritative) {
    return (
      <div className="space-y-2">
        <div className="rounded border border-warning/50 bg-warning/10 p-2 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            {result.matchSource === "ambiguous"
              ? "More than one registered product matched"
              : "No registered product resolved"}
          </div>
          <p className="text-[11px]">{result.guidance}</p>
        </div>
        {result.aiSuggestion && <AiSuggestionPanel suggestion={result.aiSuggestion} />}
        <button
          type="button"
          onClick={onManual}
          className="text-[11px] underline text-primary hover:text-primary/80"
        >
          Enter this chemical manually
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded border bg-background p-2 text-xs space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold leading-tight">
              {fields.name ?? "Registered product"}
            </div>
            <div className="text-muted-foreground">
              {fields.registrant ?? "Registrant not stated"}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
            <Badge className={cn(TONE_CLASS[LOOKUP_VERIFICATION_TONE[verificationStatus]])}>
              {LOOKUP_VERIFICATION_LABEL[verificationStatus]}
            </Badge>
            {jurisdiction.country && (
              <Badge variant="outline" className="text-[10px]">
                {jurisdiction.country}
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <Row label="Category" value={fields.category} />
          <Row
            label="Registration"
            value={
              fields.registrationNumber
                ? `${(fields.registrationScheme ?? "").toUpperCase()} ${fields.registrationNumber}`.trim()
                : undefined
            }
          />
          <Row label="Country" value={fields.registrationCountry ? countryLabel(fields.registrationCountry) : undefined} />
          <Row label="Actives" value={fields.activeIngredientText} />
          <Row label="Groups" value={fields.chemicalGroupText} />
          <Row label="Rate" value={fields.rateText} />
          <Row
            label="WHP"
            value={fields.withholdingText}
          />
          <Row
            label="REI"
            value={fields.reEntryHours != null ? `${fields.reEntryHours} hours` : undefined}
          />
          <Row label="Label version" value={fields.labelVersion} />

        </div>

        {fields.rateReferenceOnly?.length ? (
          <div className="rounded border border-dashed border-muted-foreground/40 bg-muted/40 p-1.5 text-[11px] space-y-0.5">
            <div className="font-medium">Label rate text — reference only</div>
            {fields.rateReferenceOnly.map((r, i) => (
              <p key={i} className="text-muted-foreground">
                {r.text}
              </p>
            ))}
            <p className="italic text-muted-foreground">
              Not a structured rate, so it has not been applied to any field.
            </p>
          </div>
        ) : null}


        {result.conflicts.length > 0 && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-1.5 text-[11px]">
            <span className="font-medium">
              {result.conflicts.length} conflicting value
              {result.conflicts.length === 1 ? "" : "s"} between sources.
            </span>{" "}
            The registered values above are used; AI values never replace them.
          </div>
        )}

        {result.unresolvedFields.length > 0 && (
          <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              Not resolved from the label: {result.unresolvedFields.join(", ")}. These are left
              blank rather than estimated.
            </span>
          </div>
        )}

        {fields.labelReference && /^https?:\/\//i.test(fields.labelReference) && (
          <a
            href={fields.labelReference}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <FileText className="h-3 w-3" />
            Registered label
          </a>
        )}

        <Button type="button" size="sm" variant="outline" className="w-full" onClick={onApply}>
          <Check className="h-3.5 w-3.5 mr-1" />
          Apply this registered product
        </Button>
      </div>

      {result.aiSuggestion && <AiSuggestionPanel suggestion={result.aiSuggestion} />}

      <button
        type="button"
        onClick={onManual}
        className="text-[11px] underline text-primary hover:text-primary/80"
      >
        Not the right product? Enter manually
      </button>
    </div>
  );
}
