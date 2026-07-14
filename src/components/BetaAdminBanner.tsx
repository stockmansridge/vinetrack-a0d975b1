import { AlertTriangle } from "lucide-react";

/** Persistent banner shown at the top of System-Admin-only beta tools. */
export function BetaAdminBanner() {
  return (
    <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>
        <strong className="font-semibold">In development</strong> — visible to
        System Admins only.
      </span>
    </div>
  );
}
