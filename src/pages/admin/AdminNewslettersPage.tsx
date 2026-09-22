import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Copy, Eye, Plus, Send, Trash2, Pencil } from "lucide-react";
import {
  useDeleteNewsletter,
  useDuplicateNewsletter,
  useNewsletterCampaigns,
  statusLabel,
  type NewsletterCampaign,
  type NewsletterVersion,
} from "@/lib/newsletterAdmin";
import { useToast } from "@/hooks/use-toast";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty } from "./_shared";
import { formatDate } from "@/lib/dateFormat";

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "sent"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : status === "scheduled"
      ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
      : status === "sending" || status === "preparing"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : status === "failed" || status === "partially_failed"
      ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
      : "bg-muted text-muted-foreground";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{statusLabel(status)}</span>;
}

export default function AdminNewslettersPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isLoading, error } = useNewsletterCampaigns();
  const duplicate = useDuplicateNewsletter();
  const remove = useDeleteNewsletter();
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const latestVersion = useMemo(() => {
    const map = new Map<string, NewsletterVersion>();
    for (const v of data?.versions ?? []) {
      if (v.campaign_id && !map.has(v.campaign_id)) map.set(v.campaign_id, v);
    }
    return map;
  }, [data?.versions]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.campaigns ?? [];
    if (!q) return list;
    return list.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.subject ?? "").toLowerCase().includes(q),
    );
  }, [data?.campaigns, search]);

  const audienceLabel = (c: NewsletterCampaign) => {
    const parts: string[] = [];
    if (c.audience_current_users) parts.push("Users");
    if (c.audience_subscribers) parts.push("Subscribers");
    return parts.length ? parts.join(" + ") : "—";
  };

  return (
    <AdminGate>
      <AdminPageHeader
        title="Newsletters"
        subtitle="Create, preview and send VineTrack newsletters"
        actions={
          <Button className="gap-1" onClick={() => navigate("/admin/newsletters/new")}>
            <Plus className="h-4 w-4" /> New Newsletter
          </Button>
        }
      />
      <AdminError error={error} />
      <Card className="p-4">
        <Input
          placeholder="Search name or subject…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs mb-3"
        />
        {isLoading ? (
          <AdminEmpty>Loading newsletters…</AdminEmpty>
        ) : rows.length === 0 ? (
          <AdminEmpty>No newsletters yet. Start one with “New Newsletter”.</AdminEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Newsletter</th>
                  <th className="py-2 pr-3">Subject</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Audience</th>
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2 pr-3">Scheduled / sent</th>
                  <th className="py-2 pr-3 text-right">Recipients</th>
                  <th className="py-2 pr-3 text-right">Sent</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const v = latestVersion.get(c.id);
                  const when = v?.completed_at ?? v?.scheduled_at ?? c.scheduled_at;
                  return (
                    <tr key={c.id} className="border-t">
                      <td className="py-2 pr-3 font-medium">
                        <Link to={`/admin/newsletters/${c.id}`} className="hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground max-w-[220px] truncate">
                        {c.subject || "—"}
                      </td>
                      <td className="py-2 pr-3"><StatusBadge status={String(c.status)} /></td>
                      <td className="py-2 pr-3 text-muted-foreground">{audienceLabel(c)}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{formatDate(c.created_at)}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{when ? formatDate(when) : "—"}</td>
                      <td className="py-2 pr-3 text-right">{v?.recipient_count ?? c.audience_counts?.final ?? "—"}</td>
                      <td className="py-2 pr-3 text-right">{v ? v.sent_count : "—"}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title={String(c.status) === "sent" ? "Open (read-only)" : "Edit"}
                            onClick={() => navigate(`/admin/newsletters/${c.id}`)}
                          >
                            {String(c.status) === "sent" ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Duplicate"
                            disabled={duplicate.isPending}
                            onClick={async () => {
                              try {
                                const copy = await duplicate.mutateAsync(c.id);
                                navigate(`/admin/newsletters/${copy.id}`);
                              } catch (e) {
                                toast({
                                  title: "Couldn't duplicate",
                                  description: e instanceof Error ? e.message : String(e),
                                  variant: "destructive",
                                });
                              }
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Preview and send test"
                            onClick={() => navigate(`/admin/newsletters/${c.id}?tab=preview`)}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                          {["draft", "failed"].includes(String(c.status)) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Delete draft"
                              disabled={remove.isPending}
                              onClick={async () => {
                                if (confirmDelete !== c.id) {
                                  setConfirmDelete(c.id);
                                  toast({
                                    title: "Delete this draft?",
                                    description: "Press delete again to confirm.",
                                  });
                                  return;
                                }
                                try {
                                  await remove.mutateAsync(c.id);
                                  setConfirmDelete(null);
                                  toast({ title: "Draft deleted" });
                                } catch (e) {
                                  toast({
                                    title: "Couldn't delete",
                                    description: e instanceof Error ? e.message : String(e),
                                    variant: "destructive",
                                  });
                                }
                              }}
                            >
                              <Trash2 className={`h-4 w-4 ${confirmDelete === c.id ? "text-red-600" : ""}`} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        Opens and clicks are recorded by the VineTrack email service. Per-newsletter open and click
        totals are not yet exposed through the Portal — <Badge variant="outline">coming with the
        email reporting phase</Badge>.
      </p>
    </AdminGate>
  );
}
