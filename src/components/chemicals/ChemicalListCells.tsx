// Shared compact cells for vineyard chemical lists (Chemicals + Chemical Inventory).
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { signedV3MediaUrl } from "@/lib/chemicalV3";
import { labelLinkOf, type V3RevisionDisplay } from "@/lib/chemicalV3Display";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Front-label thumbnail from the linked catalogue revision. Opens the label. */
export function ChemicalLabelThumb({ row, rev, size = "h-12 w-12" }: {
  row: any; rev?: V3RevisionDisplay | null; size?: string;
}) {
  const path: string | undefined = rev?.front_label_image_path || row?.front_label_image_path || undefined;
  const { data: src } = useQuery({
    queryKey: ["chemical-search-media", path ?? null], enabled: !!path, staleTime: 30 * 60_000,
    queryFn: () => signedV3MediaUrl(path),
  });
  const box = cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40", size);
  const inner = src
    ? <img src={src} alt={`${row?.name ?? "Chemical"} label`} className="h-full w-full object-contain" loading="lazy" />
    : <span className="px-1 text-center text-[9px] leading-tight text-muted-foreground">No label image</span>;
  const href = labelLinkOf(row, rev);
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title="Open label" data-testid="chemical-label-thumb"
        className={cn(box, "transition hover:border-primary hover:ring-1 hover:ring-primary/40")}>
        {inner}
      </a>
    );
  }
  return <div className={box} title="No label link" data-testid="chemical-label-thumb">{inner}</div>;
}

/** First 2 targets, then "+N more" — click reveals the complete list. */
export function UsedForCell({ targets }: { targets: string[] }) {
  if (!targets.length) return <span className="text-muted-foreground">—</span>;
  const shown = targets.slice(0, 2);
  const rest = targets.length - shown.length;
  return (
    <div className="max-w-[220px] text-sm leading-snug" title={targets.join(" · ")}>
      <span className="line-clamp-2">{shown.join(" · ")}</span>
      {rest > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="text-xs text-primary hover:underline">+{rest} more</button>
          </PopoverTrigger>
          <PopoverContent className="w-64 text-sm">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Used for</div>
            <ul className="list-disc space-y-0.5 pl-4">{targets.map((t) => <li key={t}>{t}</li>)}</ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
