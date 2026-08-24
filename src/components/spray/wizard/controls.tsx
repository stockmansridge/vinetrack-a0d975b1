// Shared, obviously-interactive wizard controls.
//
// The spray wizard asks the operator to make real choices (basis, canopy,
// sprayer output). Those choices must read as CONTROLS before they are
// selected — a passive tinted panel is not a control. Every tile below is a
// real radio button with a visible border, a pointer cursor, hover and focus
// states, and a radio dot.
import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function SelectTile({
  selected,
  disabled,
  onSelect,
  title,
  hint,
  className,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  hint?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "group flex w-full cursor-pointer items-start gap-2 rounded-md border-2 bg-background px-3 py-2 text-left text-sm transition",
        "hover:border-primary/60 hover:bg-muted/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-60",
        selected ? "border-primary bg-primary/10 ring-2 ring-primary/40" : "border-border",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition",
          selected ? "border-primary" : "border-muted-foreground/60 group-hover:border-primary/70",
        )}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}

/**
 * Readable help. Deliberately NOT a native tooltip: the copy is several
 * sentences long and must wrap, grow vertically and stay inside the modal on
 * small browser windows.
 */
export function HelpTip({ title, body }: { title: string; body: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${title}`}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="max-h-[60vh] w-[min(22rem,calc(100vw-3rem))] overflow-y-auto"
      >
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-1 whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground">
          {body}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function FieldHeading({
  label,
  help,
  className,
}: {
  label: string;
  help?: { title: string; body: string };
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span className="text-sm font-medium">{label}</span>
      {help && <HelpTip title={help.title} body={help.body} />}
    </div>
  );
}
