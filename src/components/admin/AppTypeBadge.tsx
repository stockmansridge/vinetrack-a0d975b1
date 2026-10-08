import { cn } from "@/lib/utils";
import { PORTAL_APP_TYPE, appTypeLabel } from "@/lib/portalClientActivity";

/** Single source of truth for platform badge colours (label is always shown too). */
export function appTypeBadgeClass(t: string | null | undefined): string {
  switch (t) {
    case "ios":
      return "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:bg-blue-400/15 dark:text-blue-300 dark:border-blue-400/40";
    case "android":
      return "bg-green-500/10 text-green-700 border-green-500/30 dark:bg-green-400/15 dark:text-green-300 dark:border-green-400/40";
    case PORTAL_APP_TYPE:
      return "bg-violet-500/10 text-violet-700 border-violet-500/30 dark:bg-violet-400/15 dark:text-violet-300 dark:border-violet-400/40";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function AppTypeBadge({ appType, className }: { appType: string | null | undefined; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium",
        appTypeBadgeClass(appType),
        className,
      )}
    >
      {appTypeLabel(appType)}
    </span>
  );
}
