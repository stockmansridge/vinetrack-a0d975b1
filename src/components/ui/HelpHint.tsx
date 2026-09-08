import * as React from "react";
import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface HelpHintProps {
  /** Accessible name for the trigger, e.g. "Why this row has no length". */
  label: string;
  /** The explanation itself. */
  children: React.ReactNode;
  /** Optional visible trigger text; defaults to an information icon. */
  triggerText?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * Essential help that works by tap, click and keyboard.
 *
 * Hover-only tooltips are unreachable on touch devices and for keyboard users
 * when the trigger is a plain span or SVG. This renders a real button inside a
 * portalled popover: touch users tap to open and tap outside (or press Escape)
 * to dismiss, keyboard users tab to it and press Enter/Space, and Radix
 * restores focus to the trigger on close. Clicks are stopped so opening the
 * explanation never toggles the row or action underneath.
 */
export function HelpHint({ label, children, triggerText, className, contentClassName }: HelpHintProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => {
            // Stop only propagation — calling preventDefault would suppress
            // Radix's own composed handler and the popover would never open.
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex min-h-[24px] items-center gap-1 rounded text-left align-middle text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            triggerText ? "underline decoration-dotted underline-offset-2" : "",
            className,
          )}
        >
          {triggerText ?? <Info className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("max-w-xs text-sm", contentClassName)}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export default HelpHint;
