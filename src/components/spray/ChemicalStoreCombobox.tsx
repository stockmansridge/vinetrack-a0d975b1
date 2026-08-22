// Searchable Chemical Store selection for the spray wizard.
//
// Searches the vineyard's current Chemical Store by product name, active
// ingredient, activity group, registration number and manufacturer. Selecting
// a product is always a deliberate act: nothing here name-matches or promotes
// an unresolved product into a verified identity.
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  VERIFICATION_LABEL,
  activityGroupSummary,
  type ChemicalIntelligence,
} from "@/lib/chemicalIntelligence";

export function chemicalSearchHaystack(c: ChemicalIntelligence): string {
  return [
    c.name,
    c.product.registeredProductName,
    c.product.registrationNumber,
    c.product.manufacturer,
    c.product.registrant,
    c.legacy.activeIngredient,
    c.legacy.chemicalGroup,
    c.actives.map((a) => a.name).join(" "),
    c.activityGroups.map((g) => `${g.scheme} ${g.code}`).join(" "),
    c.registeredUses.map((u) => [u.crop, u.target].filter(Boolean).join(" ")).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function ChemicalStoreCombobox({
  chemicals,
  value,
  onSelect,
  disabled,
  placeholder = "Search the Chemical Store…",
  triggerLabel,
}: {
  chemicals: ChemicalIntelligence[];
  value: string | null;
  onSelect: (id: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => chemicals.find((c) => c.id === value) ?? null,
    [chemicals, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...chemicals].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    if (!q) return list;
    return list.filter((c) => chemicalSearchHaystack(c).includes(q));
  }, [chemicals, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Search className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span className="truncate">
              {triggerLabel ?? selected?.name ?? "Search the Chemical Store"}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,90vw)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No product in the Chemical Store matches that search.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__none" onSelect={() => { onSelect(null); setOpen(false); }}>
                <Check className={cn("mr-2 h-4 w-4", value == null ? "opacity-100" : "opacity-0")} />
                Not set
              </CommandItem>
              {filtered.map((c) => {
                const groups = activityGroupSummary(c);
                const actives =
                  c.actives.map((a) => a.name).filter(Boolean).join(" + ") ||
                  c.legacy.activeIngredient;
                return (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => { onSelect(c.id); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name ?? "Unnamed chemical"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[actives, groups, VERIFICATION_LABEL[c.verification.status]]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
