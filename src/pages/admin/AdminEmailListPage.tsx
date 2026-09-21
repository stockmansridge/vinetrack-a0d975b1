import { useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  AdminEmpty,
  AdminError,
  AdminGate,
  AdminPageHeader,
  formatDate,
} from "./_shared";
import {
  downloadEmailListCsv,
  filterSubscribers,
  parseEmailListImport,
  useBulkSubscriberStatus,
  useDeleteSubscribers,
  useEmailListSubscribers,
  useImportSubscribers,
  useSetSubscriberStatus,
  useUpdateSubscriber,
  type EmailListSubscriber,
  type SubscriberStatus,
} from "@/lib/emailListAdmin";

function sourceLabel(source: string): string {
  switch (source) {
    case "website_newsletter":
      return "Website newsletter";
    case "website_demo_opt_in":
      return "Demo opt-in";
    case "manual":
      return "Manual";
    case "import":
      return "Imported";
    default:
      return source;
  }
}

function statusClass(status: string) {
  return status === "subscribed"
    ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
    : "bg-muted text-muted-foreground border-border";
}

export default function AdminEmailListPage() {
  const { data = [], isLoading, error, refetch, isFetching } = useEmailListSubscribers();
  const statusMut = useSetSubscriberStatus();
  const bulkMut = useBulkSubscriberStatus();
  const deleteMut = useDeleteSubscribers();
  const importMut = useImportSubscribers();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const sources = useMemo(
    () => Array.from(new Set(data.map((r) => r.source).filter(Boolean))).sort(),
    [data],
  );

  const filtered = useMemo(
    () => filterSubscribers(data, { search, status, source }),
    [data, search, status, source],
  );

  const totals = useMemo(() => {
    let subscribed = 0;
    let unsubscribed = 0;
    for (const r of data) {
      if (r.status === "subscribed") subscribed += 1;
      else if (r.status === "unsubscribed") unsubscribed += 1;
    }
    return { total: data.length, subscribed, unsubscribed };
  }, [data]);

  const selectedIds = useMemo(
    () => filtered.filter((r) => selected.has(r.id)).map((r) => r.id),
    [filtered, selected],
  );
  const allShownSelected = filtered.length > 0 && selectedIds.length === filtered.length;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllShown = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const changeStatus = (id: string, next: SubscriberStatus) => {
    statusMut.mutate(
      { id, status: next },
      {
        onSuccess: () => toast.success(`Marked as ${next}`),
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not update the subscriber."),
      },
    );
  };

  const bulkStatus = (next: SubscriberStatus) => {
    if (selectedIds.length === 0) return;
    bulkMut.mutate(
      { ids: selectedIds, status: next },
      {
        onSuccess: (count) => {
          toast.success(`${count} ${count === 1 ? "person" : "people"} marked as ${next}`);
          setSelected(new Set());
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not update the selected people."),
      },
    );
  };

  const runDelete = () => {
    deleteMut.mutate(selectedIds, {
      onSuccess: (count) => {
        toast.success(`${count} ${count === 1 ? "person" : "people"} removed`);
        setSelected(new Set());
        setConfirmDelete(false);
      },
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "Could not remove the selected people."),
    });
  };

  const parsed = useMemo(() => parseEmailListImport(importText), [importText]);

  const runImport = () => {
    if (parsed.rows.length === 0) {
      toast.error("No valid email addresses were found.");
      return;
    }
    importMut.mutate(
      { rows: parsed.rows, source: "import" },
      {
        onSuccess: (res) => {
          toast.success(
            `Imported ${res.created} new, updated ${res.updated}` +
              (res.skipped ? `, skipped ${res.skipped}` : ""),
          );
          setImportOpen(false);
          setImportText("");
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not import the list."),
      },
    );
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImportText(await file.text());
    } catch {
      toast.error("That file could not be read.");
    }
  };

  return (
    <AdminGate>
      <AdminPageHeader
        title="Email List"
        subtitle="VineTrack website subscribers and marketing contacts"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (filtered.length === 0) {
                  toast.error("There is nothing to export in the current view.");
                  return;
                }
                downloadEmailListCsv(filtered);
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <Card className="p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
          <div className="text-2xl font-semibold">{totals.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Subscribed</div>
          <div className="text-2xl font-semibold">{totals.subscribed}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Unsubscribed</div>
          <div className="text-2xl font-semibold">{totals.unsubscribed}</div>
        </Card>
      </div>

      <Card className="p-3 mb-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Search email, first name, last name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 max-w-sm"
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="subscribed">Subscribed</SelectItem>
              <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
            </SelectContent>
          </Select>
          {sources.length > 0 && (
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s} value={s}>{sourceLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.length} of {data.length}
          </span>
        </div>
      </Card>

      {selectedIds.length > 0 && (
        <Card className="p-3 mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <Button
            variant="outline"
            size="sm"
            disabled={bulkMut.isPending}
            onClick={() => bulkStatus("subscribed")}
          >
            Subscribe
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={bulkMut.isPending}
            onClick={() => bulkStatus("unsubscribed")}
          >
            Unsubscribe
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={deleteMut.isPending}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <AdminError error={error} />
        {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && !error && filtered.length === 0 && (
          <AdminEmpty>No subscribers match the current filters.</AdminEmpty>
        )}
        {!isLoading && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 w-9">
                    <Checkbox
                      checked={allShownSelected}
                      onCheckedChange={toggleAllShown}
                      aria-label="Select all shown"
                    />
                  </th>
                  <th className="text-left font-medium px-3 py-2">Name</th>
                  <th className="text-left font-medium px-3 py-2">Email</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-left font-medium px-3 py-2">Source</th>
                  <th className="text-left font-medium px-3 py-2">Subscribed</th>
                  <th className="text-left font-medium px-3 py-2">Unsubscribed</th>
                  <th className="text-right font-medium px-3 py-2">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => {
                  const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || "—";
                  const isSubscribed = r.status === "subscribed";
                  return (
                    <tr key={r.id} className="hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={() => toggleOne(r.id)}
                          aria-label={`Select ${r.email}`}
                        />
                      </td>
                      <td className="px-3 py-2">{name}</td>
                      <td className="px-3 py-2 break-all">{r.email}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] border ${statusClass(r.status)}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs">{sourceLabel(r.source)}</span>
                        {r.source_page && (
                          <div className="text-[11px] text-muted-foreground break-all">
                            {r.source_page}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">{formatDate(r.subscribed_at)}</td>
                      <td className="px-3 py-2 text-xs">{formatDate(r.unsubscribed_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={statusMut.isPending}
                          onClick={() =>
                            changeStatus(r.id, isSubscribed ? "unsubscribed" : "subscribed")
                          }
                        >
                          {isSubscribed ? "Unsubscribe" : "Resubscribe"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) setImportText(""); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import subscribers</DialogTitle>
            <DialogDescription>
              Paste addresses (one per line) or choose a CSV file. A header row with Email,
              First Name, Last Name and Status is recognised. Existing people are updated, not
              duplicated.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                Choose CSV file
              </Button>
            </div>
            <Textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"jane@example.com\nEmail,First Name,Last Name\njohn@example.com,John,Smith"}
              className="min-h-[180px] font-mono text-xs"
            />
            {importText.trim().length > 0 && (
              <div className="text-xs text-muted-foreground">
                {parsed.rows.length} ready
                {parsed.duplicates > 0 && `, ${parsed.duplicates} repeated`}
                {parsed.invalid.length > 0 && `, ${parsed.invalid.length} unreadable`}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button
              onClick={runImport}
              disabled={importMut.isPending || parsed.rows.length === 0}
            >
              {importMut.isPending ? "Importing…" : `Import ${parsed.rows.length || ""}`.trim()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selectedIds.length} from the list?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected people from the email list. If you only want
              to stop emailing them, use Unsubscribe instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runDelete} disabled={deleteMut.isPending}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminGate>
  );
}
