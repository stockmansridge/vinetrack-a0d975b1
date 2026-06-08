// Archived paddocks list — visible to owners/managers only.
// Shows soft-deleted (deleted_at IS NOT NULL) paddocks for the current
// vineyard with a Restore action. Hidden when empty so it doesn't clutter
// the page for vineyards that haven't archived anything.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { restorePaddock } from "@/lib/paddockMutations";
import { refreshPaddockQueries } from "@/lib/paddockQueryInvalidation";
import { useRegionFormatters } from "@/lib/useRegionFormatters";

interface ArchivedRow {
  id: string;
  name: string | null;
  deleted_at: string | null;
  updated_at: string | null;
}

async function fetchArchivedPaddocks(vineyardId: string): Promise<ArchivedRow[]> {
  const { data, error } = await (supabase as any)
    .from("paddocks")
    .select("id,name,deleted_at,updated_at")
    .eq("vineyard_id", vineyardId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ArchivedRow[];
}

export default function ArchivedPaddocksSection() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["paddocks-archived", selectedVineyardId],
    enabled: !!selectedVineyardId && canEdit,
    queryFn: () => fetchArchivedPaddocks(selectedVineyardId!),
  });

  if (!canEdit || isLoading || data.length === 0) return null;

  const handleRestore = async (row: ArchivedRow) => {
    setRestoringId(row.id);
    try {
      await restorePaddock(row.id);
      toast({ title: "Paddock restored", description: row.name ?? row.id });
      await refreshPaddockQueries(qc, selectedVineyardId);
    } catch (err: any) {
      toast({ title: "Restore failed", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Card className="border-muted">
      <CardHeader className="py-3 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Archive className="h-4 w-4" />
          Archived paddocks ({data.length})
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Archived</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.deleted_at ? formatDate(row.deleted_at) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => handleRestore(row)}
                      disabled={restoringId === row.id}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {restoringId === row.id ? "Restoring…" : "Restore"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}
