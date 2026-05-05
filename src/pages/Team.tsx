import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { supabase } from "@/integrations/ios-supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TeamMember {
  membership_id: string;
  vineyard_id: string;
  user_id: string;
  role: string;
  joined_at: string | null;
  display_name: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

const initials = (name: string | null | undefined, fallback: string) => {
  const src = (name && name.trim()) || fallback;
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
};

export default function Team() {
  const { selectedVineyardId } = useVineyard();

  const { data, isLoading, error } = useQuery<
    { members: TeamMember[]; forbidden: boolean; errorMessage: string | null }
  >({
    queryKey: ["team-rpc", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_vineyard_team_members", {
        p_vineyard_id: selectedVineyardId!,
      });
      if (error) {
        if ((error as any).code === "42501") {
          return { members: [], forbidden: true, errorMessage: null };
        }
        throw error;
      }
      return {
        members: (data ?? []) as TeamMember[],
        forbidden: false,
        errorMessage: null,
      };
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-muted-foreground">Read-only view of vineyard members</p>
      </div>

      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        Production data — read-only view. No edits, archives, or deletions are possible from this page.
      </div>

      {data?.forbidden && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          You don’t have permission to view this vineyard team.
        </div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">Loading…</TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && !data?.forbidden && data?.members.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">No members.</TableCell>
              </TableRow>
            )}
            {data?.members.map((m) => {
              const primary = m.display_name?.trim() || "Unknown member";
              const secondary =
                m.email && m.email.trim() && m.email.trim() !== primary ? m.email.trim() : null;
              return (
                <TableRow key={m.membership_id}>
                  <TableCell title={m.user_id}>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        {m.avatar_url ? <AvatarImage src={m.avatar_url} alt={primary} /> : null}
                        <AvatarFallback>{initials(m.display_name, m.user_id)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{primary}</div>
                        {secondary && (
                          <div className="text-xs text-muted-foreground truncate">{secondary}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{m.role}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(m.joined_at)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
