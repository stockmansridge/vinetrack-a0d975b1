import { Apple, Smartphone, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GuidePlatform } from "@/lib/guide/howVineTrackWorksCatalogue";

const META: Record<GuidePlatform, { label: string; Icon: typeof Apple }> = {
  ios: { label: "iOS", Icon: Apple },
  android: { label: "Android", Icon: Smartphone },
  web: { label: "Web", Icon: Monitor },
};

const ORDER: GuidePlatform[] = ["ios", "android", "web"];

/** Platform pills derived purely from the guide catalogue. */
export function PlatformBadges({
  platforms,
  className,
}: {
  platforms: GuidePlatform[];
  className?: string;
}) {
  const ordered = ORDER.filter((p) => platforms.includes(p));
  if (ordered.length === 0) {
    return (
      <span className={cn("text-[11px] font-medium text-muted-foreground", className)}>
        Not available on any platform
      </span>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {ordered.map((p) => {
        const { label, Icon } = META[p];
        return (
          <span
            key={p}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground/80"
          >
            <Icon className="h-3 w-3" />
            {label}
          </span>
        );
      })}
    </div>
  );
}
