// Searchable, category-grouped analyte picker shared by Trends, Compare and
// Reports. Presentation only: it returns the exact analyte key and never
// changes analyte IDs, categories, series selection or queries.
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

export interface SoilAnalyteOption {
  key: string;
  name: string;
  category: string | null;
}

export const ANALYTE_NO_RESULTS = "No matching analytes.";

/** Text searched for an option: name, canonical key (also with spaces) and category. */
export function analyteSearchText(o: SoilAnalyteOption): string {
  return [o.name, o.key, o.key.replace(/_/g, " "), o.category ?? "Other"].join(" ").toLowerCase();
}

/** Case-insensitive match used by the combobox filter (all words must match). */
export function analyteMatches(o: SoilAnalyteOption, query: string): boolean {
  const text = analyteSearchText(o);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => text.includes(w));
}

export function groupAnalyteOptions(options: SoilAnalyteOption[]): Array<[string, SoilAnalyteOption[]]> {
  const m = new Map<string, SoilAnalyteOption[]>();
  for (const o of options) {
    const c = o.category ?? "Other";
    if (!m.has(c)) m.set(c, []);
    if (!m.get(c)!.some((x) => x.key === o.key)) m.get(c)!.push(o);
  }
  return [...m.entries()];
}

interface Props {
  options: SoilAnalyteOption[];
  value: string;
  onChange: (key: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}

export function SoilAnalyteCombobox({
  options,
  value,
  onChange,
  placeholder = "Choose an analyte…",
  ariaLabel,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => groupAnalyteOptions(options), [options]);
  const byKey = useMemo(() => new Map(options.map((o) => [o.key, o])), [options]);
  const selected = byKey.get(value);

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
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.name : placeholder}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <Search className="h-3.5 w-3.5" />
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,90vw)] p-0" align="start">
        <Command
          filter={(itemValue, search) => {
            const o = byKey.get(itemValue);
            return o && analyteMatches(o, search) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search analytes…" autoFocus aria-label="Search analytes" />
          <CommandList>
            <CommandEmpty>{ANALYTE_NO_RESULTS}</CommandEmpty>
            {groups.map(([category, items]) => (
              <CommandGroup key={category} heading={category}>
                {items.map((o) => (
                  <CommandItem
                    key={o.key}
                    value={o.key}
                    keywords={[o.name, o.category ?? "Other"]}
                    onSelect={() => {
                      onChange(o.key);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", o.key === value ? "opacity-100" : "opacity-0")} />
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
