// Collapsed orange diagnostics panel for verified system admins only.
//
// Customers never see technical explanations (internal contracts, table or
// function names, migration numbers). Those live here, behind the same
// system-admin check used by the admin area — vineyard Owner/Manager status is
// deliberately NOT enough. Nothing in this panel is ever rendered into a PDF.
import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useIsSystemAdmin } from "@/lib/systemAdmin";

export interface SystemAdminDiagnosticsProps {
  /** Technical notes; empty/blank entries are ignored. */
  details: (string | null | undefined)[];
  title?: string;
  className?: string;
}

export function SystemAdminDiagnostics({
  details,
  title = "System admin diagnostics",
  className,
}: SystemAdminDiagnosticsProps) {
  const { isAdmin } = useIsSystemAdmin();
  const [open, setOpen] = useState(false);
  const items = details.filter((d): d is string => !!d && d.trim().length > 0);
  if (!isAdmin || !items.length) return null;

  return (
    <div
      data-testid="system-admin-diagnostics"
      className={`rounded-md border border-amber-500/50 bg-amber-500/5 text-amber-900 dark:text-amber-200 ${className ?? ""}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {title}
      </button>
      {open && (
        <ul className="list-disc space-y-1 px-8 pb-3 text-xs font-normal">
          {items.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SystemAdminDiagnostics;
