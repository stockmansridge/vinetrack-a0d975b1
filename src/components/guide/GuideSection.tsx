import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function GuideSection({
  id,
  title,
  description,
  eyebrow,
  aside,
  children,
  className,
}: {
  id: string;
  title: string;
  description: string;
  eyebrow?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20 space-y-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div className="max-w-3xl">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
              {eyebrow}
            </p>
          )}
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function GuideGrid({
  children,
  columns = 3,
}: {
  children: ReactNode;
  columns?: 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 2
          ? "sm:grid-cols-1 lg:grid-cols-2"
          : "sm:grid-cols-2 xl:grid-cols-3",
      )}
    >
      {children}
    </div>
  );
}
