import { AlertTriangle } from "lucide-react";

/** Persistent banner shown at the top of System-Admin-only beta tools. */
export function BetaAdminBanner() {
  return (
    <div className="warning-banner mb-4 rounded-lg px-4 py-2.5 text-sm flex items-start gap-2">
      <AlertTriangle className="warning-banner__icon h-4 w-4 mt-0.5 shrink-0" />
      <span>
        <strong className="font-semibold">In development</strong> — visible to
        System Admins only.
      </span>
    </div>
  );
}

