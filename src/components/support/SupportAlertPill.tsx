import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { LifeBuoy } from "lucide-react";
import { useUnresolvedSupportCount } from "@/lib/supportRequestsCount";
import { useIsSystemAdmin } from "@/lib/systemAdmin";

const TOAST_SESSION_KEY = "support-alert-toast-shown";

export function SupportAlertPill() {
  const navigate = useNavigate();
  const { isAdmin } = useIsSystemAdmin();
  const { data: count = 0 } = useUnresolvedSupportCount();
  const toastedRef = useRef(false);

  useEffect(() => {
    if (!isAdmin || count <= 0) return;
    if (toastedRef.current) return;
    try {
      if (sessionStorage.getItem(TOAST_SESSION_KEY)) {
        toastedRef.current = true;
        return;
      }
      sessionStorage.setItem(TOAST_SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    toastedRef.current = true;
    toast(`${count} support case${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention`, {
      action: {
        label: "Open",
        onClick: () => navigate("/admin/support-requests"),
      },
    });
  }, [isAdmin, count, navigate]);

  if (!isAdmin || count <= 0) return null;

  return (
    <button
      type="button"
      onClick={() => navigate("/admin/support-requests")}
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/25 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-200"
      aria-label={`${count} support cases need attention`}
    >
      <LifeBuoy className="h-3.5 w-3.5" />
      <span>{count} support case{count === 1 ? "" : "s"} need{count === 1 ? "s" : ""} attention</span>
    </button>
  );
}
