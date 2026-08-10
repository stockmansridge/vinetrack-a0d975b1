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
 * One-time API secret display.
 *
 * The plaintext secret lives only in this component's parent transient state.
 * It is never written to localStorage, sessionStorage, IndexedDB, the URL, logs
 * or analytics, and is cleared as soon as the modal is dismissed.
 */
export function ApiKeySecretDialog({
  secret,
  keyName,
  onDismiss,
}: {
  secret: string | null;
  keyName?: string | null;
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
      <Dialog
        open={!!secret}
        onOpenChange={(next) => {
          if (!next) setConfirmClose(true);
        }}
      >
        <DialogContent
          className="sm:max-w-lg"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              API key created
            </DialogTitle>
          </DialogHeader>

          <PortalNotice
            variant="warning"
            title="This key will only be shown once"
            description="Copy it now and store it securely. VineTrack cannot show it again."
          />

          {keyName && (
            <p className="text-sm text-muted-foreground">
              Key name: <span className="font-medium text-foreground">{keyName}</span>
            </p>
          )}

          <div className="rounded-lg border bg-muted/40 p-3">
            <code className="block break-all font-mono text-sm" data-testid="api-key-secret">
              {secret}
            </code>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={copy}>
              {copied ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy key"}
            </Button>
            <Button onClick={dismiss}>I have saved this key</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              Close without saving the key?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The secret cannot be retrieved again. If you close this dialog
              without copying it, you will need to create a new key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep showing key</AlertDialogCancel>
            <AlertDialogAction onClick={dismiss}>Close anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
