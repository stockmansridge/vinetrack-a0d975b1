import { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Navigate } from "react-router-dom";
import { useIsSystemAdmin } from "@/lib/systemAdmin";

export function AdminGate({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useIsSystemAdmin();
  if (loading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function AdminPageHeader({
  title,
  subtitle,
  back = "/admin/dashboard",
  actions,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(back)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}

export function AdminError({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <Card className="p-3 flex items-center gap-2 text-sm">
      <AlertTriangle className="h-4 w-4 text-orange-500" />
      <span>{msg}</span>
    </Card>
  );
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-muted-foreground py-8 text-center">{children}</div>;
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-orange-500/15 text-orange-600 border-orange-500/30",
    accepted: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    declined: "bg-muted text-muted-foreground border-border",
    expired: "bg-muted text-muted-foreground border-border",
    cancelled: "bg-muted text-muted-foreground border-border",
    active: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    inactive: "bg-muted text-muted-foreground border-border",
  };
  const cls = map[status.toLowerCase()] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${cls}`}>
      {status}
    </span>
  );
}

export function ArchivedBadge() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase tracking-wide border bg-muted text-muted-foreground border-border">
      Archived
    </span>
  );
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

export function formatRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function CrumbLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-xs text-primary hover:underline">
      {children}
    </Link>
  );
}
