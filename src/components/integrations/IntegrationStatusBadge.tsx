import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { IntegrationStatus } from "@/lib/integrationsQuery";

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  active: {
    label: "Active",
    className:
      "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  paused: {
    label: "Paused",
    className:
      "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  revoked: {
    label: "Revoked",
    className:
      "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  },
};

export function IntegrationStatusBadge({
  status,
  className,
}: {
  status: IntegrationStatus;
  className?: string;
}) {
  const style = STATUS_STYLES[status] ?? {
    label: status,
    className: "border-border bg-muted text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={cn("font-medium", style.className, className)}>
      {style.label}
    </Badge>
  );
}

export function ApiKeyStatusBadge({
  revokedAt,
  expiresAt,
}: {
  revokedAt: string | null;
  expiresAt: string | null;
}) {
  const expired = !!expiresAt && new Date(expiresAt).getTime() < Date.now();
  const status = revokedAt ? "revoked" : expired ? "expired" : "active";
  const label = revokedAt ? "Revoked" : expired ? "Expired" : "Active";
  const className =
    status === "active"
      ? STATUS_STYLES.active.className
      : status === "expired"
        ? STATUS_STYLES.paused.className
        : STATUS_STYLES.revoked.className;
  return (
    <Badge variant="outline" className={cn("font-medium", className)}>
      {label}
    </Badge>
  );
}
