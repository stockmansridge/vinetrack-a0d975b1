import { useMemo, useState, useCallback } from "react";

export type SortDirection = "asc" | "desc";

export type SortableValue = string | number | Date | null | undefined;

export interface SortState<K extends string = string> {
  key: K | null;
  direction: SortDirection;
}

export interface UseSortableTableOptions<T, K extends string> {
  /** Map of column keys to value-accessors used for comparison. */
  accessors: Record<K, (row: T) => SortableValue>;
  /** Optional initial sort state. */
  initial?: SortState<K>;
}

export interface UseSortableTableResult<T, K extends string> {
  sorted: T[];
  sort: SortState<K>;
  toggleSort: (key: K) => void;
  getSortDirection: (key: K) => SortDirection | null;
}

const isNullish = (v: SortableValue): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (typeof v === "number" && Number.isNaN(v));

function compareValues(a: SortableValue, b: SortableValue): number {
  const aNull = isNullish(a);
  const bNull = isNullish(b);
  // Nulls/blanks always sort last regardless of direction.
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  if (a instanceof Date || b instanceof Date) {
    const av = a instanceof Date ? a.getTime() : new Date(a as any).getTime();
    const bv = b instanceof Date ? b.getTime() : new Date(b as any).getTime();
    return av - bv;
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  // Try numeric coerce when both look numeric.
  const an = typeof a === "number" ? a : Number(a);
  const bn = typeof b === "number" ? b : Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && typeof a !== "string" && typeof b !== "string") {
    return an - bn;
  }
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
}

export function useSortableTable<T, K extends string>(
  rows: T[],
  options: UseSortableTableOptions<T, K>,
): UseSortableTableResult<T, K> {
  const { accessors, initial } = options;
  const [sort, setSort] = useState<SortState<K>>(initial ?? { key: null, direction: "asc" });

  const toggleSort = useCallback((key: K) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return { key: null, direction: "asc" };
    });
  }, []);

  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const accessor = accessors[sort.key];
    if (!accessor) return rows;
    // Stable sort with index tiebreaker.
    const decorated = rows.map((row, i) => ({ row, i, val: accessor(row) }));
    const dir = sort.direction === "asc" ? 1 : -1;
    decorated.sort((a, b) => {
      const cmp = compareValues(a.val, b.val);
      // Nulls always last — keep their order when both sides are non-null.
      const aNull = isNullish(a.val);
      const bNull = isNullish(b.val);
      if (aNull || bNull) return cmp; // already handled (null = last)
      return cmp !== 0 ? cmp * dir : a.i - b.i;
    });
    return decorated.map((d) => d.row);
  }, [rows, sort, accessors]);

  const getSortDirection = useCallback(
    (key: K): SortDirection | null => (sort.key === key ? sort.direction : null),
    [sort],
  );

  return { sorted, sort, toggleSort, getSortDirection };
}
