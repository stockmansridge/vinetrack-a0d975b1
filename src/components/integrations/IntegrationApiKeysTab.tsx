import { useState } from "react";
import { KeyRound, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { ApiKeyStatusBadge } from "./IntegrationStatusBadge";
import { ApiKeySecretDialog } from "./ApiKeySecretDialog";
import { IntegrationEmptyState } from "./IntegrationEmptyState";
import {
  formatDate,
  formatDateTime,
  integrationErrorMessage,
  titleise,
  useCreateApiKey,
  useIntegrationApiKeys,
  useRevokeApiKey,
} from "@/lib/integrationsQuery";

type ExpiryOption = "never" | "30" | "90" | "365" | "custom";

function expiryToIso(option: ExpiryOption, customDate: string): string | null {
  if (option === "never") return null;
  if (option === "custom") return customDate ? new Date(customDate).toISOString() : null;
  const days = Number(option);
  return new Date(Date.now() + days * 86400000).toISOString();
}

export function IntegrationApiKeysTab({
  clientId,
  canManage,
  disabled,
}: {
  clientId: string;
  canManage: boolean;
  disabled?: boolean;
}) {
  const keys = useIntegrationApiKeys(clientId);
  const create = useCreateApiKey(clientId);
  const revoke = useRevokeApiKey(clientId);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("live");
  const [expiry, setExpiry] = useState<ExpiryOption>("never");
  const [customDate, setCustomDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Transient only — never persisted anywhere.
  const [secret, setSecret] = useState<string | null>(null);
  const [secretKeyName, setSecretKeyName] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setEnvironment("live");
    setExpiry("never");
    setCustomDate("");
    setError(null);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("Please enter a key name.");
      return;
    }
    setError(null);
    try {
      const result = await create.mutateAsync({
        name,
        environment,
        expiresAt: expiryToIso(expiry, customDate),
      });
      setCreateOpen(false);
      resetForm();
      if (result.secret) {
        setSecretKeyName(result.key.name ?? name);
        setSecret(result.secret);
      } else {
        toast.success("API key created");
      }
    } catch (err) {
      setError(integrationErrorMessage(err));
    }
  };

  const doRevoke = async () => {
    if (!pendingRevoke) return;
    try {
      await revoke.mutateAsync(pendingRevoke);
      toast.success("API key revoked");
    } catch (err) {
      toast.error(integrationErrorMessage(err));
    } finally {
      setPendingRevoke(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">API keys</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Secrets are shown once at creation and can never be retrieved again.
            </p>
          </div>
          {canManage && !disabled && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create API key
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {keys.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : keys.isError ? (
            <PortalNotice
              variant="error"
              description={integrationErrorMessage(keys.error)}
            />
          ) : (keys.data ?? []).length === 0 ? (
            <IntegrationEmptyState
              icon={KeyRound}
              title="No API keys"
              description="No API keys have been created for this integration."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Environment</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(keys.data ?? []).map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.name ?? "—"}</TableCell>
                      <TableCell>
                        <code className="font-mono text-xs">
                          {k.key_prefix ? `${k.key_prefix}…` : "—"}
                        </code>
                      </TableCell>
                      <TableCell>{titleise(k.environment) || "—"}</TableCell>
                      <TableCell>{formatDate(k.created_at)}</TableCell>
                      <TableCell>
                        {k.expires_at ? formatDate(k.expires_at) : "Never"}
                      </TableCell>
                      <TableCell>{formatDateTime(k.last_used_at)}</TableCell>
                      <TableCell>
                        <ApiKeyStatusBadge
                          revokedAt={k.revoked_at}
                          expiresAt={k.expires_at}
                        />
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          {!k.revoked_at && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setPendingRevoke(k.id)}
                            >
                              Revoke
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          if (!next) resetForm();
          setCreateOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              The secret is displayed once immediately after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Key name</Label>
              <Input
                id="key-name"
                value={name}
                placeholder="Power BI Production"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-env">Environment</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger id="key-env" aria-label="Environment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="live">Live</SelectItem>
                  <SelectItem value="test" disabled>
                    Test — coming later
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-expiry">Expiry</Label>
              <Select
                value={expiry}
                onValueChange={(v) => setExpiry(v as ExpiryOption)}
              >
                <SelectTrigger id="key-expiry" aria-label="Expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="365">1 year</SelectItem>
                  <SelectItem value="custom">Custom date</SelectItem>
                </SelectContent>
              </Select>
              {expiry === "custom" && (
                <Input
                  type="date"
                  aria-label="Custom expiry date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
              )}
            </div>
            {error && <PortalNotice variant="error" description={error} compact />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={create.isPending}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApiKeySecretDialog
        secret={secret}
        keyName={secretKeyName}
        onDismiss={() => {
          setSecret(null);
          setSecretKeyName(null);
        }}
      />

      <AlertDialog
        open={!!pendingRevoke}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
            <AlertDialogDescription>
              Any system using this key will immediately lose API access. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                doRevoke();
              }}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
