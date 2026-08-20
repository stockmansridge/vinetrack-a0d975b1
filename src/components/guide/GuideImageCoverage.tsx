import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { guideImageGroups, type GuideImageKey } from "@/lib/guide/guideImages";
import { useGuideImages } from "@/lib/guide/guideImageStore";

/**
 * Stage 5A — Guide Images coverage report.
 *
 * A read-only summary of which guide image slots have a real uploaded asset
 * and which are still running on the neutral fallback. It reads the existing
 * image map only — no new storage, no new keys, no invented imagery.
 */
export function GuideImageCoverage() {
  const { data, isLoading } = useGuideImages();
  const groups = guideImageGroups();

  const rows = groups.map((group) => {
    const slots = [...group.primary, ...group.workflow];
    const uploaded = slots.filter((s) => !!data?.[s.key as GuideImageKey]).length;
    const missing = slots
      .filter((s) => !data?.[s.key as GuideImageKey])
      .map((s) => s.label);
    return { group, total: slots.length, uploaded, missing };
  });

  const total = rows.reduce((n, r) => n + r.total, 0);
  const uploaded = rows.reduce((n, r) => n + r.uploaded, 0);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Image coverage</h2>
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? "Checking uploaded images…"
            : `${uploaded} of ${total} slots have a real image — the rest show the neutral fallback.`}
        </p>
      </div>

      <div className="mt-3 space-y-2">
        {rows.map(({ group, total: t, uploaded: u, missing }) => (
          <div
            key={group.group}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/20 px-3 py-2"
          >
            <span className="text-sm font-medium">{group.groupLabel}</span>
            <Badge
              variant={u === t ? "secondary" : "outline"}
              className={cn(
                "text-[11px]",
                u === t ? "" : "border-destructive/30 text-destructive",
              )}
            >
              {u} of {t} uploaded
            </Badge>
            {missing.length > 0 && (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                Still needed: {missing.join(", ")}
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
