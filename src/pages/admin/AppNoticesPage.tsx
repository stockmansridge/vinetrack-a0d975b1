import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import {
  useAppNotices,
  useUpsertAppNotice,
  useSetAppNoticeActive,
  useDeleteAppNotice,
  type AppNotice,
} from "@/lib/appNotices";

interface FormState {
  id?: string;
  title: string;
  message: string;
  notice_type: string;
  priority: string;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
}

const EMPTY: FormState = {
  title: "",
  message: "",
  notice_type: "info",
  priority: "0",
  is_active: true,
  starts_at: "",
  ends_at: "",
};

function fromNotice(n: AppNotice): FormState {
  return {
    id: n.id,
    title: n.title ?? "",
    message: n.message ?? "",
    notice_type: n.notice_type ?? "info",
    priority: String(n.priority ?? 0),
    is_active: n.is_active,
    starts_at: n.starts_at ? n.starts_at.slice(0, 16) : "",
    ends_at: n.ends_at ? n.ends_at.slice(0, 16) : "",
  };
}

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export default function AppNoticesPage() {
  const { isAdmin, loading } = useIsSystemAdmin();
  const { data: notices = [], isLoading, error } = useAppNotices();
  const upsert = useUpsertAppNotice();
  const setActive = useSetAppNoticeActive();
  const del = useDeleteAppNotice();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const onNew = () => {
    setForm(EMPTY);
    setOpen(true);
  };
  const onEdit = (n: AppNotice) => {
    setForm(fromNotice(n));
    setOpen(true);
  };

  const onSave = async () => {
    if (!form.title.trim() || !form.message.trim()) {
      toast.error("Title and message are required");
      return;
    }
    try {
      await upsert.mutateAsync({
        id: form.id,
        title: form.title.trim(),
        message: form.message.trim(),
        notice_type: form.notice_type.trim() || null,
        priority: Number.isFinite(Number(form.priority)) ? Number(form.priority) : 0,
        is_active: form.is_active,
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      });
      toast.success(form.id ? "Notice updated" : "Notice created");
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save notice");
    }
  };

  const onDelete = async (n: AppNotice) => {
    if (!confirm(`Delete notice "${n.title ?? n.id}"?`)) return;
    try {
      await del.mutateAsync(n.id);
      toast.success("Notice deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">App Notices</h1>
          <p className="text-sm text-muted-foreground">
            App-wide banners shared with the iOS app via the central{" "}
            <code>app_notices</code> table.
          </p>
        </div>
        <Button onClick={onNew}>
          <Plus className="h-4 w-4 mr-1" /> New notice
        </Button>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && (
        <div className="text-sm text-destructive">
          Could not load notices: {(error as Error).message}
        </div>
      )}
      {!isLoading && notices.length === 0 && !error && (
        <Card className="p-6 text-sm text-muted-foreground">
          No notices yet. Click <span className="font-medium">New notice</span> to create one.
        </Card>
      )}

      <div className="grid gap-3">
        {notices.map((n) => (
          <Card key={n.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{n.title ?? "(untitled)"}</span>
                  {n.notice_type && <Badge variant="outline">{n.notice_type}</Badge>}
                  {typeof n.priority === "number" && n.priority !== 0 && (
                    <Badge variant="secondary">priority {n.priority}</Badge>
                  )}
                  {n.is_active ? (
                    <Badge>Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                  {n.message}
                </p>
                <div className="text-xs text-muted-foreground mt-2">
                  Window: {fmtDate(n.starts_at)} → {fmtDate(n.ends_at)} · Updated{" "}
                  {fmtDate(n.updated_at)}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <Switch
                  checked={n.is_active}
                  disabled={setActive.isPending}
                  onCheckedChange={(v) => setActive.mutate({ id: n.id, is_active: v })}
                />
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => onEdit(n)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => onDelete(n)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit notice" : "New notice"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                rows={4}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="notice_type">Type</Label>
                <Input
                  id="notice_type"
                  placeholder="info / warning / outage"
                  value={form.notice_type}
                  onChange={(e) => setForm({ ...form, notice_type: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="priority">Priority</Label>
                <Input
                  id="priority"
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="starts_at">Starts at</Label>
                <Input
                  id="starts_at"
                  type="datetime-local"
                  value={form.starts_at}
                  onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="ends_at">Ends at</Label>
                <Input
                  id="ends_at"
                  type="datetime-local"
                  value={form.ends_at}
                  onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="is_active">Active</Label>
              <Switch
                id="is_active"
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={upsert.isPending}>
              {upsert.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
