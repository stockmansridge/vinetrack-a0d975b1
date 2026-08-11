import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

/** Compact multi-select used by the Yield Analytics filter bar. */
export default function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "All",
  className,
  searchable = true,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, q]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? placeholder
      : `${selected.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn("justify-between font-normal", className)}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {searchable && (
          <div className="p-2 border-b">
            <Input
              className="h-8"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        )}
        <ScrollArea className="max-h-64">
          <div className="p-1">
            {filtered.length === 0 && (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">No matches</div>
            )}
            {filtered.map((o) => {
              const active = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded border",
                      active ? "bg-primary text-primary-foreground border-primary" : "border-input",
                    )}
                  >
                    {active && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
        {selected.length > 0 && (
          <div className="flex items-center justify-between border-t p-2">
            <Badge variant="secondary" className="font-normal">
              {selected.length} selected
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => onChange([])}>
              <X className="mr-1 h-3 w-3" /> Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
