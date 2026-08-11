// Clone & rootstock selectors — portal parity with the iOS/Android pickers
// defined by the sql/182 contract.
//
// Both selectors write BOTH the stable key and the display snapshot back to
// the allocation. Legacy free text is offered as a "Keep …" option and is
// never rewritten automatically.
import { useMemo, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";
import {
  CLONE_MASS_SELECTION_KEY,
  CLONE_MASS_SELECTION_LABEL,
  ROOTSTOCK_OWN_ROOTS_KEY,
  ROOTSTOCK_OWN_ROOTS_LABEL,
  cloneMatches,
  cloneSubtitle,
  clonesForVariety,
  isLegacyFreeText,
  rootstockMatches,
  rootstockOptions,
  useCloneCatalog,
  useRootstockCatalog,
  useUpsertVineyardClone,
  useUpsertVineyardRootstock,
  useVineyardClones,
  useVineyardRootstocks,
} from "@/lib/cloneRootstockCatalog";

export interface CatalogSelection {
  /** Stable identity, a sentinel key, or null (not specified / legacy text). */
  key: string | null;
  /** Display snapshot written to the allocation. */
  display: string | null;
}

interface Option {
  id: string;
  key: string | null;
  display: string;
  subtitle?: string;
  badge?: string;
}

function SelectorShell({
  label,
  value,
  disabled,
  placeholder,
  searchPlaceholder,
  options,
  onPick,
  onCreate,
  creating,
  canCreate,
}: {
  label: string;
  value: CatalogSelection;
  disabled?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  options: (query: string) => Option[];
  onPick: (o: Option) => void;
  onCreate?: (name: string) => void;
  creating?: boolean;
  canCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const trimmed = search.trim();
  const rows = useMemo(() => options(trimmed), [options, trimmed]);
  const exact = rows.some((o) => o.display.toLowerCase() === trimmed.toLowerCase());

  const createRow = onCreate && canCreate && trimmed.length > 0 && !exact && (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
      onClick={() => onCreate(trimmed)}
      disabled={creating}
    >
      {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
      Add “{trimmed}” as custom {label.toLowerCase()}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={value.display ? "truncate" : "truncate text-muted-foreground"}>
            {value.display ?? placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {createRow ?? (
                <span className="block px-3 py-2 text-sm text-muted-foreground">No matches.</span>
              )}
            </CommandEmpty>
            <CommandGroup>
              {rows.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  onSelect={() => {
                    onPick(o);
                    setSearch("");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={`mr-2 h-3 w-3 shrink-0 ${
                      (value.key ?? null) === (o.key ?? null) &&
                      (o.key !== null || value.display === o.display)
                        ? "opacity-100"
                        : "opacity-0"
                    }`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{o.display}</span>
                    {o.subtitle && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {o.subtitle}
                      </span>
                    )}
                  </span>
                  {o.badge && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {o.badge}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {rows.length > 0 && createRow && <div className="border-t">{createRow}</div>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ClonePicker({
  vineyardId,
  varietyKey,
  value,
  onChange,
  disabled,
  canCreate = false,
}: {
  vineyardId: string | null | undefined;
  varietyKey: string | null | undefined;
  value: CatalogSelection;
  onChange: (v: CatalogSelection) => void;
  disabled?: boolean;
  canCreate?: boolean;
}) {
  const { data: builtIns = [] } = useCloneCatalog();
  const { data: customs = [] } = useVineyardClones(vineyardId);
  const upsert = useUpsertVineyardClone();

  const legacy = isLegacyFreeText(value.key, value.display) ? value.display! : null;

  const options = useMemo(
    () => (query: string) => {
      const base: Option[] = [
        { id: "__none__", key: null, display: "Not specified" },
        {
          id: CLONE_MASS_SELECTION_KEY,
          key: CLONE_MASS_SELECTION_KEY,
          display: CLONE_MASS_SELECTION_LABEL,
          subtitle: "No certified clone",
        },
      ];
      if (legacy) {
        base.push({
          id: "__legacy__",
          key: null,
          display: legacy,
          subtitle: "Existing entry — kept as recorded",
          badge: "legacy",
        });
      }
      const catalogue = clonesForVariety(builtIns, customs, varietyKey)
        .filter((c) => cloneMatches(c, query))
        .map<Option>((c) => ({
          id: c.key,
          key: c.key,
          display: c.display_name,
          subtitle: cloneSubtitle(c) || undefined,
          badge: c.is_custom ? "custom" : undefined,
        }));
      const q = query.trim().toLowerCase();
      const filteredBase = q
        ? base.filter((o) => o.display.toLowerCase().includes(q))
        : base;
      return [...filteredBase, ...catalogue];
    },
    [builtIns, customs, varietyKey, legacy],
  );

  const handleCreate = async (name: string) => {
    if (!vineyardId || !varietyKey) {
      toast({ title: "Select a variety first", variant: "destructive" });
      return;
    }
    try {
      const row = await upsert.mutateAsync({ vineyardId, varietyKey, displayName: name });
      if (!row) throw new Error("No row returned");
      onChange({ key: row.key, display: row.display_name });
      toast({ title: "Custom clone added", description: row.display_name });
    } catch (err: any) {
      // Degrade to preserved free text — never block saving the block.
      onChange({ key: null, display: name });
      toast({
        title: "Saved as free text",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <SelectorShell
      label="Clone"
      value={value}
      disabled={disabled || !varietyKey}
      placeholder={varietyKey ? "Not specified" : "Select a variety first"}
      searchPlaceholder="Search clones…"
      options={options}
      onPick={(o) => onChange({ key: o.key, display: o.key === null && o.id === "__none__" ? null : o.display })}
      onCreate={handleCreate}
      creating={upsert.isPending}
      canCreate={canCreate && !!varietyKey}
    />
  );
}

export function RootstockPicker({
  vineyardId,
  value,
  onChange,
  disabled,
  canCreate = false,
}: {
  vineyardId: string | null | undefined;
  value: CatalogSelection;
  onChange: (v: CatalogSelection) => void;
  disabled?: boolean;
  canCreate?: boolean;
}) {
  const { data: builtIns = [] } = useRootstockCatalog();
  const { data: customs = [] } = useVineyardRootstocks(vineyardId);
  const upsert = useUpsertVineyardRootstock();

  const legacy = isLegacyFreeText(value.key, value.display) ? value.display! : null;

  const options = useMemo(
    () => (query: string) => {
      const base: Option[] = [
        { id: "__none__", key: null, display: "Not recorded" },
        {
          id: ROOTSTOCK_OWN_ROOTS_KEY,
          key: ROOTSTOCK_OWN_ROOTS_KEY,
          display: ROOTSTOCK_OWN_ROOTS_LABEL,
          subtitle: "Ungrafted vines",
        },
      ];
      if (legacy) {
        base.push({
          id: "__legacy__",
          key: null,
          display: legacy,
          subtitle: "Existing entry — kept as recorded",
          badge: "legacy",
        });
      }
      const catalogue = rootstockOptions(builtIns, customs)
        .filter((r) => rootstockMatches(r, query))
        .map<Option>((r) => ({
          id: r.key,
          key: r.key,
          display: r.display_name,
          subtitle: r.parentage ?? undefined,
          badge: r.is_custom ? "custom" : undefined,
        }));
      const q = query.trim().toLowerCase();
      const filteredBase = q ? base.filter((o) => o.display.toLowerCase().includes(q)) : base;
      return [...filteredBase, ...catalogue];
    },
    [builtIns, customs, legacy],
  );

  const handleCreate = async (name: string) => {
    if (!vineyardId) {
      toast({ title: "No vineyard selected", variant: "destructive" });
      return;
    }
    try {
      const row = await upsert.mutateAsync({ vineyardId, displayName: name });
      if (!row) throw new Error("No row returned");
      onChange({ key: row.key, display: row.display_name });
      toast({ title: "Custom rootstock added", description: row.display_name });
    } catch (err: any) {
      onChange({ key: null, display: name });
      toast({
        title: "Saved as free text",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <SelectorShell
      label="Rootstock"
      value={value}
      disabled={disabled}
      placeholder="Not recorded"
      searchPlaceholder="Search rootstocks…"
      options={options}
      onPick={(o) =>
        onChange({ key: o.key, display: o.key === null && o.id === "__none__" ? null : o.display })
      }
      onCreate={handleCreate}
      creating={upsert.isPending}
      canCreate={canCreate}
    />
  );
}
