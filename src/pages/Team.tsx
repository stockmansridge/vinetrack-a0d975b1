import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/ios-supabase/client";
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

interface Member {
  user_id: string;
  role: string;
  joined_at?: string | null;
  display_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  profile_blocked?: boolean;
}

const shortId = (id: string) =>
  id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id;

export default function Team() {
  const { selectedVineyardId } = useVineyard();
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery<{ members: Member[]; profilesBlocked: boolean }>({
    queryKey: ["team", selectedVineyardId, user?.id, user?.email],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      // 1. Try with `display_name` selected. If the column doesn't exist, retry without it.
      let memberRows: any[] = [];
      let { data: m1, error: e1 } = await supabase
        .from("vineyard_members")
        .select("user_id, role, joined_at, display_name")
        .eq("vineyard_id", selectedVineyardId!);
      if (e1) {
        const { data: m2, error: e2 } = await supabase
          .from("vineyard_members")
          .select("user_id, role, joined_at")
          .eq("vineyard_id", selectedVineyardId!);
        if (e2) throw e2;
        memberRows = m2 ?? [];
      } else {
        memberRows = m1 ?? [];
      }

      // 2. Fetch matching profiles (join: profiles.id = vineyard_members.user_id).
      const ids = Array.from(new Set(memberRows.map((m: any) => m.user_id))).filter(Boolean);
      const profilesById = new Map<string, any>();
      let profilesBlocked = false;
      if (ids.length) {
        const { data: profs, error: pe } = await supabase
          .from("profiles")
          .select("id, full_name, email, avatar_url")
          .in("id", ids);
        if (pe) {
          profilesBlocked = true;
          console.warn("[Team] profiles read failed:", pe.message);
        } else {
          for (const p of profs ?? []) profilesById.set(p.id, p);
        }
      }

      const members: Member[] = memberRows.map((m: any) => {
        const p = profilesById.get(m.user_id);
        // Final auth fallback: if this row is the signed-in user, use their auth email.
        const selfEmail = user && m.user_id === user.id ? user.email ?? null : null;
        return {
          user_id: m.user_id,
          role: m.role,
          joined_at: m.joined_at,
          display_name: m.display_name ?? null,
          full_name: p?.full_name ?? null,
          email: p?.email ?? selfEmail ?? null,
          avatar_url: p?.avatar_url ?? null,
          profile_blocked: !p,
        };
      });
      console.info("[Team] diagnostics:", {
        memberCount: memberRows.length,
        profilesFound: profilesById.size,
        profilesBlocked,
        missingProfileUserIds: memberRows
          .filter((m: any) => !profilesById.has(m.user_id))
          .map((m: any) => m.user_id),
      });
      return { members, profilesBlocked };
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-muted-foreground">Read-only view of vineyard members</p>
      </div>
      {data?.profilesBlocked && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Some profile details are unavailable (restricted or missing). Showing best available identity.
        </div>
      )}
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
            {!isLoading && data?.members.length === 0 && (
              <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No members.</TableCell></TableRow>
            )}
            {data?.members.map((m) => {
              // Display priority:
              // 1. vineyard_members.display_name
              // 2. profiles.full_name
              // 3. profiles.email (or auth email if it's the signed-in user)
              // 4. shortened user_id with "Profile/email unavailable"
              const primary =
                m.display_name?.trim() ||
                m.full_name?.trim() ||
                m.email?.trim() ||
                shortId(m.user_id);
              const hasName = !!(m.display_name?.trim() || m.full_name?.trim());
              const usingIdFallback =
                !m.display_name?.trim() && !m.full_name?.trim() && !m.email?.trim();
              const secondary = hasName && m.email ? m.email : null;
              return (
                <TableRow key={m.user_id}>
                  <TableCell title={m.user_id}>
                    <div className="font-medium">{primary}</div>
                    {secondary && (
                      <div className="text-xs text-muted-foreground">{secondary}</div>
                    )}
                    {usingIdFallback && (
                      <div className="text-xs text-muted-foreground">Profile/email unavailable</div>
                    )}
                  </TableCell>
                  <TableCell><Badge variant="secondary">{m.role}</Badge></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
