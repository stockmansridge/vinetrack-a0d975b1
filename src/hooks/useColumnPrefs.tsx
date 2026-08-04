import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Columns3 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ColumnDef<K extends string> = {
  key: K;
  label: string;
  align?: "right" | "center";
  /** Column is only available when the user can see costs. */
  cost?: boolean;
  /** Column can never be hidden. */
  always?: boolean;
};

export type ColumnPrefs<K extends string> = {
  availableColumns: ColumnDef<K>[];
  visibleColumns: ColumnDef<K>[];
  isVisible: (key: K) => boolean;
  toggleColumn: (key: K) => void;
  showAll: () => void;
  resetDefault: () => void;
  hiddenCount: number;
};

/**
 * Shared column-visibility state for report tables.
 * Preferences persist per browser under `vinetrack.<storageKey>.columns.v1`.
 */
export function useColumnPrefs<K extends string>(opts: {
  storageKey: string;
  columns: ColumnDef<K>[];
  defaultHidden?: K[];
  canSeeCosts?: boolean;
}): ColumnPrefs<K> {
  const { storageKey, columns, defaultHidden = [], canSeeCosts = true } = opts;
  const lsKey = `vinetrack.${storageKey}.columns.v1`;

  const [hidden, setHidden] = useState<Set<K>>(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw) return new Set(JSON.parse(raw) as K[]);
    } catch { /* ignore */ }
    return new Set(defaultHidden);
  });

  useEffect(() => {
    try { localStorage.setItem(lsKey, JSON.stringify(Array.from(hidden))); } catch { /* ignore */ }
  }, [hidden, lsKey]);

  const availableColumns = useMemo(
    () => columns.filter((c) => !c.cost || canSeeCosts),
    [columns, canSeeCosts],
  );

  const visibleColumns = useMemo(
    () => availableColumns.filter((c) => c.always || !hidden.has(c.key)),
    [availableColumns, hidden],
  );

  return {
    availableColumns,
    visibleColumns,
    isVisible: (key: K) => visibleColumns.some((c) => c.key === key),
    toggleColumn: (key: K) =>
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      }),
    showAll: () => setHidden(new Set()),
    resetDefault: () => setHidden(new Set(defaultHidden)),
    hiddenCount: hidden.size,
  };
}

/** Dropdown for toggling report table columns. */
export function ColumnSelector<K extends string>({ prefs }: { prefs: ColumnPrefs<K> }) {
  const { availableColumns, visibleColumns, isVisible, toggleColumn, showAll, resetDefault } = prefs;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Columns3 className="h-4 w-4" />
          Columns ({visibleColumns.length}/{availableColumns.length})
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 max-h-[70vh] overflow-y-auto">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableColumns.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.key}
            checked={isVisible(c.key)}
            disabled={c.always}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggleColumn(c.key)}
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => showAll()}>Show all</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => resetDefault()}>Reset to default</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
