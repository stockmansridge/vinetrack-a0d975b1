// Default rate selection — explicit, operator-owned, backend-canonical.
//
// Gate D4B-P2B. The selectable options come ONLY from the backend canonical
// `default_rate_options` set; `option_key` is the radio identity. The portal
// never mints an option id, never converts between /100 L and /ha, and never
// selects anything automatically. /100 L and /ha are two fully independent
// groups with two independent selected states.
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type {
  CanonicalDefaultRateOption,
  CanonicalDefaultRateOptions,
  CanonicalRateBasis,
} from "@/lib/chemicalDefaultRatesContract";
import {
  BASIS_SUFFIX,
  BASIS_TITLE,
  NEEDS_REVIEW_MESSAGE,
  UNAVAILABLE_MESSAGE,
  defaultRateAmountText,
  isDefaultRateRange,
  validateVineyardDose,
  type DefaultRateSlotState,
} from "@/lib/chemicalDefaultRateSelection";

function OptionRow({
  option,
  basis,
}: {
  option: CanonicalDefaultRateOption;
  basis: CanonicalRateBasis;
}) {
  const range = isDefaultRateRange(option);
  return (
    <span className="space-y-0.5">
      <span className="flex flex-wrap items-center gap-2 text-xs font-medium">
        {defaultRateAmountText(option)} {BASIS_SUFFIX[basis]}
        {range && <Badge variant="outline" className="text-[10px]">Label range</Badge>}
        {option.condition_ambiguous && (
          <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-500">
            Check label conditions
          </Badge>
        )}
      </span>
      {/* Backend display metadata only — never reconstructed from registered_uses. */}
      {option.targets?.length ? (
        <span className="block text-[11px] text-muted-foreground">
          {option.targets.join(", ")}
        </span>
      ) : null}
      {option.conditions?.map((c, i) => (
        <span key={i} className="block text-[11px] text-muted-foreground">{c}</span>
      ))}
    </span>
  );
}

/**
 * PART 10 — the vineyard's usual operational dose inside an authoritative
 * label RANGE. The registered evidence is never edited: this only narrows the
 * vineyard's own selection, and only within [min, max].
 */
function VineyardDoseInput({
  option,
  basis,
  current,
  onCommit,
}: {
  option: CanonicalDefaultRateOption;
  basis: CanonicalRateBasis;
  current: number | null;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(current == null ? "" : String(current));
  useEffect(() => {
    setText(current == null ? "" : String(current));
  }, [current]);
  const trimmed = text.trim();
  const validation = trimmed === "" ? null : validateVineyardDose(option, trimmed);
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Your usual rate</span>
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          aria-label={`Your usual rate ${BASIS_SUFFIX[basis]}`}
          className="h-7 w-24 text-xs"
          value={text}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (validation?.ok) onCommit(validation.value);
          }}
        />
        <span className="text-[11px] text-muted-foreground">
          {option.unit} {BASIS_SUFFIX[basis]}
        </span>
      </div>
      {validation && validation.ok === false && (
        <p className="text-[11px] text-destructive">{validation.message}</p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Label range {defaultRateAmountText(option)} {BASIS_SUFFIX[basis]} is unchanged.
      </p>
    </div>
  );
}

function Group({
  basis,
  options,
  slot,
  onSelect,
  onSelectDose,
  onClear,
}: {
  basis: CanonicalRateBasis;
  options: CanonicalDefaultRateOption[];
  slot: DefaultRateSlotState;
  onSelect: (option: CanonicalDefaultRateOption) => void;
  onSelectDose: (option: CanonicalDefaultRateOption, value: number) => void;
  onClear: () => void;
}) {
  // A needs_review / unavailable snapshot NEVER selects a different option.
  const selectedKey =
    slot.status === "matched" ? (slot.matchedOption?.option_key ?? "") : "";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium">{BASIS_TITLE[basis]}</div>
        {slot.selection && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={onClear}
          >
            Clear saved default
          </Button>
        )}
      </div>

      {options.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No {BASIS_TITLE[basis].toLowerCase()} default option was resolved from the
          current label.
        </p>
      ) : (
        <RadioGroup
          value={selectedKey}
          onValueChange={(v) => {
            const opt = options.find((o) => o.option_key === v);
            if (opt) onSelect(opt);
          }}
          className="space-y-1.5"
        >
          {options.map((o) => (
            <label
              key={o.option_key}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 p-2"
            >
              <RadioGroupItem value={o.option_key} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <OptionRow option={o} basis={basis} />
                {selectedKey === o.option_key && isDefaultRateRange(o) && (
                  <VineyardDoseInput
                    option={o}
                    basis={basis}
                    current={slot.selection?.value ?? null}
                    onCommit={(v) => onSelectDose(o, v)}
                  />
                )}
              </span>
            </label>
          ))}
        </RadioGroup>
      )}

      {slot.status === "unavailable" && slot.selection && (
        <div className="rounded-md border border-border/60 bg-muted/40 p-2 text-[11px]">
          <div className="font-medium">
            Saved default: {defaultRateAmountText(slot.selection)} {BASIS_SUFFIX[basis]}
          </div>
          <p className="text-muted-foreground">{UNAVAILABLE_MESSAGE}</p>
        </div>
      )}

      {slot.status === "needs_review" && slot.selection && (
        <div className="rounded-md border border-warning/50 bg-warning/10 p-2 text-[11px]">
          <div className="font-medium">
            Saved default: {defaultRateAmountText(slot.selection)} {BASIS_SUFFIX[basis]}
          </div>
          <p className="text-muted-foreground">{NEEDS_REVIEW_MESSAGE}</p>
        </div>
      )}

      {options.length > 1 && slot.status !== "matched" && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          This label states more than one grapevine {BASIS_TITLE[basis].toLowerCase()}{" "}
          rate — choose the one you use.
        </p>
      )}
    </div>
  );
}

export function DefaultRatesCard({
  options,
  slots,
  onSelect,
  onSelectDose,
  onClear,
  className,
}: {
  /** Backend canonical options, or null when none were fetched this session. */
  options: CanonicalDefaultRateOptions | null;
  slots: Record<CanonicalRateBasis, DefaultRateSlotState>;
  onSelect: (option: CanonicalDefaultRateOption, basis: CanonicalRateBasis) => void;
  /** Vineyard's usual dose inside an authoritative label range. */
  onSelectDose?: (
    option: CanonicalDefaultRateOption,
    basis: CanonicalRateBasis,
    value: number,
  ) => void;
  onClear: (basis: CanonicalRateBasis) => void;
  className?: string;
}) {
  const noOptions =
    !options || (options.per_hectare.length === 0 && options.per_100_litres.length === 0);
  const noSaved = !slots.per_hectare.selection && !slots.per_100_litres.selection;

  return (
    <div className={className}>
      {noOptions && noSaved ? (
        <p className="text-xs text-muted-foreground">
          No registered grapevine default rate option was resolved from the label —
          run a chemical lookup to load the current label options.
        </p>
      ) : (
        <div className="space-y-3">
          <Group
            basis="per_100_litres"
            options={options?.per_100_litres ?? []}
            slot={slots.per_100_litres}
            onSelect={(o) => onSelect(o, "per_100_litres")}
            onSelectDose={(o, v) => onSelectDose?.(o, "per_100_litres", v)}
            onClear={() => onClear("per_100_litres")}
          />
          <Group
            basis="per_hectare"
            options={options?.per_hectare ?? []}
            slot={slots.per_hectare}
            onSelect={(o) => onSelect(o, "per_hectare")}
            onSelectDose={(o, v) => onSelectDose?.(o, "per_hectare", v)}
            onClear={() => onClear("per_hectare")}
          />
          <p className="text-[11px] text-muted-foreground">
            Per 100 L and per hectare rates are separate label directions and are
            never converted into one another.
          </p>
        </div>
      )}
    </div>
  );
}
