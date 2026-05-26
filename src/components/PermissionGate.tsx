import { Outlet, useLocation } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { canAccessRoute, getAllowedRoles } from "@/lib/rolePermissions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

export function PermissionDenied() {
  const { currentRole } = useVineyard();
  const { pathname } = useLocation();
  const allowed = getAllowedRoles(pathname);
  return (
    <div className="p-8">
      <Card className="max-w-xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Permission required</CardTitle>
          </div>
          <CardDescription>
            You don't have permission to view this page. Please contact a vineyard
            owner or manager.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          {currentRole && (
            <p>
              Your role on the selected vineyard:{" "}
              <span className="font-medium capitalize text-foreground">{currentRole}</span>
            </p>
          )}
          {allowed && (
            <p>
              This page requires:{" "}
              <span className="font-medium text-foreground">{allowed.join(" or ")}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Outlet wrapper used in route trees — renders children only if role allows. */
export function RoleRoute() {
  const { currentRole } = useVineyard();
  const { pathname } = useLocation();
  if (!canAccessRoute(pathname, currentRole)) {
    return <PermissionDenied />;
  }
  return <Outlet />;
}
