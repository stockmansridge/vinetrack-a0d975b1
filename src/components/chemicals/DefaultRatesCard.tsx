// Default rate selection — explicit, operator-owned, grapevine-only.
//
// The portal NEVER silently invents a default. It offers the distinct rates the
// label actually states for grapevines, keeps /100 L and /ha apart, and only
// pre-selects one when the conservative rule in `chemicalDefaultRates` allows.
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type {
  DefaultRateGroup,
  DefaultRateOption,
  DefaultRateOptions,
} from "@/lib/chemicalDefaultRates";

const REASON_TEXT: Record<string, string> = {
  jurisdiction: "Recommended — the only registered rate for your state",
  only_registered_rate: "Recommended — the only registered grapevine rate",
};

function Group({
  group,
  title,
  selectedId,
  onSelect,
}: {
  group: DefaultRateGroup;
  title: string;
  selectedId?: string | null;
  onSelect: (o: DefaultRateOption) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium">{title}</div>
      {group.options.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{group.emptyMessage}</p>
      ) : (
        <RadioGroup
          value={selectedId ?? ""}
          onValueChange={(v) => {
            const opt = group.options.find((o) => o.id === v);
            if (opt) onSelect(opt);
          }}
          className="space-y-1.5"
        >
          {group.options.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 p-2"
            >
              <RadioGroupItem value={o.id} className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="flex flex-wrap items-center gap-2 text-xs font-medium">
                  {o.text}
                  {o.isRange && (
                    <Badge variant="outline" className="text-[10px]">Label range</Badge>
                  )}
                  {group.recommendedId === o.id && (
                    <Badge variant="secondary" className="text-[10px]">Recommended</Badge>
                  )}
                </span>
                {o.contexts.map((c, i) => (
                  <span key={i} className="block text-[11px] text-muted-foreground">{c}</span>
                ))}
              </span>
            </label>
          ))}
        </RadioGroup>
      )}
      {group.recommendedId && group.recommendationReason && (
        <p className="text-[11px] text-muted-foreground">
          {REASON_TEXT[group.recommendationReason]}
        </p>
      )}
      {group.requiresChoice && group.options.length > 1 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          This label states more than one grapevine rate — choose the one you use.
        </p>
      )}
    </div>
  );
}

export function DefaultRatesCard({
  options,
  selectedId,
  onSelect,
  className,
}: {
  options: DefaultRateOptions;
  selectedId?: string | null;
  onSelect: (o: DefaultRateOption) => void;
  className?: string;
}) {
  const nothing =
    options.per100L.options.length === 0 && options.perHectare.options.length === 0;
  return (
    <div className={className}>
      {nothing ? (
        <p className="text-xs text-muted-foreground">
          No registered grapevine rate was resolved from the label — enter the rate
          you use manually.
        </p>
      ) : (
        <div className="space-y-3">
          <Group
            group={options.per100L}
            title="Per 100 L"
            selectedId={selectedId}
            onSelect={onSelect}
          />
          <Group
            group={options.perHectare}
            title="Per hectare"
            selectedId={selectedId}
            onSelect={onSelect}
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
