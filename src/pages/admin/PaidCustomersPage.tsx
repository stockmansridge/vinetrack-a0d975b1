// Paid Customers — read-only list of paying subscriptions and their seats.
// Reads the existing System Admin licence-pool RPC; seat numbers are
// server-computed and never recalculated here. Manual grants are excluded.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, StatusPill, formatDate } from "./_shared";
import { useLicencePools, type LicencePool } from "@/lib/accessEntitlementsQuery";

const MANUAL = new Set(["manual", "grant", "admin_grant", "complimentary"]);

export function isPaidPool(p: LicencePool): boolean {
  const src = (p.billing_source ?? p.provider ?? "").toLowerCase();
  return !!src && !MANUAL.has(src);
}

export default function PaidCustomersPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useLicencePools({ limit: 500 });

  const paid = useMemo(() => (data?.pools ?? []).filter(isPaidPool), [data]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return paid;
    return paid.filter((p) =>
      [p.billing_owner_name, p.billing_owner_email, p.vineyard_name, p.plan_code]
        .some((v) => v?.toLowerCase().includes(s)),
    );
  }, [paid, search]);

  const totals = useMemo(
    () => ({
      customers: paid.length,
      seats: paid.reduce((t, p) => t + (p.is_unlimited ? 0 : p.licence_limit ?? 0), 0),
      assigned: paid.reduce((t, p) => t + p.assigned_licences, 0),
    }),
    [paid],
  );

  return (
    <AdminGate>
      <AdminPageHeader
        title="Paid Customers"
        subtitle="Paying subscriptions (Stripe and App Store) with their licence counts. Manual grants are listed under Billing Grants."
      />
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <Card className="p-4"><div className="text-xs text-muted-foreground">Paid customers</div><div className="text-2xl font-semibold">{totals.customers}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Licences paid for</div><div className="text-2xl font-semibold">{totals.seats}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Licences in use</div><div className="text-2xl font-semibold">{totals.assigned}</div></Card>
      </div>
      <Input
        className="mb-3 max-w-sm"
        placeholder="Search by name, email, vineyard or plan…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error ? (
        <AdminError error={error} />
      ) : isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <AdminEmpty>No paid customers found.</AdminEmpty>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Vineyard</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Paid via</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Seats</TableHead>
                <TableHead className="text-right">In use</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Renews</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.subscription_id}>
                  <TableCell>
                    <Link to={`/admin/users/${p.billing_owner_user_id}`} className="font-medium hover:underline">
                      {p.billing_owner_name || p.billing_owner_email || "Unknown"}
                    </Link>
                    {p.billing_owner_name && (
                      <div className="text-xs text-muted-foreground">{p.billing_owner_email}</div>
                    )}
                  </TableCell>
                  <TableCell>{p.vineyard_name ?? "—"}</TableCell>
                  <TableCell className="capitalize">{p.plan_code ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{p.billing_source ?? p.provider}</Badge></TableCell>
                  <TableCell>{p.subscription_status ? <StatusPill status={p.subscription_status} /> : "—"}</TableCell>
                  <TableCell className="text-right">{p.is_unlimited ? "Unlimited" : p.licence_limit ?? "—"}</TableCell>
                  <TableCell className="text-right">{p.assigned_licences}</TableCell>
                  <TableCell className="text-right">{p.is_unlimited ? "Unlimited" : p.available_licences ?? "—"}</TableCell>
                  <TableCell>{formatDate(p.current_period_end ?? p.expires_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </AdminGate>
  );
}
