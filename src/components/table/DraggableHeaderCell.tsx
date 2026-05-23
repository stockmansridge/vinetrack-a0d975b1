import * as React from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface DraggableHeaderCellProps {
  columnId: string;
  onDropColumn: (fromId: string, beforeId: string) => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps a TableHead's contents so it can be dragged into a new position.
 * - Drag is initiated from the grip handle only; sort/click targets keep working.
 * - Drop onto another header swaps positions via onDropColumn(fromId, beforeId).
 */
export function DraggableHeaderCell({
  columnId,
  onDropColumn,
  children,
  className,
}: DraggableHeaderCellProps) {
  const [draggingOver, setDraggingOver] = React.useState(false);
  const dragRef = React.useRef<HTMLDivElement>(null);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("application/x-vt-column", columnId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer.types;
    if (!types || !Array.from(types).includes("application/x-vt-column")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!draggingOver) setDraggingOver(true);
  };
  const handleDragLeave = () => setDraggingOver(false);
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggingOver(false);
    const fromId = e.dataTransfer.getData("application/x-vt-column");
    if (fromId && fromId !== columnId) onDropColumn(fromId, columnId);
  };

  return (
    <div
      className={cn(
        "group/col relative flex items-center gap-1 -mx-1 px-1 rounded transition-colors",
        draggingOver && "bg-accent/60 ring-1 ring-primary/40",
        className,
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        ref={dragRef}
        draggable
        onDragStart={handleDragStart}
        className="opacity-0 group-hover/col:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-opacity"
        title="Drag to reorder column"
        aria-label="Drag column"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
