// Discussion thread on a single feature request so the required functionality
// can be clarified before it is built. Read by everyone signed in; each person
// can remove their own comment (System Admin can remove any).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCurrentProfile, displayNameFor } from "@/hooks/useCurrentProfile";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import {
  useAddFeatureRequestComment,
  useDeleteFeatureRequestComment,
  useFeatureRequestComments,
} from "@/lib/featureRequestsQuery";

export function FeatureRequestComments({ requestId }: { requestId: string }) {
  const { data, isLoading } = useFeatureRequestComments(requestId);
  const { user } = useAuth();
  const { profile } = useCurrentProfile();
  const { isAdmin } = useIsSystemAdmin();
  const add = useAddFeatureRequestComment();
  const remove = useDeleteFeatureRequestComment();
  const [body, setBody] = useState("");

  const submit = async () => {
    try {
      await add.mutateAsync({
        requestId,
        body,
        createdByName: displayNameFor(profile, user?.email) ?? null,
      });
      setBody("");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not add your comment");
    }
  };

  const comments = data?.comments ?? [];

  return (
    <div className="mt-3 space-y-3 rounded-lg border bg-muted/30 p-3">
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading comments…
        </div>
      ) : data?.backendPending ? (
        <p className="text-xs text-muted-foreground">
          Comments aren’t switched on yet.
        </p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No comments yet — add the detail that would make this work for you.
        </p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md bg-background px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="whitespace-pre-wrap">{c.body}</p>
                {(isAdmin || (user?.id && c.created_by === user.id)) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground"
                    aria-label="Delete comment"
                    onClick={() =>
                      remove.mutate(
                        { id: c.id, requestId },
                        { onError: (e: any) => toast.error(e?.message ?? "Could not delete") },
                      )
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {c.created_by_name ?? "VineTrack user"} ·{" "}
                {new Date(c.created_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}

      {!data?.backendPending && (
        <div className="space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment — what exactly would this need to do?"
            rows={3}
            maxLength={4000}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={add.isPending || !body.trim()}>
              {add.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Comment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
