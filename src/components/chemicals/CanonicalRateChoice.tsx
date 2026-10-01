import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type {
  CanonicalDefaultRateOption,
  CanonicalDefaultRateOptions,
  CanonicalRateBasis,
  PersistedDefaultRateSelection,
} from "@/lib/chemicalDefaultRatesContract";
import { MASTER_RATE_BASIS_LABEL } from "@/lib/chemicalSearchV2";
import { canonicalOptionHeading, targetSummary } from "@/lib/masterRateOptionGroups";
import { selectionSummary } from "@/lib/chemicalSearchV2";

const BASES: CanonicalRateBasis[] = ["per_hectare", "per_100_litres"];

function Targets({ targets }: { targets?: string[] }) {
  const [open, setOpen] = useState(false);
  const { preview, hiddenCount } = targetSummary(targets);
  if (!targets || targets.length === 0) return null;
  return (
    <div className="text-xs text-muted-foreground">
      {open ? targets.join(", ") : preview}
      {hiddenCount > 0 && (
        <Button
          type="button"
          variant="link"
          className="ml-1 h-auto p-0 text-xs"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        >
          {open ? "Show less" : "Show all"}
        </Button>
      )}
    </div>
  );
}

/** One radio per backend canonical option (never one per flattened weed row). */
export function CanonicalRateChoice({
  options,
  selections,
  onSelect,
  onClear,
}: {
  options: CanonicalDefaultRateOptions;
  selections: Record<CanonicalRateBasis, PersistedDefaultRateSelection | null>;
  onSelect: (basis: CanonicalRateBasis, option: CanonicalDefaultRateOption) => void;
  onClear: (basis: CanonicalRateBasis) => void;
}) {
  return (
    <>
      {BASES.map((basis) => {
        const list = options[basis];
        const selection = selections[basis];
        if (list.length === 0) return null;
        return (
          <div key={basis} className="space-y-2 rounded-md border p-3 text-sm" data-testid={`canonical-${basis}`}>
            <div className="text-xs font-medium text-muted-foreground">{MASTER_RATE_BASIS_LABEL[basis]}</div>
            {selection && list.length === 1 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{selectionSummary(selection)}</Badge>
                <span className="text-xs text-muted-foreground">From the Master Catalogue</span>
              </div>
            ) : (
              <RadioGroup
                className="space-y-2"
                value={selection?.option_key ?? ""}
                onValueChange={(key) => {
                  const o = list.find((x) => x.option_key === key);
                  if (o) onSelect(basis, o);
                }}
              >
                {list.map((o) => (
                  <label key={o.option_key} className="flex cursor-pointer items-start gap-2">
                    <RadioGroupItem className="mt-0.5" value={o.option_key} aria-label={canonicalOptionHeading(o)} />
                    <span className="space-y-0.5">
                      <span className="block">{canonicalOptionHeading(o)}</span>
                      <Targets targets={o.targets} />
                    </span>
                  </label>
                ))}
                {selection && (
                  <Button size="sm" variant="ghost" className="h-6 w-fit px-2 text-[11px]" onClick={() => onClear(basis)}>
                    Clear
                  </Button>
                )}
              </RadioGroup>
            )}
          </div>
        );
      })}
    </>
  );
}
