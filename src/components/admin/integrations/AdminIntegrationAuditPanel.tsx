// Stage 7B — platform-admin integration audit history (admin_list_integration_audit).
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { AdminQueryState, KeysetPager } from "./AdminIntegrationBits";
import { useKeysetPager } from "./useKeysetPager";
import {
  ADMIN_PAGE_SIZE,
  RETENTION_NOTICE,
  formatDateTime,
  nextCursor,
  safeAuditSummary,
  useAdminIntegrationAudit,
} from "@/lib/adminIntegrationsQuery";
import { auditActionLabel } from "@/lib/integrationsQuery";

const ACTOR_CLASSES: Record<string, string> = {
  platform_admin:
    "border-primary/40 bg-primary/10 text-primary font-semibold",
  admin: "border-primary/40 bg-primary/10 text-primary font-semibold",
  system: "border-border bg-muted text-muted-foreground",
  user: "border-border bg-background text-foreground",
};

function actorTypeLabel(value: string | null): string {
  if (!value) return "Unknown";
  if (value === "platform_admin" || value === "admin") return "Platform admin";
  if (value === "system") return "System";
  if (value === "user") return "User";
  return value;
}

export function AdminIntegrationAuditPanel({
  clientId = null,
}: {
  clientId?: string | null;
}) {
  const pager = useKeysetPager();
  const q = useAdminIntegrationAudit({ clientId }, pager.cursor);
  const rows = q.data ?? [];
  const cursor = rows.length >= ADMIN_PAGE_SIZE ? nextCursor(rows) : null;

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">Audit history</CardTitle>
        <p className="text-xs text-muted-foreground">{RETENTION_NOTICE}</p>
      </CardHeader>
      <CardContent>
        <AdminQueryState
          isLoading={q.isLoading}
          isError={q.isError}
          error={q.error}
          isEmpty={rows.length === 0}
          emptyTitle="No audit events"
          emptyDescription="Integration changes will be recorded here."
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Actor type</TableHead>
                  <TableHead>Integration</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(e.created_at)}
                    </TableCell>
                    <TableCell>{e.actor ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(ACTOR_CLASSES[e.actor_type ?? ""] ?? ACTOR_CLASSES.user)}
                      >
                        {actorTypeLabel(e.actor_type)}
                      </Badge>
                    </TableCell>
                    <TableCell>{e.integration_name ?? "—"}</TableCell>
                    <TableCell className="font-medium">{auditActionLabel(e.action)}</TableCell>
                    <TableCell>{e.target ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {safeAuditSummary(e)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <KeysetPager
            page={pager.page}
            hasNext={!!cursor}
            onPrev={pager.prev}
            onNext={() => pager.next(cursor)}
          />
        </AdminQueryState>
      </CardContent>
    </Card>
  );
}
