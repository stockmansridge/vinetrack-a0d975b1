import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { v3ReviewQueue, pick } from "@/lib/chemicalV3";

const DONE = new Set(["approved", "rejected", "superseded"]);

/** System Admin only: count of chemical catalogue revisions awaiting review. */
export function ChemicalReviewAlertPill() {
  const navigate = useNavigate();
  const { isAdmin } = useIsSystemAdmin();
  const { data: count = 0 } = useQuery({
    queryKey: ["admin", "chemical-v3", "pending-count"],
    enabled: isAdmin,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const rows = await v3ReviewQueue();
      return rows.filter((r) => {
        const s = String(pick(r, "review_status", "status", "revision_status") ?? "").toLowerCase();
        return !DONE.has(s);
      }).length;
    },
  });

  if (!isAdmin || count <= 0) return null;
  const label = `${count} chemical review${count === 1 ? "" : "s"} pending`;
  return (
    <button
      type="button"
      onClick={() => navigate("/admin/chemical-v3")}
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/25 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-200"
      aria-label={label}
    >
      <FlaskConical className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}
