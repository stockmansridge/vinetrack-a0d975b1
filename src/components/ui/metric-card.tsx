// Reusable KPI / metric card with left icon badge.
// Pure presentation — no data fetching, no business logic.
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type MetricTone = "primary" | "accent" | "teal" | "amber" | "purple" | "neutral" | "white" | "equipment" | "team";

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  hint?: string;
  to?: string;
  /** Tone of the icon badge. Defaults to primary green. */
  tone?: MetricTone;
}

// Controlled, intentional palette. No "disabled-looking" greys.
export const TONE_CLASSES: Record<MetricTone, string> = {
  primary: "bg-primary/10 text-primary",
  accent: "bg-accent/15 text-accent",
  teal: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  amber: "bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20",
  purple: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  white: "bg-white text-primary ring-1 ring-inset ring-border shadow-sm dark:bg-white dark:text-primary",
  // Equipment metrics: distinct amber/orange treatment so equipment cards
  // (Tractors, Spray Equipment, etc.) stand apart from vineyard/block metrics.
  equipment:
    "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200/70 dark:bg-[rgba(245,158,11,0.14)] dark:text-amber-300 dark:ring-amber-400/20",
  // Team / people metrics: teal so people cards stand apart from
  // vineyard (green) and equipment (amber).
  team:
    "bg-teal-100 text-teal-700 ring-1 ring-inset ring-teal-200/70 dark:bg-[rgba(20,184,166,0.14)] dark:text-teal-300 dark:ring-teal-400/20",
};
const TONES = TONE_CLASSES;

export function MetricCard({ label, value, icon: Icon, hint, to, tone = "primary" }: MetricCardProps) {
  const body = (
    <div
      className={cn(
        "h-full rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,32,22,0.04)] transition",
        to && "hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", TONES[tone])}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-foreground tabular-nums">
            {value}
          </div>
          {hint && <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{hint}</div>}
        </div>
      </div>
    </div>
  );
  if (to) {
    return (
      <Link
        to={to}
        aria-label={`${label} — open`}
        className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {body}
      </Link>
    );
  }
  return body;
}

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}

export function PageHeader({ title, description, actions, meta }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[26px] md:text-[28px] font-semibold tracking-tight text-foreground leading-tight">
            {title}
          </h1>
          {meta}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
