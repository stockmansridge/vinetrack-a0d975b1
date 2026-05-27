import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArchiveRestore } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import {
  fetchArchivedVineyardsForOwner,
  restoreVineyard,
  describeVineyardError,
  type ArchivedVineyard,
} from "@/lib/vineyardSettingsQuery";

export function ArchivedVineyardsSection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["archived-vineyards", user?.id],
    enabled: !!user,
    queryFn: () => fetchArchivedVineyardsForOwner(user!.id),
  });

  if (!user) return null;
  if (isLoading) return null;
  if (error) {
    return (
      <div className="mb-6 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Could not load archived vineyards: {describeVineyardError(error)}
      </div>
    );
  }
  if (data.length === 0) return null;

  const handleRestore = async (v: ArchivedVineyard) => {
    if (!user) return;
    if (!confirm(`Restore "${v.name}"? It will reappear in the vineyard list for all members.`)) {
      return;
    }
    setRestoringId(v.id);
    try {
      await restoreVineyard(v.id, user.id);
      toast.success(`"${v.name}" restored`);
      await queryClient.invalidateQueries({ queryKey: ["archived-vineyards"] });
      await queryClient.invalidateQueries({ queryKey: ["memberships"] });
    } catch (e) {
      toast.error(describeVineyardError(e));
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Archived vineyards</h2>
        <p className="text-xs text-muted-foreground">
          Only the owner can restore an archived vineyard.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((v) => (
          <Card key={v.id} className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{v.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-1">
                <Badge variant="outline">Archived</Badge>
                {v.deleted_at && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.deleted_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={restoringId === v.id}
                onClick={() => handleRestore(v)}
              >
                <ArchiveRestore className="h-4 w-4" />
                {restoringId === v.id ? "Restoring…" : "Restore"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
