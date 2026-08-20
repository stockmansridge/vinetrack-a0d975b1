import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Page-wide progressive-disclosure primitive: a preview that is always shown,
 * plus depth that stays hidden until the user asks for it.
 */
export function ExpandableSection({
  preview,
  children,
  moreLabel,
  lessLabel = "Show less",
  id,
  className,
}: {
  preview: ReactNode;
  children: ReactNode;
  moreLabel: string;
  lessLabel?: string;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = id ? `${id}-detail` : undefined;

  return (
    <div className={cn("space-y-4", className)}>
      {preview}
      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          {open ? lessLabel : moreLabel}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div id={panelId} className="space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}
