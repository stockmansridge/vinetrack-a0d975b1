import { useState } from "react";
import { Check, Copy, KeyRound, ShieldAlert } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PortalNotice } from "@/components/ui/PortalNotice";

/**
 * One-time webhook signing secret display.
 *
 * The plaintext secret lives only in the parent component's transient state.
 * It is never written to the React Query cache, localStorage, sessionStorage,
 * IndexedDB, the URL, logs or analytics, and is dropped the moment the modal is
 * dismissed.
 */
export function WebhookSecretDialog({
  secret,
  endpointName,
  rotated = false,
  onDismiss,
}: {
  secret: string | null;
  endpointName?: string | null;
  rotated?: boolean;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const dismiss = () => {
    setConfirmClose(false);
    setCopied(false);
    onDismiss();
  };

  return (
    <>
      <Dialog open={!!secret} onOpenChange={(next) => !next && setConfirmClose(true)}>
        <DialogContent
          className="sm:max-w-lg"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              {rotated ? "Signing secret rotated" : "Webhook endpoint created"}
            </DialogTitle>
          </DialogHeader>

          <PortalNotice
            variant="warning"
            title="This signing secret will only be shown once"
            description="Copy it now and store it securely in your receiving system. VineTrack cannot show it again."
          />

          {endpointName && (
            <p className="text-sm text-muted-foreground">
              Endpoint: <span className="font-medium text-foreground">{endpointName}</span>
            </p>
          )}

          <div className="rounded-lg border bg-muted/40 p-3">
            <code
              className="block break-all font-mono text-sm"
              data-testid="webhook-signing-secret"
            >
              {secret}
            </code>
          </div>

          <p className="text-xs text-muted-foreground">
            Use this secret to verify the <code className="font-mono">X-VineTrack-Signature</code>{" "}
            header on every delivery.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={copy}>
              {copied ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy secret"}
            </Button>
            <Button onClick={dismiss}>I have saved this secret</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              Close without saving the signing secret?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The secret cannot be retrieved again. If you close without copying it,
              you will need to rotate the secret to get a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep showing secret</AlertDialogCancel>
            <AlertDialogAction onClick={dismiss}>Close anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
