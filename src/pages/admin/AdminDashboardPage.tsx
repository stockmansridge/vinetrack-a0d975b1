import { Link, Navigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Bell, Flag, ArrowRight } from "lucide-react";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { useFeatureFlags } from "@/lib/systemAdmin";
import { useAuth } from "@/context/AuthContext";
import { useAppNotices } from "@/lib/appNotices";

const SHARED_PROJECT_REF = "tbafuqwruefgkbyxrxyb";

export default function AdminDashboardPage() {
  const { isAdmin, loading } = useIsSystemAdmin();
  const { user } = useAuth();
  const { data: flags = [] } = useFeatureFlags();
  const { data: notices = [] } = useAppNotices();

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const enabledFlags = flags.filter((f) => f.is_enabled);
  const activeNotices = notices.filter((n) => n.is_active);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Platform-level tools shared with the iOS app.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <div className="font-medium">System admin access confirmed</div>
            <div className="text-xs text-muted-foreground">
              Signed in as <span className="font-mono">{user?.email}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Shared backend project: <span className="font-mono">{SHARED_PROJECT_REF}</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/admin/feature-flags">
          <Card className="p-4 hover:bg-accent/40 transition-colors h-full">
            <div className="flex items-center gap-2 mb-2">
              <Flag className="h-4 w-4" />
              <h2 className="font-semibold">Feature Flags</h2>
              <Badge variant="outline" className="ml-auto">
                {enabledFlags.length}/{flags.length} on
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Toggle diagnostics and beta features across iOS and the portal.
            </p>
            <div className="mt-3 inline-flex items-center text-xs text-primary">
              Open <ArrowRight className="h-3 w-3 ml-1" />
            </div>
          </Card>
        </Link>

        <Link to="/admin/notices">
          <Card className="p-4 hover:bg-accent/40 transition-colors h-full">
            <div className="flex items-center gap-2 mb-2">
              <Bell className="h-4 w-4" />
              <h2 className="font-semibold">App Notices</h2>
              <Badge variant="outline" className="ml-auto">
                {activeNotices.length} active
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Manage app-wide banners shown across iOS and the portal.
            </p>
            <div className="mt-3 inline-flex items-center text-xs text-primary">
              Open <ArrowRight className="h-3 w-3 ml-1" />
            </div>
          </Card>
        </Link>
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-2">Diagnostics status</h2>
        {enabledFlags.length === 0 ? (
          <div className="text-xs text-muted-foreground">No diagnostics flags currently enabled.</div>
        ) : (
          <ul className="text-xs text-muted-foreground space-y-1">
            {enabledFlags.map((f) => (
              <li key={f.key}>
                <span className="font-mono text-foreground">{f.key}</span>
                {f.label ? ` — ${f.label}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
