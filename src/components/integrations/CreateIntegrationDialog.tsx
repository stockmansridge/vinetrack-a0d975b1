import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  integrationErrorMessage,
  useCreateIntegration,
} from "@/lib/integrationsQuery";

export function CreateIntegrationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("custom_api");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateIntegration();

  const reset = () => {
    setName("");
    setType("custom_api");
    setDescription("");
    setError(null);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("Please enter an integration name.");
      return;
    }
    setError(null);
    try {
      const client = await create.mutateAsync({
        name,
        integrationType: type,
        description,
      });
      toast.success("Integration created");
      onOpenChange(false);
      reset();
      if (client?.id) onCreated?.(client.id);
    } catch (err) {
      setError(integrationErrorMessage(err));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create integration</DialogTitle>
          <DialogDescription>
            Give the external system a name so its API access can be managed and
            audited separately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="integration-name">Integration name</Label>
            <Input
              id="integration-name"
              value={name}
              placeholder="Winery ERP"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="integration-type">Integration type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="integration-type" aria-label="Integration type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom_api">Custom API</SelectItem>
                <SelectItem value="custom_webhook">Custom Webhook</SelectItem>
                <SelectItem value="managed_integration">
                  Managed Integration
                </SelectItem>
              </SelectContent>
            </Select>
            {type === "custom_webhook" && (
              <p className="text-xs text-muted-foreground">
                Webhook configuration and delivery are not yet active. The
                integration can be created now and configured in a later stage.
              </p>
            )}
            {type === "managed_integration" && (
              <p className="text-xs text-muted-foreground">
                Managed connectors are a future capability. No managed connector
                is active yet.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="integration-description">Description (optional)</Label>
            <Textarea
              id="integration-description"
              value={description}
              rows={3}
              placeholder="What this integration is used for"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && <PortalNotice variant="error" description={error} compact />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create integration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
