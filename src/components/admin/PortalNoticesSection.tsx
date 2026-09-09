import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/dateFormat";
import {
  useAllPortalNotices,
  useSavePortalNotice,
  useSetPortalNoticeActive,
  useDeletePortalNotice,
  isNoticeLive,
  type PortalNotice,
  type PortalNoticeTone,
} from "@/lib/portalNotices";

interface FormState {
  id?: string;
  title: string;
  message: string;
  tone: PortalNoticeTone;
  priority: string;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
}

const EMPTY: FormState = {
  title: "",
  message: "",
  tone: "info",
  priority: "0",
  is_active: true,
  starts_at: "",
  ends_at: "",
};

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  try {
    return formatDateTime(s);
  } catch {
    return s;
  }
}

export default function PortalNoticesSection() {
  const { data: notices = [], isLoading, error } = useAllPortalNotices();
  const save = useSavePortalNotice();
  const setActive = useSetPortalNoticeActive();
  const del = useDeletePortalNotice();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const onNew = () => {
    setForm(EMPTY);
    setOpen(true);
  };

  const onEdit = (n: PortalNotice) => {
    setForm({
      id: n.id,
      title: n.title ?? "",
      message: n.message ?? "",
      tone: (n.tone as PortalNoticeTone) ?? "info",
      priority: String(n.priority ?? 0),
      is_active: n.is_active,
      starts_at: n.starts_at ? n.starts_at.slice(0, 16) : "",
      ends_at: n.ends_at ? n.ends_at.slice(0, 16) : "",
    });
    setOpen(true);
  };

  const onSave = async () => {
    if (!form.title.trim() || !form.message.trim()) {
      toast.error("Title and message are required");
      return;
    }
    try {
      await save.mutateAsync({
        id: form.id,
        title: form.title.trim(),
        message: form.message.trim(),
        tone: form.tone,
        priority: Number.isFinite(Number(form.priority)) ? Number(form.priority) : 0,
        is_active: form.is_active,
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      });
      toast.success(form.id ? "Portal notice updated" : "Portal notice published");
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save notice");
    }
  };

  const onDelete = async (n: PortalNotice) => {
    if (!confirm(`Delete portal notice "${n.title}"?`)) return;
    try {
      await del.mutateAsync(n.id);
      toast.success("Portal notice deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete");
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Portal notices</h2>
          <p className="text-sm text-muted-foreground">
            Announcements shown at the very top of the web portal only. Each person can
            close a notice once they've read it; editing a notice shows it again.
          </p>
        </div>
        <Button onClick={onNew}>
          <Plus className="mr-1 h-4 w-4" /> New portal notice
        </Button>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && (
        <div className="text-sm text-destructive">
          Could not load portal notices: {(error as Error).message}
        </div>
      )}
      {!isLoading && !error && notices.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          No portal notices yet. Click <span className="font-medium">New portal notice</span>{" "}
          to announce a change.
        </Card>
      )}

      <div className="grid gap-3">
        {notices.map((n) => (
          <Card key={n.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{n.title}</span>
                  <Badge variant="outline">{n.tone}</Badge>
                  {n.priority !== 0 && <Badge variant="secondary">priority {n.priority}</Badge>}
                  {isNoticeLive(n) ? (
                    <Badge>Showing now</Badge>
                  ) : (
                    <Badge variant="outline">{n.is_active ? "Scheduled / ended" : "Off"}</Badge>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {n.message}
                </p>
                <div className="mt-2 text-xs text-muted-foreground">
                  Window: {fmtDate(n.starts_at)} → {fmtDate(n.ends_at)} · Updated{" "}
                  {fmtDate(n.updated_at)}
                  {n.created_by_email ? ` · ${n.created_by_email}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <Switch
                  aria-label={`Show ${n.title}`}
                  checked={n.is_active}
                  disabled={setActive.isPending}
                  onCheckedChange={(v) => setActive.mutate({ id: n.id, is_active: v })}
                />
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => onEdit(n)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete"
                    onClick={() => onDelete(n)}
                  >
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
            <DialogTitle>{form.id ? "Edit portal notice" : "New portal notice"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="pn-title">Title</Label>
              <Input
                id="pn-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="pn-message">Message</Label>
              <Textarea
                id="pn-message"
                rows={4}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pn-tone">Style</Label>
                <Select
                  value={form.tone}
                  onValueChange={(v) => setForm({ ...form, tone: v as PortalNoticeTone })}
                >
                  <SelectTrigger id="pn-tone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Announcement</SelectItem>
                    <SelectItem value="success">New feature</SelectItem>
                    <SelectItem value="warning">Important</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="pn-priority">Priority</Label>
                <Input
                  id="pn-priority"
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="pn-starts">Starts at</Label>
                <Input
                  id="pn-starts"
                  type="datetime-local"
                  value={form.starts_at}
                  onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="pn-ends">Ends at</Label>
                <Input
                  id="pn-ends"
                  type="datetime-local"
                  value={form.ends_at}
                  onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="pn-active">Show in the portal</Label>
              <Switch
                id="pn-active"
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
