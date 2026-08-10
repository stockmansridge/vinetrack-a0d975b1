import { useState } from "react";
import { Loader2, Plus, Trash2, Grape } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { useVineyard } from "@/context/VineyardContext";
import {
  formatDate,
  integrationErrorMessage,
  useGrantVineyard,
  useIntegrationVineyards,
  useRevokeVineyard,
} from "@/lib/integrationsQuery";
import { IntegrationEmptyState } from "./IntegrationEmptyState";

export function IntegrationVineyardsTab({
  clientId,
  canManage,
}: {
  clientId: string;
  canManage: boolean;
}) {
  const grants = useIntegrationVineyards(clientId);
  const { memberships } = useVineyard();
  const grant = useGrantVineyard(clientId);
  const revoke = useRevokeVineyard(clientId);
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [pendingRemove, setPendingRemove] = useState<{
    id: string;
    name: string | null;
  } | null>(null);

  const granted = new Set((grants.data ?? []).map((g) => g.vineyard_id));
  // Only vineyards the signed-in user owns can be offered. The backend RPC is
  // still the authority and will reject anything it does not permit.
  const grantable = memberships.filter(
    (m) => m.role === "owner" && !granted.has(m.vineyard_id),
  );

  const doGrant = async () => {
    if (!selected) return;
    try {
      await grant.mutateAsync(selected);
      toast.success("Vineyard granted");
      setAddOpen(false);
      setSelected("");
    } catch (err) {
      toast.error(integrationErrorMessage(err));
    }
  };

  const doRevoke = async () => {
    if (!pendingRemove) return;
    try {
      await revoke.mutateAsync(pendingRemove.id);
      toast.success("Vineyard access removed");
    } catch (err) {
      toast.error(integrationErrorMessage(err));
    } finally {
      setPendingRemove(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Vineyard access</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            This integration can only read data for the vineyards granted below.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add vineyard
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {grants.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : grants.isError ? (
          <p className="text-sm text-destructive">
            {integrationErrorMessage(grants.error)}
          </p>
        ) : (grants.data ?? []).length === 0 ? (
          <IntegrationEmptyState
            icon={Grape}
            title="No vineyard access"
            description="This integration cannot access vineyard data until a vineyard is granted."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vineyard</TableHead>
                  <TableHead>Granted</TableHead>
                  <TableHead>Granted by</TableHead>
                  {canManage && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(grants.data ?? []).map((g) => (
                  <TableRow key={g.vineyard_id}>
                    <TableCell>
                      <div className="font-medium">{g.vineyard_name ?? "Vineyard"}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {g.vineyard_id}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(g.granted_at)}</TableCell>
                    <TableCell>{g.granted_by_name ?? "—"}</TableCell>
                    {canManage && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${g.vineyard_name ?? "vineyard"}`}
                          onClick={() =>
                            setPendingRemove({
                              id: g.vineyard_id,
                              name: g.vineyard_name,
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add vineyard</DialogTitle>
            <DialogDescription>
              Grant this integration read access to a vineyard you own.
            </DialogDescription>
          </DialogHeader>
          {grantable.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              There are no further vineyards available for you to grant.
            </p>
          ) : (
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger aria-label="Vineyard">
                <SelectValue placeholder="Select a vineyard" />
              </SelectTrigger>
              <SelectContent>
                {grantable.map((m) => (
                  <SelectItem key={m.vineyard_id} value={m.vineyard_id}>
                    {m.vineyard_name ?? m.vineyard_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doGrant} disabled={!selected || grant.isPending}>
              {grant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Grant access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!pendingRemove}
        onOpenChange={(open) => !open && setPendingRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove vineyard access?</AlertDialogTitle>
            <AlertDialogDescription>
              This integration will immediately lose access to all API data for
              this vineyard.
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
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
