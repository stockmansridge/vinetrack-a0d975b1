import { useState } from "react";
import { Lock, PencilLine, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  SCOPE_MODULE_GROUPS,
  SENSITIVE_SCOPE_NOTES,
  integrationErrorMessage,
  scopeLabel,
  titleise,
  useIntegrationScopes,
  useSetScope,
  type IntegrationScopeRow,
} from "@/lib/integrationsQuery";
import {
  WRITE_SCOPE_DESCRIPTIONS,
  grantedWriteResources,
  isActiveWriteScope,
  isReservedWriteScope,
  isWriteScopeName,
} from "@/lib/integrationWriteScopes";
import { IntegrationEmptyState } from "./IntegrationEmptyState";

function groupScopes(rows: IntegrationScopeRow[]) {
  const groups = SCOPE_MODULE_GROUPS.map((g) => ({
    ...g,
    rows: rows.filter((r) => g.modules.includes(r.module)),
  }));
  const claimed = new Set(groups.flatMap((g) => g.rows.map((r) => r.scope)));
  const other = rows.filter((r) => !claimed.has(r.scope));
  if (other.length) groups.push({ id: "other", label: "Other", modules: [], rows: other });
  return groups.filter((g) => g.rows.length > 0);
}


export function IntegrationPermissionsTab({
  clientId,
  canManage,
  disabled,
}: {
  clientId: string;
  canManage: boolean;
  disabled?: boolean;
}) {
  const { rows, isLoading, isError, error, catalogAvailable } =
    useIntegrationScopes(clientId);
  const setScope = useSetScope(clientId);
  const [pendingSensitive, setPendingSensitive] = useState<IntegrationScopeRow | null>(
    null,
  );
  const [pendingWrite, setPendingWrite] = useState<IntegrationScopeRow | null>(null);
  const [busyScope, setBusyScope] = useState<string | null>(null);

  const apply = async (row: IntegrationScopeRow, granted: boolean) => {
    setBusyScope(row.scope);
    try {
      // Never optimistic — local state only follows a confirmed backend result.
      await setScope.mutateAsync({ scope: row.scope, granted });
      toast.success(granted ? "Permission granted" : "Permission removed");
    } catch (err) {
      toast.error(integrationErrorMessage(err));
    } finally {
      setBusyScope(null);
    }
  };

  const onToggle = (row: IntegrationScopeRow, next: boolean) => {
    // Reserved write scopes are never grantable — the backend rejects them too.
    if (isReservedWriteScope(row.scope)) return;
    if (next && isActiveWriteScope(row.scope)) {
      setPendingWrite(row);
      return;
    }
    if (next && row.is_sensitive) {
      setPendingSensitive(row);
      return;
    }
    apply(row, next);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 py-6">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-6">
          <PortalNotice variant="error" description={integrationErrorMessage(error)} />
        </CardContent>
      </Card>
    );
  }

  const grantedCount = rows.filter((r) => r.granted).length;
  const groups = groupScopes(rows);
  const grantedWrites = grantedWriteResources(
    rows.filter((r) => r.granted).map((r) => r.scope),
  );

  return (
    <div className="space-y-4">
      {grantedWrites.length > 0 ? (
        <PortalNotice
          variant="warning"
          title="Write access enabled"
          description={`This integration can create or modify selected VineTrack operational records. Write access: ${grantedWrites.join(", ")}.`}
          compact
        />
      ) : (
        <PortalNotice
          variant="info"
          title="Read-only unless a write permission is granted"
          description="Five VineTrack resources accept controlled external writes. All other write permissions remain reserved and cannot be granted."
          compact
        />
      )}


      {!catalogAvailable && (
        <PortalNotice
          variant="warning"
          compact
          description="The full permission catalogue could not be read with your current access — only permissions returned for this integration are shown."
        />
      )}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <IntegrationEmptyState
              icon={Lock}
              title="No permissions"
              description="This integration has no data permissions."
            />
          </CardContent>
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group.id}>
            <CardHeader>
              <CardTitle className="text-base">{group.label}</CardTitle>
              {group.id === "sensitive" && (
                <p className="text-sm text-muted-foreground">
                  Sensitive permissions unlock approved fields on resources the
                  integration can already read. They never grant resource access on
                  their own.
                </p>
              )}
            </CardHeader>
            <CardContent className="divide-y">
              {group.rows.map((row) => {
                const writeScope = isWriteScopeName(row.scope);
                const activeWrite = isActiveWriteScope(row.scope);
                const reservedWrite = writeScope && !activeWrite;
                return (
                  <div
                    key={row.scope}
                    className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {scopeLabel(row.scope)}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                              {row.scope}
                            </code>
                          </TooltipTrigger>
                          <TooltipContent>
                            Machine scope name used in the API contract
                          </TooltipContent>
                        </Tooltip>
                        {row.is_sensitive && (
                          <Badge
                            variant="outline"
                            className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          >
                            <ShieldAlert className="mr-1 h-3 w-3" />
                            Sensitive access
                          </Badge>
                        )}
                        {activeWrite && (
                          <Badge
                            variant="outline"
                            className="border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                          >
                            <PencilLine className="mr-1 h-3 w-3" />
                            Write access
                          </Badge>
                        )}
                        {reservedWrite && (
                          <Badge variant="outline" className="text-muted-foreground">
                            Not yet available
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {WRITE_SCOPE_DESCRIPTIONS[row.scope] ??
                          SENSITIVE_SCOPE_NOTES[row.scope] ??
                          row.description ??
                          (writeScope
                            ? `No public write endpoint accepts ${row.scope} yet.`
                            : `Read ${titleise(row.module)} data for granted vineyards.`)}
                      </p>
                    </div>
                    <Switch
                      checked={row.granted}
                      disabled={
                        !canManage || reservedWrite || disabled || busyScope === row.scope
                      }
                      aria-label={scopeLabel(row.scope)}
                      onCheckedChange={(next) => onToggle(row, next)}
                    />
                  </div>
                );
              })}

            </CardContent>
          </Card>
        ))
      )}

      <p className="text-xs text-muted-foreground">
        {grantedCount} permission{grantedCount === 1 ? "" : "s"} granted.
      </p>

      <AlertDialog
        open={!!pendingSensitive}
        onOpenChange={(open) => !open && setPendingSensitive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingSensitive
                ? `Grant ${scopeLabel(pendingSensitive.scope).replace(" — Read", "")} access to this integration?`
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This may expose approved commercial or personal fields in resources
              the integration already has permission to read.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                const row = pendingSensitive;
                setPendingSensitive(null);
                if (row) apply(row, true);
              }}
            >
              Grant permission
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
