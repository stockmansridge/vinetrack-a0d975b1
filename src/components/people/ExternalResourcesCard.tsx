import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HardHat, Plus } from "lucide-react";
import {
  canManageExternalResources, createExternalResource, findDuplicateName, listExternalResources,
  updateExternalResource, validateExternalResource, type ExternalResource, type ExternalResourceInput,
} from "@/lib/externalResources";

const blank: ExternalResourceInput = { name: "", kind: "crew", contact_name: "", phone: "", email: "", notes: "" };

export const externalResourcesKey = (vineyardId: string | null | undefined) => ["vineyard_external_resources", vineyardId];

export function useExternalResources(vineyardId: string | null | undefined) {
  return useQuery({
    queryKey: externalResourcesKey(vineyardId),
    enabled: !!vineyardId,
    queryFn: () => listExternalResources(vineyardId!),
  });
}

/**
 * Reusable create/edit dialog for one vineyard's crew/contractor directory.
 * On save it refetches the vineyard list and reports the saved resource so a
 * caller (e.g. a picker quick-add) can auto-select it.
 */
export function ExternalResourceFormDialog({
  open, onOpenChange, vineyardId, userId, editing = null, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  userId: string | null;
  editing?: ExternalResource | null;
  onSaved?: (r: ExternalResource) => void;
}) {
  const qc = useQueryClient();
  const q = useExternalResources(open ? vineyardId : null);
  const list = q.data ?? [];
  const [form, setForm] = useState<ExternalResourceInput>(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setForm(editing ? { name: editing.name, kind: editing.kind, contact_name: editing.contact_name ?? "", phone: editing.phone ?? "", email: editing.email ?? "", notes: editing.notes ?? "" } : blank);
  }, [open, editing]);

  const dup = open ? findDuplicateName(list, form.name, editing?.id ?? null) : null;

  const save = async () => {
    const v = validateExternalResource(form);
    if (v) { setErr(v); return; }
    if (dup) { setErr(`"${dup.name}" already exists${dup.is_active ? "" : " (inactive — reactivate it in Vineyard Settings)"}.`); return; }
    setBusy(true); setErr(null);
    try {
      let id = editing?.id ?? "";
      if (editing) await updateExternalResource(editing.id, vineyardId, form);
      else id = (await createExternalResource(vineyardId, userId, form)).id;
      await qc.invalidateQueries({ queryKey: externalResourcesKey(vineyardId) });
      const fresh = await qc.fetchQuery({ queryKey: externalResourcesKey(vineyardId), queryFn: () => listExternalResources(vineyardId) }).catch(() => null);
      const saved = fresh?.find((r) => r.id === id) ?? {
        id, vineyard_id: vineyardId, name: form.name.trim().replace(/\s+/g, " "), kind: form.kind,
        contact_name: form.contact_name || null, phone: form.phone || null, email: form.email || null, notes: form.notes || null, is_active: true,
      };
      toast.success("Saved.");
      onOpenChange(false);
      onSaved?.(saved);
    } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit crew / contractor" : "Add crew / contractor"}</DialogTitle>
          <DialogDescription>For this vineyard only. Crews and contractors don't get a login.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div><Label htmlFor="xr-name">Name</Label><Input id="xr-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            {dup && <p className="text-xs text-destructive mt-1">A {dup.is_active ? "" : "inactive "}entry named "{dup.name}" already exists.</p>}</div>
          <div className="flex gap-2">{(["crew", "contractor"] as const).map((k) => (
            <Button key={k} type="button" size="sm" variant={form.kind === k ? "default" : "outline"} aria-pressed={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>{k === "crew" ? "Crew" : "Contractor"}</Button>))}</div>
          <div><Label htmlFor="xr-contact">Contact name</Label><Input id="xr-contact" value={form.contact_name ?? ""} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="xr-phone">Phone</Label><Input id="xr-phone" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label htmlFor="xr-email">Email</Label><Input id="xr-email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <div><Label htmlFor="xr-notes">Notes</Label><Textarea id="xr-notes" rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={busy || !!dup} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Explains how Worker Types, Team and Crew / Contractors differ. */
export function PeopleTypesExplainer() {
  return (
    <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
      <li><span className="font-medium text-foreground">Worker Types</span> are labour rate categories used for costing (e.g. Casual, Tractor operator), not people.</li>
      <li><span className="font-medium text-foreground">Team</span> are people who log in to VineTrack for this vineyard.</li>
      <li><span className="font-medium text-foreground">Crew / Contractors</span> are outside crews or businesses you can assign to Work Tasks and Pruning. They don't log in, and assigning one doesn't add any cost.</li>
    </ul>
  );
}

export default function ExternalResourcesCard({ vineyardId, role, userId, vineyardName }: { vineyardId: string; role: string | null; userId: string | null; vineyardName?: string }) {
  const qc = useQueryClient();
  const q = useExternalResources(vineyardId);
  const canManage = canManageExternalResources(role);
  const [editing, setEditing] = useState<ExternalResource | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const list = q.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: externalResourcesKey(vineyardId) });

  const toggle = async (r: ExternalResource) => {
    setBusy(true);
    try { await updateExternalResource(r.id, vineyardId, { is_active: !r.is_active }); await refresh(); }
    catch (e: any) { toast.error(e?.message ?? String(e)); } finally { setBusy(false); }
  };

  return (
    <Card id="crew-contractors" className="p-4 space-y-3 border-primary/40" aria-labelledby="crew-contractors-title">
      <div className="flex items-start justify-between gap-2">
        <div className="flex gap-2">
          <HardHat className="h-5 w-5 text-primary mt-0.5 shrink-0" aria-hidden />
          <div>
            <h2 id="crew-contractors-title" className="text-lg font-semibold">Crew / External Contractors</h2>
            <p className="text-xs text-muted-foreground">
              Crews and contractors for {vineyardName ? <span className="font-medium text-foreground">{vineyardName}</span> : "this vineyard"} only. Assign them to Work Tasks and Pruning.
            </p>
          </div>
        </div>
        {canManage && <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4 mr-1" />Add crew / contractor</Button>}
      </div>
      <PeopleTypesExplainer />
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : q.error ? <p className="text-sm text-destructive">Couldn't load: {(q.error as Error).message}</p>
        : !list.length ? <p className="text-sm text-muted-foreground">None yet.{canManage ? " Use “Add crew / contractor” to create one." : ""}</p>
        : <ul className="divide-y">{list.map((r) => (
          <li key={r.id} className="py-2 flex items-center gap-2 text-sm">
            <span className={r.is_active ? "font-medium" : "text-muted-foreground line-through"}>{r.name}</span>
            <Badge variant="outline">{r.kind === "crew" ? "Crew" : "Contractor"}</Badge>
            {!r.is_active && <Badge variant="secondary">Inactive</Badge>}
            <span className="text-xs text-muted-foreground truncate">{[r.contact_name, r.phone, r.email].filter(Boolean).join(" · ")}</span>
            {canManage && <span className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(r)}>Edit</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => toggle(r)}>{r.is_active ? "Deactivate" : "Activate"}</Button>
            </span>}
          </li>))}</ul>}
      {!canManage && <p className="text-xs text-muted-foreground">Only owners and managers can change this list.</p>}

      <ExternalResourceFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        vineyardId={vineyardId}
        userId={userId}
        editing={editing === "new" ? null : editing}
      />
    </Card>
  );
}
