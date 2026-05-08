import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import type { SortDirection } from "@/lib/useSortableTable";
import { cn } from "@/lib/utils";

interface SortableTableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  active: SortDirection | null;
  onSort: () => void;
  align?: "left" | "right" | "center";
  children: React.ReactNode;
}

/**
 * A clickable, accessible TableHead that displays a sort indicator.
 * - First click: ascending
 * - Second click: descending
 * - Third click: clears sort
 */
export function SortableTableHead({
  active,
  onSort,
  align = "left",
  className,
  children,
  ...rest
}: SortableTableHeadProps) {
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown;
  const ariaSort: React.AriaAttributes["aria-sort"] =
    active === "asc" ? "ascending" : active === "desc" ? "descending" : "none";
  return (
    <TableHead
      {...rest}
      aria-sort={ariaSort}
      className={cn(align === "right" && "text-right", className)}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "inline-flex items-center gap-1 select-none hover:text-foreground transition-colors",
          align === "right" && "ml-auto flex-row-reverse",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span>{children}</span>
        <Icon className={cn("h-3.5 w-3.5", !active && "opacity-50")} />
      </button>
    </TableHead>
  );
}
