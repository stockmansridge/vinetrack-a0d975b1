import { useMemo, useState } from "react";
import { Plus, Trash2, Bell, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { IntegrationEmptyState } from "./IntegrationEmptyState";
import { useToast } from "@/hooks/use-toast";
import {
  groupedWebhookEvents,
  integrationErrorMessage,
  useCreateWebhookSubscription,
  useDeleteWebhookSubscription,
  useIntegrationScopes,
  useIntegrationVineyards,
  useWebhookSubscriptions,
  webhookEventLabel,
  webhookEventScope,
  type WebhookSubscription,
} from "@/lib/integrationsQuery";

export function WebhookSubscriptionsPanel({
  clientId,
  endpointId,
  canManage,
  disabled,
}: {
  clientId: string;
  endpointId: string;
  canManage: boolean;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const subs = useWebhookSubscriptions(clientId, endpointId);
  const vineyards = useIntegrationVineyards(clientId);
  const scopes = useIntegrationScopes(clientId);
  const createSub = useCreateWebhookSubscription(clientId, endpointId);
  const deleteSub = useDeleteWebhookSubscription(clientId, endpointId);

  const [eventType, setEventType] = useState("");
  const [vineyardId, setVineyardId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<WebhookSubscription | null>(null);

  const grantedScopes = useMemo(
    () => new Set(scopes.rows.filter((s) => s.granted).map((s) => s.scope)),
    [scopes.rows],
  );
  const grantedVineyards = useMemo(
    () => (vineyards.data ?? []).filter((v) => !v.revoked_at),
    [vineyards.data],
  );

  const requiredScope = eventType ? webhookEventScope(eventType) : null;
  const scopeMissing = !!requiredScope && !grantedScopes.has(requiredScope);

  const add = async () => {
    if (!eventType || !vineyardId) return;
    try {
      await createSub.mutateAsync({ eventType, vineyardId });
      toast({ title: "Subscription added" });
      setEventType("");
      setVineyardId("");
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not add subscription",
        description: integrationErrorMessage(e),
      });
    }
  };

  const remove = async (sub: WebhookSubscription) => {
    try {
      await deleteSub.mutateAsync(sub.id);
      toast({ title: "Subscription removed" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not remove subscription",
        description: integrationErrorMessage(e),
      });
    } finally {
      setConfirmDelete(null);
    }
  };

  const rows = subs.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Event subscriptions</h3>
        <p className="text-sm text-muted-foreground">
          Each subscription sends one event type for one vineyard. Only vineyards
          granted to this integration can be subscribed.
        </p>
      </div>

      {canManage && (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="webhook-event">Event</Label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger id="webhook-event">
                  <SelectValue placeholder="Select an event" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {groupedWebhookEvents().map((group) => (
                    <SelectGroup key={group.group}>
                      <SelectLabel>{group.group}</SelectLabel>
                      {group.events.map((e) => (
                        <SelectItem key={e.event} value={e.event}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="webhook-vineyard">Vineyard</Label>
              <Select value={vineyardId} onValueChange={setVineyardId}>
                <SelectTrigger id="webhook-vineyard">
                  <SelectValue placeholder="Select a vineyard" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {grantedVineyards.map((v) => (
                    <SelectItem key={v.vineyard_id} value={v.vineyard_id}>
                      {v.vineyard_name ?? v.vineyard_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {grantedVineyards.length === 0 && (
            <PortalNotice
              variant="info"
              compact
              description="Grant this integration access to at least one vineyard before adding subscriptions."
            />
          )}

          {scopeMissing && (
            <PortalNotice
              variant="warning"
              compact
              title="Permission required"
              description={`This event requires the ${requiredScope} permission, which is not granted to this integration. Events will not be delivered until it is granted.`}
            />
          )}

          <Button
            size="sm"
            onClick={add}
            disabled={
              !!disabled ||
              !eventType ||
              !vineyardId ||
              createSub.isPending ||
              grantedVineyards.length === 0
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Add subscription
          </Button>
        </div>
      )}

      {subs.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : subs.isError ? (
        <PortalNotice variant="error" description="Subscriptions could not be loaded." />
      ) : rows.length === 0 ? (
        <IntegrationEmptyState
          icon={Bell}
          title="No subscriptions yet"
          description="This endpoint will not receive any events until at least one event and vineyard are subscribed."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Vineyard</TableHead>
                <TableHead>Permission</TableHead>
                {canManage && <TableHead className="w-16" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((sub) => {
                const scope = webhookEventScope(sub.event_type);
                const missing = !!scope && !grantedScopes.has(scope);
                return (
                  <TableRow key={sub.id}>
                    <TableCell>
                      <div className="font-medium">{webhookEventLabel(sub.event_type)}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {sub.event_type}
                      </div>
                    </TableCell>
                    <TableCell>{sub.vineyard_name ?? sub.vineyard_id ?? "—"}</TableCell>
                    <TableCell>
                      {scope ? (
                        missing ? (
                          <Badge
                            variant="outline"
                            className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          >
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            {scope} not granted
                          </Badge>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {scope}
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove subscription"
                          disabled={!!disabled}
                          onClick={() => setConfirmDelete(sub)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete
                ? `${webhookEventLabel(confirmDelete.event_type)} events will stop being sent for ${confirmDelete.vineyard_name ?? "this vineyard"}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && remove(confirmDelete)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
