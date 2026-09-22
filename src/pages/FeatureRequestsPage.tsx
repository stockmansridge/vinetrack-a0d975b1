// Feature request board: anyone signed in can suggest an improvement and
// upvote the ideas that matter most to them. System Admin curates status.

import { useMemo, useState } from "react";
import { PageHead } from "@/components/PageHead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
import { toast } from "sonner";
import { ChevronUp, EyeOff, Loader2, Lightbulb, MessageSquare, Plus, RefreshCw } from "lucide-react";
import { FeatureRequestComments } from "@/components/feature/FeatureRequestComments";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { useCurrentProfile, displayNameFor } from "@/hooks/useCurrentProfile";
import {
  FEATURE_REQUEST_STATUSES,
  FEATURE_REQUEST_STATUS_LABEL,
  filterFeatureRequests,
  useCreateFeatureRequest,
  useFeatureRequests,
  useToggleFeatureVote,
  useUpdateFeatureRequest,
  type FeatureRequest,
  type FeatureRequestStatus,
} from "@/lib/featureRequestsQuery";

function StatusBadge({ status }: { status: string }) {
  const label =
    FEATURE_REQUEST_STATUS_LABEL[status as FeatureRequestStatus] ?? status;
  const variant =
    status === "done" ? "default" : status === "declined" ? "outline" : "secondary";
  return (
    <Badge variant={variant} className="text-[11px] font-medium">
      {label}
    </Badge>
  );
}

export default function FeatureRequestsPage() {
  const { data, isLoading, refetch, isFetching } = useFeatureRequests();
  const { isAdmin } = useIsSystemAdmin();
  const { selectedVineyardId } = useVineyard();
  const { user } = useAuth();
  const { profile } = useCurrentProfile();
  const create = useCreateFeatureRequest();
  const vote = useToggleFeatureVote();
  const update = useUpdateFeatureRequest();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [openThread, setOpenThread] = useState<string | null>(null);

  const requests = data?.requests ?? [];
  const visible = useMemo(
    () => filterFeatureRequests(requests, search, status),
    [requests, search, status],
  );

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Please add a short title");
      return;
    }
    try {
      await create.mutateAsync({
        title,
        details,
        createdByName: displayNameFor(profile, user?.email) ?? null,
        vineyardId: selectedVineyardId ?? null,
      });
      toast.success("Thanks — your request is on the board");
      setTitle("");
      setDetails("");
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save your request");
    }
  };

  const toggleVote = async (r: FeatureRequest) => {
    try {
      await vote.mutateAsync({ id: r.id, hasVoted: r.hasVoted });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not record your vote");
    }
  };

  return (
    <div className="space-y-6">
      <PageHead
        title="Feature Requests — VineTrack"
        description="Suggest new VineTrack features and vote on the ideas you want most."
        path="/feature-requests"
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Feature Requests</h1>
          <p className="text-sm text-muted-foreground">
            Suggest an improvement and vote for the ideas you want built first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New request
          </Button>
        </div>
      </div>

      {data?.backendPending && (
        <Card className="border-amber-300/60 bg-amber-50/60 p-4 text-sm dark:bg-amber-950/20">
          The suggestion board isn’t switched on yet. It will start collecting
          requests as soon as the database update is applied.
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search requests…"
          className="w-full sm:w-72"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {FEATURE_REQUEST_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {FEATURE_REQUEST_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {visible.length} {visible.length === 1 ? "request" : "requests"}
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading requests…
        </div>
      ) : visible.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <Lightbulb className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No requests yet. Be the first to suggest something.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map((r) => (
            <li key={r.id}>
              <Card className="flex items-start gap-4 p-4">
                <button
                  type="button"
                  onClick={() => toggleVote(r)}
                  aria-label={r.hasVoted ? "Remove your vote" : "Vote for this request"}
                  className={`flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-lg border transition-colors ${
                    r.hasVoted
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  <ChevronUp className="h-4 w-4" />
                  <span className="text-base font-semibold tabular-nums">{r.votes}</span>
                </button>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.title}</span>
                    <StatusBadge status={r.status} />
                    {r.is_hidden && (
                      <Badge variant="outline" className="gap-1 text-[11px]">
                        <EyeOff className="h-3 w-3" /> Hidden
                      </Badge>
                    )}
                  </div>
                  {r.details && (
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {r.details}
                    </p>
                  )}
                  {r.admin_note && (
                    <p className="rounded-md bg-muted/50 px-2 py-1 text-xs">
                      <span className="font-medium">VineTrack:</span> {r.admin_note}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs text-muted-foreground">
                      {r.created_by_name ?? "VineTrack user"} ·{" "}
                      {new Date(r.created_at).toLocaleDateString()}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setOpenThread(openThread === r.id ? null : r.id)}
                    >
                      <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                      {r.comments > 0
                        ? `${r.comments} ${r.comments === 1 ? "comment" : "comments"}`
                        : "Add comment"}
                    </Button>
                  </div>
                  {openThread === r.id && <FeatureRequestComments requestId={r.id} />}
                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Select
                        value={r.status}
                        onValueChange={(v) =>
                          update.mutate({ id: r.id, status: v as FeatureRequestStatus })
                        }
                      >
                        <SelectTrigger className="h-8 w-[160px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FEATURE_REQUEST_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {FEATURE_REQUEST_STATUS_LABEL[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => update.mutate({ id: r.id, is_hidden: !r.is_hidden })}
                      >
                        {r.is_hidden ? "Unhide" : "Hide"}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New feature request</DialogTitle>
            <DialogDescription>
              Describe what you would like VineTrack to do. Others can vote for it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="fr-title">Title</Label>
              <Input
                id="fr-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short summary"
                maxLength={160}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fr-details">Details</Label>
              <Textarea
                id="fr-details"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="What would it do, and why is it useful?"
                rows={6}
                maxLength={4000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={create.isPending}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Post request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
