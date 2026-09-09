import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavViewer } from "@/hooks/useNavViewer";
import { canAccessRoute } from "@/lib/rolePermissions";
import {
  ACCOUNT_ACTIVITY,
  accessibleViews,
  resolveLocation,
} from "@/lib/navigationConfig";

/**
 * Breadcrumb + route-based tab row shown above the existing page.
 *
 * It only adds links. It never wraps, replaces or remounts page content, and
 * each link goes to the page's existing URL.
 */
export function ActivityNavigation() {
  const { pathname } = useLocation();
  const viewer = useNavViewer();
  const { activity, view } = resolveLocation(pathname);

  if (!activity) return null;

  const views = accessibleViews(activity, viewer);
  const crossLinks = (activity.crossLinks ?? []).filter((l) =>
    canAccessRoute(l.path, viewer.role),
  );
  const isAccount = activity.id === ACCOUNT_ACTIVITY.id;
  // Nothing useful to show for a single-destination activity.
  if (views.length < 2 && crossLinks.length === 0) return null;

  return (
    <nav aria-label={`${activity.label} navigation`} className="mb-4 space-y-2">
      <ol className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <li>{isAccount ? "Account" : activity.group}</li>
        <ChevronRight aria-hidden="true" className="h-3 w-3" />
        <li className="text-foreground">{activity.label}</li>
        {view && (
          <>
            <ChevronRight aria-hidden="true" className="h-3 w-3" />
            <li className="text-foreground">{view.label}</li>
          </>
        )}
      </ol>

      <div className="flex flex-wrap items-center gap-1.5">
        {views.map((v) => {
          const active = v.id === view?.id;
          return (
            <Link
              key={v.id}
              to={v.path}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {v.label}
            </Link>
          );
        })}

        {crossLinks.length ? (
          <span className="ml-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            {crossLinks.map((l) => (
              <Link key={l.path} to={l.path} className="underline-offset-2 hover:text-foreground hover:underline">
                {l.label}
              </Link>
            ))}
          </span>
        ) : null}
      </div>
    </nav>
  );
}
