import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One shared page shell for EVERY How VineTrack Works surface — the landing
 * page and all drill-down routes (Stage 2.9).
 *
 * Individual guide pages must not add their own outer padding: the compact
 * ~12px header→content gap and the ~18-20px gutters live here so the landing
 * page and the drill-downs sit identically inside the portal shell.
 */
export function GuidePageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full px-[18px] pb-6 pt-3 xl:px-5", className)}>{children}</div>
  );
}
