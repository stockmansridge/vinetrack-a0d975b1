import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Archive, MapPin as MapPinIcon, Loader2 } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { fetchList } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  DAMAGE_TYPES,
  SEVERITIES,
  STATUSES,
  SIDES,
  archiveDamageRecord,
  createDamageRecord,
  fetchDamageRecordsForVineyard,
  resolveDamagePhotoUrl,
  updateDamageRecord,
  type DamageRecord,
  type DamageRecordWriteInput,
} from "@/lib/damageRecordsQuery";

const ANY = "__any__";

interface PaddockLite {
  id: string;
  name: string | null;
}

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};
const fmtDateTime = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));

const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "outline",
  medium: "secondary",
  high: "default",
  severe: "destructive",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive",
  monitoring: "secondary",
  resolved: "outline",
};

export default function DamageRecordsPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { resolve } = useTeamLookup(selectedVineyardId);
  const canEdit = currentRole === "owner" || currentRole === "manager";

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [paddockId, setPaddockId] = useState<string>(ANY);
  const [damageType, setDamageType] = useState<string>(ANY);
  const [severity, setSeverity] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [filter, setFilter] = useState("");

  const [selected, setSelected] = useState<DamageRecord | null>(null);
  const [editingOpen, setEditingOpen] = useState(false);
  const [editing, setEditing] = useState<DamageRecord | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<DamageRecord | null>(null);

  const { data: paddocks = [] } = useQuery({
    queryKey: ["paddocks-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PaddockLite>("paddocks", selectedVineyardId!),
  });

  const paddockNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    paddocks.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [paddocks]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["damage_records", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchDamageRecordsForVineyard(selectedVineyardId!),
  });

  const records = data?.records ?? [];

  const observed = (r: DamageRecord) => r.date_observed ?? r.date ?? r.created_at ?? null;

  const rows = useMemo(() => {
    let list = records.slice();
    list.sort((a, b) => (observed(b) ?? "").localeCompare(observed(a) ?? ""));
    if (from) list = list.filter((r) => (observed(r) ?? "") >= from);
    if (to) list = list.filter((r) => (observed(r) ?? "") <= to + "T23:59:59");
    if (paddockId !== ANY) list = list.filter((r) => r.paddock_id === paddockId);
    if (damageType !== ANY) list = list.filter((r) => r.damage_type === damageType);
    if (severity !== ANY) list = list.filter((r) => r.severity === severity);
    if (status !== ANY) list = list.filter((r) => (r.status ?? "open") === status);
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((r) =>
        [r.notes, r.operator_name, r.damage_type, r.side]
          .some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
  }, [records, from, to, paddockId, damageType, severity, status, filter]);

  const archiveMut = useMutation({
    mutationFn: (id: string) => archiveDamageRecord(id),
    onSuccess: () => {
      toast({ title: "Damage record archived" });
      queryClient.invalidateQueries({ queryKey: ["damage_records", selectedVineyardId] });
      setSelected(null);
      setArchiveTarget(null);
    },
    onError: (e: any) =>
      toast({ title: "Could not archive", description: e?.message ?? String(e), variant: "destructive" }),
  });

  const openCreate = () => {
    setEditing(null);
    setEditingOpen(true);
  };
  const openEdit = (r: DamageRecord) => {
    setEditing(r);
    setEditingOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Damage records</h1>
          <p className="text-sm text-muted-foreground">
            Frost, hail, disease and other damage observations. Synced with the iOS app.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" />
            New damage record
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">From</div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">To</div>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Paddock</div>
          <Select value={paddockId} onValueChange={setPaddockId}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any paddock</SelectItem>
              {paddocks.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name ?? p.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Type</div>
          <Select value={damageType} onValueChange={setDamageType}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any type</SelectItem>
              {DAMAGE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Severity</div>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Status</div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 ml-auto">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            placeholder="Notes, operator…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-64"
          />
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date observed</TableHead>
              <TableHead>Paddock</TableHead>
              <TableHead>Row / path</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Damage type</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Damage %</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="text-right">Photos</TableHead>
              {canEdit && <TableHead className="w-[80px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={canEdit ? 12 : 11} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={canEdit ? 12 : 11} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={canEdit ? 12 : 11} className="text-center text-muted-foreground py-8">
                  No damage records match the current filters.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const photoCount = (r.photo_urls ?? []).length;
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                  <TableCell>{fmtDate(observed(r))}</TableCell>
                  <TableCell>{r.paddock_id ? (paddockNameById.get(r.paddock_id) ?? "—") : "—"}</TableCell>
                  <TableCell>{fmt(r.row_number)}</TableCell>
                  <TableCell className="capitalize">{fmt(r.side)}</TableCell>
                  <TableCell>{fmt(r.damage_type)}</TableCell>
                  <TableCell>
                    {r.severity ? (
                      <Badge variant={SEVERITY_VARIANT[r.severity] ?? "outline"} className="capitalize">
                        {r.severity}
                      </Badge>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status ?? "open"] ?? "outline"} className="capitalize">
                      {r.status ?? "open"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.damage_percent == null ? "—" : `${r.damage_percent}%`}
                  </TableCell>
                  <TableCell>{fmt(r.operator_name) === "—" ? resolve(r.created_by) ?? "—" : r.operator_name}</TableCell>
                  <TableCell className="max-w-[260px] truncate">{fmt(r.notes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{photoCount}</TableCell>
                  {canEdit && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(r)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setArchiveTarget(r)} title="Archive">
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <DamageDetailSheet
        record={selected}
        paddockName={selected?.paddock_id ? paddockNameById.get(selected.paddock_id) ?? null : null}
        createdByName={resolve(selected?.created_by ?? null)}
        open={!!selected}
        canEdit={canEdit}
        onOpenChange={(o) => !o && setSelected(null)}
        onEdit={(r) => { setSelected(null); openEdit(r); }}
        onArchive={(r) => setArchiveTarget(r)}
      />

      <DamageEditSheet
        open={editingOpen}
        record={editing}
        paddocks={paddocks}
        vineyardId={selectedVineyardId}
        userId={user?.id ?? null}
        onClose={() => setEditingOpen(false)}
        onSaved={() => {
          setEditingOpen(false);
          queryClient.invalidateQueries({ queryKey: ["damage_records", selectedVineyardId] });
        }}
      />

      <AlertDialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive damage record?</AlertDialogTitle>
            <AlertDialogDescription>
              This soft-deletes the record. It will no longer appear in the portal or iOS sync.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveTarget && archiveMut.mutate(archiveTarget.id)}
              disabled={archiveMut.isPending}
            >
              {archiveMut.isPending ? "Archiving…" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------- Detail / read drawer ----------

function DamageDetailSheet({
  record, paddockName, createdByName, open, canEdit, onOpenChange, onEdit, onArchive,
}: {
  record: DamageRecord | null;
  paddockName: string | null;
  createdByName: string | null;
  open: boolean;
  canEdit: boolean;
  onOpenChange: (o: boolean) => void;
  onEdit: (r: DamageRecord) => void;
  onArchive: (r: DamageRecord) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{record?.damage_type ?? "Damage record"}</SheetTitle>
          <SheetDescription>
            {fmtDate(record?.date_observed ?? record?.date ?? record?.created_at)}
            {paddockName ? ` · ${paddockName}` : ""}
          </SheetDescription>
        </SheetHeader>
        {record && (
          <div className="mt-4 space-y-4 text-sm">
            <Section title="Observation">
              <Field label="Date observed" value={fmtDate(record.date_observed ?? record.date)} />
              <Field label="Paddock" value={paddockName ?? "—"} />
              <Field label="Row / path" value={fmt(record.row_number)} />
              <Field label="Side" value={fmt(record.side)} />
              <Field label="Damage type" value={fmt(record.damage_type)} />
              <Field label="Severity" value={fmt(record.severity)} />
              <Field label="Status" value={fmt(record.status ?? "open")} />
              <Field label="Damage %" value={record.damage_percent == null ? "—" : `${record.damage_percent}%`} />
              <Field label="Operator" value={fmt(record.operator_name) === "—" ? createdByName ?? "—" : record.operator_name!} />
            </Section>
            {record.notes && (
              <Section title="Notes">
                <p className="whitespace-pre-wrap">{record.notes}</p>
              </Section>
            )}
            {(record.latitude != null || record.longitude != null) && (
              <Section title="Location">
                <Field label="Latitude" value={fmt(record.latitude)} />
                <Field label="Longitude" value={fmt(record.longitude)} />
                {record.latitude != null && record.longitude != null && (
                  <a
                    className="inline-flex items-center gap-1 text-xs text-primary underline"
                    href={`https://maps.apple.com/?ll=${record.latitude},${record.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MapPinIcon className="h-3 w-3" /> Open in Maps
                  </a>
                )}
              </Section>
            )}
            {(record.pin_id || record.trip_id) && (
              <Section title="Linked records">
                {record.pin_id && <Field label="Pin ID" value={record.pin_id} mono />}
                {record.trip_id && <Field label="Trip ID" value={record.trip_id} mono />}
              </Section>
            )}
            {record.photo_urls && record.photo_urls.length > 0 && (
              <Section title={`Photos (${record.photo_urls.length})`}>
                <PhotoGrid paths={record.photo_urls} />
              </Section>
            )}
            <Section title="Meta">
              <Field label="Created" value={fmtDateTime(record.created_at)} />
              <Field label="Created by" value={createdByName ?? fmt(record.created_by)} />
              <Field label="Updated" value={fmtDateTime(record.updated_at)} />
              <Field label="Record ID" value={record.id} mono />
            </Section>
          </div>
        )}
        {canEdit && record && (
          <SheetFooter className="mt-6 flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => onArchive(record)}>
              <Archive className="h-4 w-4 mr-1.5" /> Archive
            </Button>
            <Button onClick={() => onEdit(record)}>
              <Pencil className="h-4 w-4 mr-1.5" /> Edit
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PhotoGrid({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(paths.map((p) => resolveDamagePhotoUrl(p))).then((res) => {
      if (!cancelled) setUrls(res);
    });
    return () => { cancelled = true; };
  }, [paths]);
  return (
    <div className="grid grid-cols-3 gap-2">
      {paths.map((p, i) => (
        <a key={i} href={urls[i] ?? "#"} target="_blank" rel="noreferrer"
           className="block aspect-square rounded-md overflow-hidden border bg-muted">
          {urls[i] ? (
            <img src={urls[i]!} alt={`Damage photo ${i + 1}`} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground p-1 text-center break-all">
              {p}
            </div>
          )}
        </a>
      ))}
    </div>
  );
}

// ---------- Edit / create drawer ----------

interface FormState {
  paddock_id: string;
  date_observed: string;
  damage_type: string;
  severity: string;
  status: string;
  damage_percent: string;
  row_number: string;
  side: string;
  operator_name: string;
  notes: string;
  latitude: string;
  longitude: string;
}

const emptyForm = (): FormState => ({
  paddock_id: "",
  date_observed: new Date().toISOString().slice(0, 10),
  damage_type: "",
  severity: "",
  status: "open",
  damage_percent: "",
  row_number: "",
  side: "",
  operator_name: "",
  notes: "",
  latitude: "",
  longitude: "",
});

function recordToForm(r: DamageRecord): FormState {
  const observed = r.date_observed ?? r.date ?? "";
  return {
    paddock_id: r.paddock_id ?? "",
    date_observed: observed ? observed.slice(0, 10) : "",
    damage_type: r.damage_type ?? "",
    severity: r.severity ?? "",
    status: r.status ?? "open",
    damage_percent: r.damage_percent == null ? "" : String(r.damage_percent),
    row_number: r.row_number == null ? "" : String(r.row_number),
    side: r.side ?? "",
    operator_name: r.operator_name ?? "",
    notes: r.notes ?? "",
    latitude: r.latitude == null ? "" : String(r.latitude),
    longitude: r.longitude == null ? "" : String(r.longitude),
  };
}

function DamageEditSheet({
  open, record, paddocks, vineyardId, userId, onClose, onSaved,
}: {
  open: boolean;
  record: DamageRecord | null;
  paddocks: PaddockLite[];
  vineyardId: string | null;
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(emptyForm());

  useEffect(() => {
    if (!open) return;
    setForm(record ? recordToForm(record) : emptyForm());
  }, [open, record]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const buildPayload = (): DamageRecordWriteInput | null => {
    if (!vineyardId) return null;
    const numOrNull = (s: string) => {
      const t = s.trim();
      if (!t) return null;
      const n = Number(t);
      return isNaN(n) ? null : n;
    };
    return {
      vineyard_id: vineyardId,
      paddock_id: form.paddock_id || null,
      date_observed: form.date_observed ? new Date(form.date_observed).toISOString() : null,
      damage_type: form.damage_type || null,
      severity: form.severity || null,
      status: form.status || "open",
      damage_percent: numOrNull(form.damage_percent),
      row_number: numOrNull(form.row_number),
      side: form.side || null,
      operator_name: form.operator_name.trim() || null,
      notes: form.notes.trim() || null,
      latitude: numOrNull(form.latitude),
      longitude: numOrNull(form.longitude),
    };
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      if (!payload) throw new Error("No vineyard selected");
      if (!payload.paddock_id) throw new Error("Paddock is required");
      if (!payload.damage_type) throw new Error("Damage type is required");
      if (record) {
        return updateDamageRecord(record.id, payload);
      }
      return createDamageRecord(payload, userId);
    },
    onSuccess: () => {
      toast({ title: record ? "Damage record updated" : "Damage record created" });
      onSaved();
    },
    onError: (e: any) =>
      toast({ title: "Save failed", description: e?.message ?? String(e), variant: "destructive" }),
  });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{record ? "Edit damage record" : "New damage record"}</SheetTitle>
          <SheetDescription>
            Saved to the iOS Supabase project. Visible in iOS after sync.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 grid gap-3">
          <Row label="Paddock *">
            <Select value={form.paddock_id} onValueChange={(v) => set("paddock_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select paddock" /></SelectTrigger>
              <SelectContent>
                {paddocks.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name ?? p.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Date observed">
            <Input type="date" value={form.date_observed} onChange={(e) => set("date_observed", e.target.value)} />
          </Row>
          <Row label="Damage type *">
            <Select value={form.damage_type} onValueChange={(v) => set("damage_type", v)}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {DAMAGE_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
              </SelectContent>
            </Select>
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Severity">
              <Select value={form.severity} onValueChange={(v) => set("severity", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label="Status">
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Row label="Damage %">
              <Input type="number" min={0} max={100} value={form.damage_percent}
                     onChange={(e) => set("damage_percent", e.target.value)} />
            </Row>
            <Row label="Row / path">
              <Input type="number" value={form.row_number}
                     onChange={(e) => set("row_number", e.target.value)} />
            </Row>
            <Row label="Side">
              <Select value={form.side} onValueChange={(v) => set("side", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {SIDES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          </div>
          <Row label="Operator">
            <Input value={form.operator_name} onChange={(e) => set("operator_name", e.target.value)} />
          </Row>
          <Row label="Notes">
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={4} />
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Latitude">
              <Input value={form.latitude} onChange={(e) => set("latitude", e.target.value)} />
            </Row>
            <Row label="Longitude">
              <Input value={form.longitude} onChange={(e) => set("longitude", e.target.value)} />
            </Row>
          </div>
          <p className="text-xs text-muted-foreground">
            Photo upload from the portal is coming soon. Existing iOS-uploaded photos display in the detail view.
          </p>
        </div>
        <SheetFooter className="mt-6 flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {record ? "Save changes" : "Create"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      <div className="rounded-md border bg-card/50 p-3 space-y-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs break-all text-right" : "text-right"}>{value}</span>
    </div>
  );
}
