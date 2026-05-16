// Variety picker — searches vineyard variety list via the shared Supabase
// catalogue. When the search text has no match the user can create a CUSTOM
// variety (server returns a stable `custom:<vineyard_id>:<slug>` key).
import { useMemo, useState } from "react";
import { Check, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  useVineyardGrapeVarieties,
  useUpsertVineyardGrapeVariety,
  type CatalogVariety,
} from "@/lib/varietyCatalog";
import { toast } from "@/hooks/use-toast";

interface Props {
  vineyardId: string | null | undefined;
  value?: { varietyKey: string; name: string } | null;
  onSelect: (v: { varietyKey: string; name: string; id?: string | null }) => void;
  disabled?: boolean;
  /** Variety keys already used in the editor — hidden from the picker. */
  excludeKeys?: string[];
  placeholder?: string;
}

export default function VarietyPicker({
  vineyardId,
  value,
  onSelect,
  disabled,
  excludeKeys = [],
  placeholder = "Select grape variety…",
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: list = [], isLoading } = useVineyardGrapeVarieties(vineyardId);
  const upsert = useUpsertVineyardGrapeVariety();

  const excluded = useMemo(() => new Set(excludeKeys), [excludeKeys]);
  const visible: CatalogVariety[] = useMemo(
    () => list.filter((v) => !excluded.has(v.variety_key)),
    [list, excluded],
  );

  const trimmed = search.trim();
  const hasExactMatch =
    trimmed.length > 0 &&
    list.some((v) => v.display_name.toLowerCase() === trimmed.toLowerCase());

  const handleAddCustom = async () => {
    if (!vineyardId) {
      toast({ title: "No vineyard selected", variant: "destructive" });
      return;
    }
    if (!trimmed) return;
    try {
      const row = await upsert.mutateAsync({
        vineyardId,
        varietyKey: null,
        displayName: trimmed,
      });
      if (!row) throw new Error("No row returned");
      onSelect({ varietyKey: row.variety_key, name: row.display_name, id: row.id ?? null });
      setSearch("");
      setOpen(false);
      toast({ title: "Custom variety added", description: row.display_name });
    } catch (err: any) {
      toast({
        title: "Could not add variety",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || !vineyardId}
          className="w-full justify-between font-normal"
        >
          <span className={value ? "" : "text-muted-foreground"}>
            {value?.name ?? placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter>
          <CommandInput
            placeholder="Search varieties…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {isLoading && (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading varieties…
              </div>
            )}
            <CommandEmpty>
              {trimmed ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={handleAddCustom}
                  disabled={upsert.isPending}
                >
                  {upsert.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  Add “{trimmed}” as custom variety
                </button>
              ) : (
                <span className="block px-3 py-2 text-sm text-muted-foreground">
                  No varieties.
                </span>
              )}
            </CommandEmpty>
            <CommandGroup>
              {visible.map((v) => (
                <CommandItem
                  key={v.variety_key}
                  value={v.display_name}
                  onSelect={() => {
                    onSelect({
                      varietyKey: v.variety_key,
                      name: v.display_name,
                      id: v.id ?? null,
                    });
                    setSearch("");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={`mr-2 h-3 w-3 ${
                      value?.varietyKey === v.variety_key ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span className="flex-1">{v.display_name}</span>
                  {v.is_custom && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      custom
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {trimmed && !hasExactMatch && visible.length > 0 && (
              <div className="border-t">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={handleAddCustom}
                  disabled={upsert.isPending}
                >
                  {upsert.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  Add “{trimmed}” as custom variety
                </button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
