// Searchable multi-select analyte picker for Trends. Presentation only: it
// toggles exact analyte keys and never changes analyte IDs, categories,
// series selection or queries. Selections survive search-text changes.
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ANALYTE_NO_RESULTS,
  analyteMatches,
  groupAnalyteOptions,
  type SoilAnalyteOption,
} from "./SoilAnalyteCombobox";

interface Props {
  options: SoilAnalyteOption[];
  values: string[];
  onChange: (keys: string[]) => void;
  ariaLabel: string;
  className?: string;
}

export function SoilAnalyteMultiSelect({ options, values, onChange, ariaLabel, className }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const groups = useMemo(() => groupAnalyteOptions(options), [options]);
  const selected = useMemo(() => new Set(values), [values]);
  const visible = useMemo(() => options.filter((o) => analyteMatches(o, search)), [options, search]);

  const toggle = (key: string) =>
    onChange(selected.has(key) ? values.filter((k) => k !== key) : [...values, key]);
  const selectAllVisible = () => {
    const next = new Set(values);
    for (const o of visible) next.add(o.key);
    onChange([...next]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn("h-9 w-full min-w-[16rem] justify-between gap-2 px-2 font-normal sm:w-72", className)}
        >
          <span className={cn("truncate", !values.length && "text-muted-foreground")}>
            {values.length
              ? `${values.length} analyte${values.length === 1 ? "" : "s"} selected`
              : "Choose analytes…"}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <Search className="h-3.5 w-3.5" />
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,90vw)] p-0" align="start">
        <Command
          filter={(itemValue, s) => {
            const o = options.find((x) => x.key === itemValue);
            return o && analyteMatches(o, s) ? 1 : 0;
          }}
        >
          <CommandInput
            placeholder="Search analytes…"
            autoFocus
            aria-label="Search analytes"
            value={search}
            onValueChange={setSearch}
          />
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={selectAllVisible}>
              Select all visible
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onChange([])}>
              Clear
            </Button>
          </div>
          <CommandList>
            <CommandEmpty>{ANALYTE_NO_RESULTS}</CommandEmpty>
            {groups.map(([category, items]) => (
              <CommandGroup key={category} heading={category}>
                {items.map((o) => (
                  <CommandItem
                    key={o.key}
                    value={o.key}
                    keywords={[o.name, o.category ?? "Other"]}
                    onSelect={() => toggle(o.key)}
                    aria-checked={selected.has(o.key)}
                    role="option"
                    aria-selected={selected.has(o.key)}
                  >
                    <Check className={cn("mr-2 h-4 w-4", selected.has(o.key) ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{o.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
