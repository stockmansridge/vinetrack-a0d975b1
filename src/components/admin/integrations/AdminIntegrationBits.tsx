// Stage 7B — shared presentation pieces for the platform-admin integration UI.
import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  healthLabel,
  integrationErrorMessage,
  type AdminHealth,
} from "@/lib/adminIntegrationsQuery";

const HEALTH_CLASSES: Record<string, string> = {
  healthy:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  inactive: "border-border bg-muted text-muted-foreground",
};

/** Health is classified by the backend — this only renders the value. */
export function HealthBadge({
  health,
  reasons = [],
}: {
  health: AdminHealth | null | undefined;
  reasons?: string[];
}) {
  const key = String(health ?? "inactive");
  const badge = (
    <Badge
      variant="outline"
      className={cn("font-medium", HEALTH_CLASSES[key] ?? HEALTH_CLASSES.inactive)}
    >
      {healthLabel(key)}
    </Badge>
  );
  if (!reasons.length) return badge;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help">{badge}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <ul className="list-disc space-y-1 pl-4 text-xs">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Loading / error / empty wrapper — empty data must never look like a failure. */
export function AdminQueryState({
  isLoading,
  isError,
  error,
  isEmpty,
  emptyTitle,
  emptyDescription,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  children: ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (isError) {
    return <PortalNotice variant="error" description={integrationErrorMessage(error)} />;
  }
  if (isEmpty) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm font-medium">{emptyTitle}</p>
        {emptyDescription && (
          <p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p>
        )}
      </div>
    );
  }
  return <>{children}</>;
}

/** Keyset pagination controls — cursor based, never offsets. */
export function KeysetPager({
  page,
  hasNext,
  onPrev,
  onNext,
}: {
  page: number;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <span className="text-xs text-muted-foreground">Page {page + 1}</span>
      <Button variant="outline" size="sm" onClick={onPrev} disabled={page === 0}>
        Previous
      </Button>
      <Button variant="outline" size="sm" onClick={onNext} disabled={!hasNext}>
        Next
      </Button>
    </div>
  );
}

export function AdminRetentionNotice({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground">{text}</p>;
}
