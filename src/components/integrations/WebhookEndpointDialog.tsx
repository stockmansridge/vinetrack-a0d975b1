import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { useToast } from "@/hooks/use-toast";
import {
  integrationErrorMessage,
  isValidWebhookUrl,
  useCreateWebhookEndpoint,
  useUpdateWebhookEndpoint,
  type WebhookEndpoint,
} from "@/lib/integrationsQuery";

export function WebhookEndpointDialog({
  clientId,
  open,
  endpoint,
  onOpenChange,
  onCreated,
}: {
  clientId: string;
  open: boolean;
  endpoint?: WebhookEndpoint | null;
  onOpenChange: (open: boolean) => void;
  /** Receives the one-time plaintext signing secret. Transient — never stored. */
  onCreated?: (secret: string | null, endpoint: WebhookEndpoint) => void;
}) {
  const editing = !!endpoint;
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useCreateWebhookEndpoint(clientId);
  const update = useUpdateWebhookEndpoint(clientId);
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setName(endpoint?.name ?? "");
    setUrl(endpoint?.url ?? "");
    setError(null);
  }, [open, endpoint]);

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      setError("Enter an endpoint name between 2 and 100 characters.");
      return;
    }
    if (!isValidWebhookUrl(trimmedUrl)) {
      setError("Enter a valid HTTPS URL, for example https://example.com/vinetrack.");
      return;
    }
    setError(null);
    try {
      if (editing && endpoint) {
        await update.mutateAsync({
          endpointId: endpoint.id,
          name: trimmedName,
          url: trimmedUrl,
        });
        toast({ title: "Endpoint updated" });
        onOpenChange(false);
      } else {
        const result = await create.mutateAsync({ name: trimmedName, url: trimmedUrl });
        onOpenChange(false);
        onCreated?.(result.secret, result.endpoint);
      }
    } catch (e) {
      setError(integrationErrorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit webhook endpoint" : "Add webhook endpoint"}</DialogTitle>
          <DialogDescription>
            VineTrack will POST signed JSON events to this HTTPS URL.
          </DialogDescription>
        </DialogHeader>

        {error && <PortalNotice variant="error" description={error} />}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-name">Endpoint name</Label>
            <Input
              id="webhook-name"
              value={name}
              maxLength={100}
              placeholder="Production receiver"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="webhook-url">Destination URL</Label>
            <Input
              id="webhook-url"
              value={url}
              maxLength={2000}
              placeholder="https://example.com/hooks/vinetrack"
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              HTTPS is required. Your endpoint must respond with a 2xx status within
              the delivery timeout.
            </p>
          </div>
          {editing && (
            <PortalNotice
              variant="info"
              compact
              description="Changing the URL does not rotate the signing secret."
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {editing ? "Save changes" : "Create endpoint"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
