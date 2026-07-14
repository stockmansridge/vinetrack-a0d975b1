import { Outlet } from "react-router-dom";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import NotFound from "@/pages/NotFound";

/** Route wrapper: renders children only for system admins; otherwise 404.
 *  Loading state renders nothing to avoid flashing a 404 before the check
 *  resolves. */
export function RequireSystemAdmin() {
  const { isAdmin, loading } = useIsSystemAdmin();
  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!isAdmin) return <NotFound />;
  return <Outlet />;
}
