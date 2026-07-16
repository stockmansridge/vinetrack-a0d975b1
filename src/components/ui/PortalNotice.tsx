import * as React from "react";
import { AlertTriangle, Info, CheckCircle2, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type PortalNoticeVariant = "info" | "success" | "warning" | "error";

export interface PortalNoticeProps {
  variant?: PortalNoticeVariant;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
}

interface VariantStyles {
  container: string;
  iconWrap: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}

const VARIANTS: Record<PortalNoticeVariant, VariantStyles> = {
  warning: {
    container:
      "border-[#F2B84B] bg-gradient-to-r from-[#FFF8E6] to-[#FFFDF7] text-[#4B5563] dark:border-[#6A4A0E] dark:bg-none dark:bg-[#171A17] dark:text-[#D7D9D5]",
    iconWrap:
      "bg-[#FFF3D6] text-[#D97706] dark:bg-amber-500/10 dark:text-[#F5B000]",
    icon: AlertTriangle,
    title: "text-[#92400E] dark:text-[#F6C453]",
    body: "text-[#4B5563] dark:text-[#D7D9D5]",
  },
  success: {
    container:
      "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
    iconWrap:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
    icon: CheckCircle2,
    title: "text-emerald-900 dark:text-emerald-200 font-semibold",
    body: "text-emerald-900/90 dark:text-emerald-200/90",
  },
  info: {
    container:
      "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200",
    iconWrap:
      "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300",
    icon: Info,
    title: "text-sky-900 dark:text-sky-200 font-semibold",
    body: "text-sky-900/90 dark:text-sky-200/90",
  },
  error: {
    container:
      "border-destructive/40 bg-destructive/10 text-destructive-foreground dark:bg-destructive/15",
    iconWrap:
      "bg-destructive/15 text-destructive dark:bg-destructive/25",
    icon: XCircle,
    title: "text-destructive font-semibold",
    body: "text-foreground",
  },
};

export function PortalNotice({
  variant = "info",
  title,
  description,
  action,
  compact = false,
  dismissible = false,
  onDismiss,
  className,
  icon: IconOverride,
  children,
}: PortalNoticeProps) {
  const styles = VARIANTS[variant];
  const Icon = IconOverride ?? styles.icon;

  return (
    <div
      role="status"
      className={cn(
        "flex items-start rounded-lg border",
        compact ? "gap-2.5 px-3.5 py-2.5" : "gap-3 px-4 py-3.5",
        styles.container,
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full",
          compact ? "h-8 w-8" : "h-9 w-9",
          styles.iconWrap,
        )}
      >
        <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </div>

      <div className="min-w-0 flex-1">
        {title && (
          <div className={cn("leading-5", styles.title, compact ? "text-sm" : "text-sm font-semibold")}>
            {title}
          </div>
        )}
        {description && (
          <div className={cn("text-sm leading-5", styles.body, title ? "mt-0.5" : "")}>
            {description}
          </div>
        )}
        {children}
      </div>

      {action && <div className="shrink-0 self-center">{action}</div>}

      {dismissible && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          aria-label="Dismiss notice"
          className="h-7 w-7 shrink-0 self-start rounded-full"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export default PortalNotice;
