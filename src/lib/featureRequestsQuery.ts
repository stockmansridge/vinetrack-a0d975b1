// Feature request board — shared VineTrack suggestion list with one upvote
// per signed-in user.
//
// Data lives in the canonical VineTrack database (public.feature_requests +
// public.feature_request_votes, see sql/245_feature_requests.sql). RLS is the
// authority: everyone signed in may read visible requests, create requests and
// vote once; System Admin curates status and hides duplicates.
//
// Until SQL 245 is applied the queries return `backendPending: true` and the
// page explains the board is not switched on yet rather than erroring.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";

export const FEATURE_REQUEST_STATUSES = [
  "open",
  "planned",
  "in_progress",
  "done",
  "declined",
] as const;

export type FeatureRequestStatus = (typeof FEATURE_REQUEST_STATUSES)[number];

export const FEATURE_REQUEST_STATUS_LABEL: Record<FeatureRequestStatus, string> = {
  open: "Open",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  declined: "Not planned",
};

export interface FeatureRequestRow {
  id: string;
  title: string;
  details: string | null;
  status: string;
  is_hidden: boolean;
  created_by: string | null;
  created_by_name: string | null;
  admin_note: string | null;
  created_at: string;
}

export interface FeatureRequestVoteRow {
  feature_request_id: string;
  user_id: string;
}

export interface FeatureRequest extends FeatureRequestRow {
  votes: number;
  hasVoted: boolean;
}

/** Missing table / unknown relation — SQL 245 not applied yet. */
export function isBackendPendingError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table")
  );
}

/** Pure: attach vote counts + the viewer's own vote, highest voted first. */
export function decorateFeatureRequests(
  rows: FeatureRequestRow[],
  votes: FeatureRequestVoteRow[],
  userId: string | null,
): FeatureRequest[] {
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  for (const v of votes) {
    counts.set(v.feature_request_id, (counts.get(v.feature_request_id) ?? 0) + 1);
    if (userId && v.user_id === userId) mine.add(v.feature_request_id);
  }
  return rows
    .map((r) => ({
      ...r,
      votes: counts.get(r.id) ?? 0,
      hasVoted: mine.has(r.id),
    }))
    .sort((a, b) => {
      if (b.votes !== a.votes) return b.votes - a.votes;
      return b.created_at.localeCompare(a.created_at);
    });
}

/** Pure: search over title, details and author name. */
export function filterFeatureRequests(
  list: FeatureRequest[],
  search: string,
  status: string,
): FeatureRequest[] {
  const q = search.trim().toLowerCase();
  return list.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (!q) return true;
    return [r.title, r.details ?? "", r.created_by_name ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}

const QK = ["feature-requests"] as const;

export interface FeatureRequestsResult {
  requests: FeatureRequest[];
  backendPending: boolean;
}

export function useFeatureRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QK, user?.id ?? null],
    enabled: !!user,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<FeatureRequestsResult> => {
      const [reqRes, voteRes] = await Promise.all([
        (iosSupabase as any)
          .from("feature_requests")
          .select(
            "id,title,details,status,is_hidden,created_by,created_by_name,admin_note,created_at",
          )
          .order("created_at", { ascending: false })
          .limit(500),
        (iosSupabase as any)
          .from("feature_request_votes")
          .select("feature_request_id,user_id")
          .limit(20000),
      ]);
      if (reqRes.error) {
        if (isBackendPendingError(reqRes.error)) {
          return { requests: [], backendPending: true };
        }
        throw reqRes.error;
      }
      if (voteRes.error && !isBackendPendingError(voteRes.error)) throw voteRes.error;
      return {
        requests: decorateFeatureRequests(
          (reqRes.data ?? []) as FeatureRequestRow[],
          (voteRes.data ?? []) as FeatureRequestVoteRow[],
          user?.id ?? null,
        ),
        backendPending: false,
      };
    },
  });
}

export function useCreateFeatureRequest() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: {
      title: string;
      details: string;
      createdByName: string | null;
      vineyardId: string | null;
    }) => {
      const { data, error } = await (iosSupabase as any)
        .from("feature_requests")
        .insert({
          title: args.title.trim(),
          details: args.details.trim() || null,
          created_by: user?.id ?? null,
          created_by_name: args.createdByName,
          vineyard_id: args.vineyardId,
        })
        .select("id")
        .single();
      if (error) throw error;
      // Creating a request counts as backing it.
      if (data?.id && user?.id) {
        await (iosSupabase as any)
          .from("feature_request_votes")
          .insert({ feature_request_id: data.id, user_id: user.id });
      }
      return data?.id as string | undefined;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useToggleFeatureVote() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: { id: string; hasVoted: boolean }) => {
      if (!user?.id) throw new Error("Sign in to vote");
      if (args.hasVoted) {
        const { error } = await (iosSupabase as any)
          .from("feature_request_votes")
          .delete()
          .eq("feature_request_id", args.id)
          .eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await (iosSupabase as any)
          .from("feature_request_votes")
          .insert({ feature_request_id: args.id, user_id: user.id });
        // Duplicate vote (double click) is not an error worth surfacing.
        if (error && error.code !== "23505") throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

/** System Admin curation: status, hidden, admin note. Authors may fix wording. */
export function useUpdateFeatureRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      status?: FeatureRequestStatus;
      is_hidden?: boolean;
      title?: string;
      details?: string | null;
      admin_note?: string | null;
    }) => {
      const { id, ...patch } = args;
      const { error } = await (iosSupabase as any)
        .from("feature_requests")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}
