import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  canManageExternalResources, createExternalResource, findDuplicateName, listExternalResources,
  updateExternalResource, validateExternalResource, type ExternalResource, type ExternalResourceInput,
} from "@/lib/externalResources";

const blank: ExternalResourceInput = { name: "", kind: "crew", contact_name: "", phone: "", email: "", notes: "" };

export function useExternalResources(vineyardId: string | null | undefined) {
  return useQuery({
    queryKey: ["vineyard_external_resources", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => listExternalResources(vineyardId!),
  });
}

export default function ExternalResourcesCard({ vineyardId, role, userId }: { vineyardId: string; role: string | null; userId: string | null }) {
  const qc = useQueryClient();
  const q = useExternalResources(vineyardId);
  const canManage = canManageExternalResources(role);
  const [editing, setEditing] = useState<ExternalResource | "new" | null>(null);
  const [form, setForm] = useState<ExternalResourceInput>(blank);
  const [busy, setBusy] = useState(false);
  const list = q.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["vineyard_external_resources", vineyardId] });

  const openEdit = (r: ExternalResource | "new") => {
    setEditing(r);
    setForm(r === "new" ? blank : { name: r.name, kind: r.kind, contact_name: r.contact_name ?? "", phone: r.phone ?? "", email: r.email ?? "", notes: r.notes ?? "" });
  };
  const dup = editing ? findDuplicateName(list, form.name, editing === "new" ? null : editing.id) : null;

  const save = async () => {
    const err = validateExternalResource(form);
    if (err) { toast.error(err); return; }
    if (dup) { toast.error(`"${dup.name}" already exists${dup.is_active ? "" : " (inactive — reactivate it instead)"}.`); return; }
    setBusy(true);
    try {
      if (editing === "new") await createExternalResource(vineyardId, userId, form);
      else if (editing) await updateExternalResource(editing.id, vineyardId, form);
      toast.success("Saved.");
      setEditing(null); await refresh();
    } catch (e: any) { toast.error(e?.message ?? String(e)); } finally { setBusy(false); }
  };
  const toggle = async (r: ExternalResource) => {
    setBusy(true);
    try { await updateExternalResource(r.id, vineyardId, { is_active: !r.is_active }); await refresh(); }
    catch (e: any) { toast.error(e?.message ?? String(e)); } finally { setBusy(false); }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Crew / External Contractors</h2>
          <p className="text-xs text-muted-foreground">Crews and contractors for this vineyard only. They don't get accounts; they can be assigned to Work Tasks and Pruning.</p>
        </div>
        {canManage && <Button size="sm" onClick={() => openEdit("new")}>Add</Button>}
      </div>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : q.error ? <p className="text-sm text-destructive">Couldn't load: {(q.error as Error).message}</p>
        : !list.length ? <p className="text-sm text-muted-foreground">None yet.</p>
        : <ul className="divide-y">{list.map((r) => (
          <li key={r.id} className="py-2 flex items-center gap-2 text-sm">
            <span className={r.is_active ? "font-medium" : "text-muted-foreground line-through"}>{r.name}</span>
            <Badge variant="outline">{r.kind === "crew" ? "Crew" : "Contractor"}</Badge>
            {!r.is_active && <Badge variant="secondary">Inactive</Badge>}
            <span className="text-xs text-muted-foreground truncate">{[r.contact_name, r.phone, r.email].filter(Boolean).join(" · ")}</span>
            {canManage && <span className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => openEdit(r)}>Edit</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => toggle(r)}>{r.is_active ? "Deactivate" : "Activate"}</Button>
            </span>}
          </li>))}</ul>}
      {!canManage && <p className="text-xs text-muted-foreground">Only owners and managers can change this list.</p>}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing === "new" ? "Add crew / contractor" : "Edit crew / contractor"}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              {dup && <p className="text-xs text-destructive mt-1">A {dup.is_active ? "" : "inactive "}entry named "{dup.name}" already exists.</p>}</div>
            <div className="flex gap-2">{(["crew", "contractor"] as const).map((k) => (
              <Button key={k} type="button" size="sm" variant={form.kind === k ? "default" : "outline"} onClick={() => setForm({ ...form, kind: k })}>{k === "crew" ? "Crew" : "Contractor"}</Button>))}</div>
            <div><Label>Contact name</Label><Input value={form.contact_name ?? ""} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div><Label>Notes</Label><Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={busy || !!dup} onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
