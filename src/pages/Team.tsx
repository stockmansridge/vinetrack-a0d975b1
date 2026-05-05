import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function Team() {
  const { selectedVineyardId } = useVineyard();

  const { data, isLoading, error } = useQuery({
    queryKey: ["team", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vineyard_members")
        .select("user_id, role, joined_at, profiles!vineyard_members_user_id_fkey(full_name, email, avatar_url)")
        .eq("vineyard_id", selectedVineyardId!);
      if (error) {
        // fall back without join if profiles isn't reachable under RLS
        const { data: d2, error: e2 } = await supabase
          .from("vineyard_members")
          .select("user_id, role, joined_at")
          .eq("vineyard_id", selectedVineyardId!);
        if (e2) throw e2;
        return d2 ?? [];
      }
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-muted-foreground">Read-only view of vineyard members</p>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={2} className="text-center text-destructive">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && data?.length === 0 && (
              <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No members.</TableCell></TableRow>
            )}
            {data?.map((m: any) => (
              <TableRow key={m.user_id}>
                <TableCell>
                  <div className="font-medium">{m.profiles?.full_name ?? m.profiles?.email ?? m.user_id}</div>
                  {m.profiles?.email && m.profiles?.full_name && (
                    <div className="text-xs text-muted-foreground">{m.profiles.email}</div>
                  )}
                </TableCell>
                <TableCell><Badge variant="secondary">{m.role}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
