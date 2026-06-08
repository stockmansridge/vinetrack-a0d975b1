// Reusable KPI / metric card with left icon badge.
// Pure presentation — no data fetching, no business logic.
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  hint?: string;
  to?: string;
  /** Tone of the icon badge. Defaults to primary green. */
  tone?: "primary" | "accent" | "neutral";
}

const TONES: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  accent: "bg-accent/15 text-accent",
  neutral: "bg-muted text-muted-foreground",
};

export function MetricCard({ label, value, icon: Icon, hint, to, tone = "primary" }: MetricCardProps) {
  const body = (
    <div
      className={cn(
        "h-full rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,32,22,0.04)] transition",
        to && "hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", TONES[tone])}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold leading-tight tracking-tight text-foreground">{value}</div>
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
        className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
          {meta}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
