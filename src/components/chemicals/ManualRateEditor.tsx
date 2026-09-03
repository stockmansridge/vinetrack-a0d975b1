// Manual RATE entry for an already-resolved registered product.
// Presentation only — every rule lives in `@/lib/chemicalManualRate`.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CanonicalRateBasis } from "@/lib/chemicalDefaultRatesContract";
import {
  MANUAL_RATE_BASIS_LABEL,
  MANUAL_RATE_CONFIRM_LABEL,
  MANUAL_RATE_CONFIRMED_BADGE,
  MANUAL_RATE_PROVENANCE_MESSAGE,
  MANUAL_RATE_UNITS,
  manualRateSatisfiesGate,
  manualRateSummary,
  validateManualRate,
  type ManualRateDraft,
  type ManualRateUnit,
} from "@/lib/chemicalManualRate";

export function ManualRateEditor({
  draft,
  onChange,
  onCancel,
}: {
  draft: ManualRateDraft;
  onChange: (next: ManualRateDraft) => void;
  onCancel: () => void;
}) {
  const patch = (p: Partial<ManualRateDraft>) => onChange({ ...draft, ...p });
  const validation = validateManualRate(draft);
  const touched =
    draft.kind === "single"
      ? draft.value.trim() !== ""
      : draft.min.trim() !== "" || draft.max.trim() !== "";
  const summary = manualRateSummary(draft);

  return (
    <div className="mb-2 space-y-3 rounded-md border border-border/60 bg-muted/40 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">Enter the rate manually</div>
        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">Rate type</Label>
        <RadioGroup
          className="flex gap-4"
          value={draft.kind}
          onValueChange={(v) => patch({ kind: v as ManualRateDraft["kind"] })}
        >
          <label className="flex cursor-pointer items-center gap-1.5">
            <RadioGroupItem value="single" aria-label="Single rate" /> Single rate
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <RadioGroupItem value="range" aria-label="Range" /> Range
          </label>
        </RadioGroup>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">Rate basis</Label>
        <RadioGroup
          className="flex gap-4"
          value={draft.basis}
          onValueChange={(v) => patch({ basis: v as CanonicalRateBasis })}
        >
          <label className="flex cursor-pointer items-center gap-1.5">
            <RadioGroupItem value="per_hectare" aria-label={MANUAL_RATE_BASIS_LABEL.per_hectare} />{" "}
            {MANUAL_RATE_BASIS_LABEL.per_hectare}
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <RadioGroupItem
              value="per_100_litres"
              aria-label={MANUAL_RATE_BASIS_LABEL.per_100_litres}
            />{" "}
            {MANUAL_RATE_BASIS_LABEL.per_100_litres}
          </label>
        </RadioGroup>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {draft.kind === "single" ? (
          <div className="space-y-1">
            <Label className="text-[11px]" htmlFor="manual-rate-value">Rate</Label>
            <Input
              id="manual-rate-value"
              aria-label="Rate"
              type="number"
              inputMode="decimal"
              step="any"
              className="h-8 w-24 text-xs"
              value={draft.value}
              onChange={(e) => patch({ value: e.target.value })}
            />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <Label className="text-[11px]" htmlFor="manual-rate-min">Minimum</Label>
              <Input
                id="manual-rate-min"
                aria-label="Minimum"
                type="number"
                inputMode="decimal"
                step="any"
                className="h-8 w-24 text-xs"
                value={draft.min}
                onChange={(e) => patch({ min: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]" htmlFor="manual-rate-max">Maximum</Label>
              <Input
                id="manual-rate-max"
                aria-label="Maximum"
                type="number"
                inputMode="decimal"
                step="any"
                className="h-8 w-24 text-xs"
                value={draft.max}
                onChange={(e) => patch({ max: e.target.value })}
              />
            </div>
          </>
        )}
        <div className="space-y-1">
          <Label className="text-[11px]">Product unit</Label>
          <Select
            value={draft.unit}
            onValueChange={(v) => patch({ unit: v as ManualRateUnit })}
          >
            <SelectTrigger className="h-8 w-20 text-xs" aria-label="Product unit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MANUAL_RATE_UNITS.map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {summary && (
          <Badge variant="outline" className="mb-1 text-[11px]">{summary}</Badge>
        )}
      </div>

      {touched && validation.ok === false && (
        <p className="text-[11px] text-destructive" role="alert">{validation.message}</p>
      )}

      <p className="text-[11px] text-muted-foreground">{MANUAL_RATE_PROVENANCE_MESSAGE}</p>

      <label className="flex cursor-pointer items-start gap-2 text-[11px]">
        <Checkbox
          checked={draft.confirmed}
          aria-label={MANUAL_RATE_CONFIRM_LABEL}
          onCheckedChange={(c) => patch({ confirmed: c === true })}
        />
        <span>{MANUAL_RATE_CONFIRM_LABEL}</span>
      </label>

      {manualRateSatisfiesGate(draft) && (
        <Badge variant="outline" className="text-[10px]">{MANUAL_RATE_CONFIRMED_BADGE}</Badge>
      )}
    </div>
  );
}
