import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { supabase } from "@/integrations/ios-supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useCanSeeCosts } from "@/lib/permissions";
import { fetchOperatorCategoriesForVineyard } from "@/lib/operatorCategoriesQuery";
import {
  fetchVineyardMembersWithCategory,
  updateMemberOperatorCategory,
  describeMemberWriteError,
} from "@/lib/teamMembersQuery";
import { useToast } from "@/hooks/use-toast";

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

const NONE = "__none__";

const initials = (name: string | null | undefined, fallback: string) => {
  const src = (name && name.trim()) || fallback;
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
};

export default function Team() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const canSeeCosts = useCanSeeCosts();
  const qc = useQueryClient();
  const { toast } = useToast();

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
      return { members: (data ?? []) as TeamMember[], forbidden: false, errorMessage: null };
    },
  });

  // Direct vineyard_members read so we can surface operator_category_id
  // (the get_vineyard_team_members RPC does not expose it).
  const { data: memberRows } = useQuery({
    queryKey: ["vineyard-members-rows", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVineyardMembersWithCategory(selectedVineyardId!),
  });

  const { data: categoriesRes } = useQuery({
    queryKey: ["operator-categories", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchOperatorCategoriesForVineyard(selectedVineyardId!),
  });
  const categories = categoriesRes?.categories ?? [];

  const categoryByMembership = useMemo(() => {
    const m = new Map<string, string | null>();
    (memberRows ?? []).forEach((r) => m.set(r.id, r.operator_category_id ?? null));
    return m;
  }, [memberRows]);

  const membershipIdByUserId = useMemo(() => {
    const m = new Map<string, string>();
    (memberRows ?? []).forEach((r) => m.set(r.user_id, r.id));
    return m;
  }, [memberRows]);

  const setCategory = useMutation({
    mutationFn: async ({ membershipId, categoryId }: { membershipId: string; categoryId: string | null }) => {
      await updateMemberOperatorCategory(membershipId, categoryId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vineyard-members-rows", selectedVineyardId] });
      toast({ title: "Operator category updated" });
    },
    onError: (e) => {
      toast({ title: "Couldn't update category", description: describeMemberWriteError(e), variant: "destructive" });
    },
  });

  const colCount = 4;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-muted-foreground">
          Vineyard members and their default operator category for trip costing.
        </p>
      </div>

      {!canEdit && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Read-only — only owners and managers can change operator category assignments.
        </div>
      )}

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
              <TableHead>Operator category</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={colCount} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={colCount} className="text-center text-destructive">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && !data?.forbidden && data?.members.length === 0 && (
              <TableRow><TableCell colSpan={colCount} className="text-center text-muted-foreground">No members.</TableCell></TableRow>
            )}
            {data?.members.map((m) => {
              const primary = m.display_name?.trim() || "Unknown member";
              const secondary = m.email && m.email.trim() && m.email.trim() !== primary ? m.email.trim() : null;
              const membershipId = membershipIdByUserId.get(m.user_id) ?? null;
              const currentCatId = membershipId ? categoryByMembership.get(membershipId) ?? null : null;
              const currentCat = currentCatId ? categories.find((c) => c.id === currentCatId) : null;
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
                        {secondary && (<div className="text-xs text-muted-foreground truncate">{secondary}</div>)}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{m.role}</Badge></TableCell>
                  <TableCell>
                    {canEdit && membershipId ? (
                      <Select
                        value={currentCatId ?? NONE}
                        onValueChange={(v) =>
                          setCategory.mutate({ membershipId, categoryId: v === NONE ? null : v })
                        }
                        disabled={setCategory.isPending}
                      >
                        <SelectTrigger className="w-56">
                          <SelectValue placeholder="No category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>No category</SelectItem>
                          {categories.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name ?? "Unnamed"}
                              {canSeeCosts && c.cost_per_hour != null
                                ? ` — $${Number(c.cost_per_hour).toFixed(2)}/h`
                                : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm">{currentCat?.name ?? "—"}</span>
                    )}
                  </TableCell>
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
