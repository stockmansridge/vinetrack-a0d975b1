import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import type { SortDirection } from "@/lib/useSortableTable";
import { cn } from "@/lib/utils";

interface BaseProps {
  columnId: string;
  onDropColumn: (fromId: string, beforeId: string) => void;
  align?: "left" | "right" | "center";
  className?: string;
  children: React.ReactNode;
}

interface ReorderableHeadProps extends BaseProps {
  /** Sort props — omit to render a non-sortable header. */
  sort?: {
    active: SortDirection | null;
    onSort: () => void;
  };
}

/**
 * A TableHead that is draggable (for column reordering) and optionally sortable.
 * - Drag handle (GripVertical) appears on hover at the left of the cell.
 * - If `sort` is provided, the label becomes a clickable sort button.
 */
export function ReorderableHead({
  columnId,
  onDropColumn,
  align = "left",
  className,
  children,
  sort,
}: ReorderableHeadProps) {
  const [draggingOver, setDraggingOver] = React.useState(false);

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("application/x-vt-column", columnId);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent<HTMLTableCellElement>) => {
    const types = e.dataTransfer.types;
    if (!types || !Array.from(types).includes("application/x-vt-column")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!draggingOver) setDraggingOver(true);
  };
  const onDragLeave = () => setDraggingOver(false);
  const onDrop = (e: React.DragEvent<HTMLTableCellElement>) => {
    e.preventDefault();
    setDraggingOver(false);
    const from = e.dataTransfer.getData("application/x-vt-column");
    if (from && from !== columnId) onDropColumn(from, columnId);
  };

  const ariaSort: React.AriaAttributes["aria-sort"] = sort
    ? sort.active === "asc"
      ? "ascending"
      : sort.active === "desc"
        ? "descending"
        : "none"
    : undefined;

  const Icon = sort
    ? sort.active === "asc"
      ? ArrowUp
      : sort.active === "desc"
        ? ArrowDown
        : ArrowUpDown
    : null;

  return (
    <TableHead
      aria-sort={ariaSort}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        align === "right" && "text-right",
        align === "center" && "text-center",
        draggingOver && "bg-accent/60",
        className,
      )}
    >
      <div
        className={cn(
          "group/col inline-flex items-center gap-1",
          align === "right" && "flex-row-reverse w-full justify-start",
          align === "center" && "w-full justify-center",
        )}
      >
        <div
          draggable
          onDragStart={onDragStart}
          className="opacity-0 group-hover/col:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-opacity"
          title="Drag to reorder column"
          aria-label="Drag column"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>
        {sort ? (
          <button
            type="button"
            onClick={sort.onSort}
            className={cn(
              "inline-flex items-center gap-1 select-none hover:text-foreground transition-colors",
              align === "right" && "flex-row-reverse",
              sort.active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span>{children}</span>
            {Icon && <Icon className={cn("h-3.5 w-3.5", !sort.active && "opacity-50")} />}
          </button>
        ) : (
          <span className="select-none">{children}</span>
        )}
      </div>
    </TableHead>
  );
}
