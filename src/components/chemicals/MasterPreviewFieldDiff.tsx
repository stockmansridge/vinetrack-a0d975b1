// Master Catalogue Review — readable scalar field diff (no JSON).
import { Badge } from "@/components/ui/badge";
import { safeExternalUrl } from "@/lib/masterReview";
import {
  CHANGE_TYPE_LABEL,
  changeSource,
  changeType,
  type ChangeType,
} from "@/lib/masterPreviewDiff";
import type { MasterPreviewChange } from "@/lib/masterReviewPreview";

const TYPE_VARIANT: Record<ChangeType, "default" | "secondary" | "outline" | "destructive"> = {
  added: "default",
  changed: "secondary",
  removed: "destructive",
  unchanged: "outline",
};

function Value({ value }: { value: string | null }) {
  const url = safeExternalUrl(value);
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-primary underline break-all">
        {value}
      </a>
    );
  }
  if (value == null || value.trim() === "") {
    return <span className="text-muted-foreground">Not set</span>;
  }
  return <span className="whitespace-pre-wrap break-words">{value}</span>;
}

export function MasterPreviewFieldDiff({ changes }: { changes: MasterPreviewChange[] }) {
  if (changes.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-md border border-border/60">
      <div className="hidden md:grid grid-cols-[1fr_1.4fr_1.4fr_0.9fr_0.7fr] gap-2 border-b border-border/60 bg-muted/40 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
        <span>Field</span>
        <span>Current</span>
        <span>Proposed</span>
        <span>Source</span>
        <span>Change</span>
      </div>
      <div className="divide-y divide-border/60">
        {changes.map((c) => {
          const type = changeType(c.current, c.proposed);
          return (
            <div
              key={c.field}
              className="grid gap-2 px-3 py-2 md:grid-cols-[1fr_1.4fr_1.4fr_0.9fr_0.7fr] md:items-start"
            >
              <div className="font-medium">{c.label}</div>
              <div className="min-w-0 max-h-32 overflow-y-auto text-muted-foreground">
                <span className="md:hidden text-[10px]">Current: </span>
                <Value value={c.current} />
              </div>
              <div className="min-w-0 max-h-32 overflow-y-auto">
                <span className="md:hidden text-[10px]">Proposed: </span>
                <Value value={c.proposed} />
              </div>
              <div className="text-muted-foreground">{changeSource(c)}</div>
              <div>
                <Badge variant={TYPE_VARIANT[type]} className="text-[10px]">
                  {CHANGE_TYPE_LABEL[type]}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
