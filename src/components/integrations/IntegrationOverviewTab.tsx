import { useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { IntegrationStatusBadge } from "./IntegrationStatusBadge";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { grantedWriteResources } from "@/lib/integrationWriteScopes";
import {
  formatDate,
  formatDateTime,
  integrationErrorMessage,
  integrationTypeLabel,
  useSetIntegrationStatus,
  useUpdateIntegration,
  type IntegrationApiKey,
  type IntegrationClient,
  type IntegrationStatusAction,
} from "@/lib/integrationsQuery";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm text-foreground">{value ?? "—"}</div>
    </div>
  );
}

const STATUS_COPY: Record<
  IntegrationStatusAction,
  { title: string; body: string; confirm: string }
> = {
  pause: {
    title: "Pause this integration?",
    body: "Pausing this integration immediately prevents its API keys from accessing VineTrack until it is reactivated.",
    confirm: "Pause integration",
  },
  reactivate: {
    title: "Reactivate this integration?",
    body: "API keys for this integration will be able to access VineTrack again.",
    confirm: "Reactivate integration",
  },
  revoke: {
    title: "Revoke this integration?",
    body: "Revoking this integration permanently disables it and its API access. Revocation is terminal and cannot be undone.",
    confirm: "Revoke permanently",
  },
};

export function IntegrationOverviewTab({
  client,
  canManage,
  vineyardCount,
  scopeCount,
  apiKeys,
  grantedScopes,
}: {
  client: IntegrationClient;
  canManage: boolean;
  vineyardCount: number | null;
  scopeCount: number | null;
  apiKeys: IntegrationApiKey[] | undefined;
  /** Currently granted scope names — the only source for write-access display. */
  grantedScopes?: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(client.name);
  const [description, setDescription] = useState(client.description ?? "");
  const [pendingAction, setPendingAction] = useState<IntegrationStatusAction | null>(
    null,
  );
  const update = useUpdateIntegration(client.id);
  const setStatus = useSetIntegrationStatus(client.id);

  useEffect(() => {
    setName(client.name);
    setDescription(client.description ?? "");
  }, [client.id, client.name, client.description]);

  const activeKeys = apiKeys?.filter((k) => !k.revoked_at).length ?? null;
  const revoked = client.status === "revoked";
  const writeResources = grantedWriteResources(grantedScopes ?? []);

  const save = async () => {
    try {
      await update.mutateAsync({ name, description });
      toast.success("Integration updated");
      setEditing(false);
    } catch (err) {
      toast.error(integrationErrorMessage(err));
    }
  };

  const runStatus = async () => {
    if (!pendingAction) return;
    try {
      await setStatus.mutateAsync(pendingAction);
      toast.success(
        pendingAction === "pause"
          ? "Integration paused"
          : pendingAction === "reactivate"
            ? "Integration reactivated"
            : "Integration revoked",
      );
    } catch (err) {
      toast.error(integrationErrorMessage(err));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Details</CardTitle>
          {canManage && !editing && !revoked && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {editing ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Integration name</Label>
                <Input
                  id="edit-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={save} disabled={update.isPending || !name.trim()}>
                  {update.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save changes
                </Button>
                <Button variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Name" value={client.name} />
              <Field label="Type" value={integrationTypeLabel(client.integration_type)} />
              <Field
                label="Status"
                value={<IntegrationStatusBadge status={client.status} />}
              />
              <Field
                label="Description"
                value={client.description ?? "—"}
              />
              <Field label="Created" value={formatDate(client.created_at)} />
              <Field
                label="Integration ID"
                value={<code className="font-mono text-xs">{client.id}</code>}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Health &amp; access</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Environment" value="Live (read-only API)" />
          <Field
            label="Last API activity"
            value={client.last_request_at ? formatDateTime(client.last_request_at) : "—"}
          />
          <Field
            label="Granted vineyards"
            value={vineyardCount === null ? "—" : vineyardCount}
          />
          <Field label="Granted scopes" value={scopeCount === null ? "—" : scopeCount} />
          <Field label="Active API keys" value={activeKeys === null ? "—" : activeKeys} />
          <Field
            label="Paused"
            value={client.paused_at ? formatDateTime(client.paused_at) : "—"}
          />
          <Field
            label="Revoked"
            value={client.revoked_at ? formatDateTime(client.revoked_at) : "—"}
          />
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integration status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {client.status === "active" && (
              <Button variant="outline" onClick={() => setPendingAction("pause")}>
                Pause integration
              </Button>
            )}
            {client.status === "paused" && (
              <Button variant="outline" onClick={() => setPendingAction("reactivate")}>
                Reactivate integration
              </Button>
            )}
            {!revoked && (
              <Button variant="destructive" onClick={() => setPendingAction("revoke")}>
                Revoke integration
              </Button>
            )}
            {revoked && (
              <p className="text-sm text-muted-foreground">
                This integration has been revoked. Revocation is terminal and it
                cannot be reactivated.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={!!pendingAction}
        onOpenChange={(open) => !open && setPendingAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction ? STATUS_COPY[pendingAction].title : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction ? STATUS_COPY[pendingAction].body : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                runStatus();
              }}
            >
              {pendingAction ? STATUS_COPY[pendingAction].confirm : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
