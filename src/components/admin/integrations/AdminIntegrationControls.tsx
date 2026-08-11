// Stage 7B — high-impact platform-admin controls. Every action is confirmed
// and wired to the Stage 7A RPCs only. There is intentionally no delete action.
import { useState, type ReactNode } from "react";
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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  integrationErrorMessage,
  useAdminReactivateIntegration,
  useAdminRevokeApiKey,
  useAdminSetEndpointStatus,
  useAdminSuspendIntegration,
} from "@/lib/adminIntegrationsQuery";

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  reason,
  onReasonChange,
  reasonLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  reason?: string;
  onReasonChange?: (v: string) => void;
  reasonLabel?: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {onReasonChange && (
          <div className="space-y-1">
            <Label htmlFor="admin-action-reason">{reasonLabel ?? "Reason"}</Label>
            <Textarea
              id="admin-action-reason"
              value={reason ?? ""}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Recorded in the integration audit history"
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className={destructive ? "bg-destructive text-destructive-foreground" : undefined}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SuspendIntegrationButton({
  clientId,
  disabled,
}: {
  clientId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const suspend = useAdminSuspendIntegration();
  return (
    <>
      <Button variant="destructive" disabled={disabled} onClick={() => setOpen(true)}>
        Suspend integration
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Suspend this integration?"
        description="API authentication will stop and webhook deliveries will be deferred. Existing configuration will be retained and the integration can be reactivated."
        confirmLabel="Suspend"
        destructive
        reason={reason}
        onReasonChange={setReason}
        pending={suspend.isPending}
        onConfirm={() =>
          suspend.mutate(
            { clientId, reason },
            {
              onSuccess: () => {
                toast({ title: "Integration suspended" });
                setOpen(false);
                setReason("");
              },
              onError: (e) =>
                toast({
                  title: "Could not suspend integration",
                  description: integrationErrorMessage(e),
                  variant: "destructive",
                }),
            },
          )
        }
      />
    </>
  );
}

export function ReactivateIntegrationButton({
  clientId,
  disabled,
}: {
  clientId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const reactivate = useAdminReactivateIntegration();
  return (
    <>
      <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        Reactivate integration
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reactivate this integration?"
        description="API access and webhook processing can resume according to the integration's normal permissions."
        confirmLabel="Reactivate"
        pending={reactivate.isPending}
        onConfirm={() =>
          reactivate.mutate(
            { clientId },
            {
              onSuccess: () => {
                toast({ title: "Integration reactivated" });
                setOpen(false);
              },
              onError: (e) =>
                toast({
                  title: "Could not reactivate integration",
                  description: integrationErrorMessage(e),
                  variant: "destructive",
                }),
            },
          )
        }
      />
    </>
  );
}

export function RevokeApiKeyButton({
  apiKeyId,
  keyLabel,
  clientId,
  disabled,
}: {
  apiKeyId: string;
  keyLabel: string;
  clientId?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const revoke = useAdminRevokeApiKey();
  return (
    <>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        Revoke
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Revoke API key ${keyLabel}?`}
        description="This API key will stop working immediately. The key value cannot be recovered."
        confirmLabel="Revoke key"
        destructive
        reason={reason}
        onReasonChange={setReason}
        pending={revoke.isPending}
        onConfirm={() =>
          revoke.mutate(
            { apiKeyId, reason, clientId },
            {
              onSuccess: () => {
                toast({ title: "API key revoked" });
                setOpen(false);
                setReason("");
              },
              onError: (e) =>
                toast({
                  title: "Could not revoke API key",
                  description: integrationErrorMessage(e),
                  variant: "destructive",
                }),
            },
          )
        }
      />
    </>
  );
}

export function EndpointStatusButton({
  endpointId,
  endpointLabel,
  status,
  clientId,
}: {
  endpointId: string;
  endpointLabel: string;
  status: string | null;
  clientId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const set = useAdminSetEndpointStatus();
  const disabling = (status ?? "active") === "active";
  const nextStatus = disabling ? "disabled" : "active";
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {disabling ? "Disable" : "Re-enable"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={
          disabling
            ? `Disable webhook endpoint ${endpointLabel}?`
            : `Re-enable webhook endpoint ${endpointLabel}?`
        }
        description={
          disabling
            ? "New deliveries to this endpoint will stop while it is disabled. The endpoint and its subscriptions are retained."
            : "Deliveries to this endpoint can resume according to its subscriptions."
        }
        confirmLabel={disabling ? "Disable endpoint" : "Re-enable endpoint"}
        destructive={disabling}
        reason={reason}
        onReasonChange={setReason}
        pending={set.isPending}
        onConfirm={() =>
          set.mutate(
            { endpointId, status: nextStatus, reason, clientId },
            {
              onSuccess: () => {
                toast({ title: disabling ? "Endpoint disabled" : "Endpoint re-enabled" });
                setOpen(false);
                setReason("");
              },
              onError: (e) =>
                toast({
                  title: "Could not update endpoint",
                  description: integrationErrorMessage(e),
                  variant: "destructive",
                }),
            },
          )
        }
      />
    </>
  );
}
