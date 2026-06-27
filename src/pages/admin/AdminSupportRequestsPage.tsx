import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Paperclip, ExternalLink, AlertTriangle, RefreshCw, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  AdminGate,
  AdminPageHeader,
  AdminError,
  AdminEmpty,
  formatDate,
} from "./_shared";

interface SupportRequestRow {
  id: string;
  created_at: string | null;
  updated_at?: string | null;
  status: string | null;
  request_type?: string | null;
  category?: string | null;
  subject: string | null;
  message: string | null;
  user_id?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  user_role?: string | null;
  vineyard_id?: string | null;
  vineyard_name?: string | null;
  page_path?: string | null;
  browser_info?: string | null;
  app_version?: string | null;
  platform?: string | null;
  device?: string | null;
  os_version?: string | null;
  email_status?: string | null;
  email_error?: string | null;
  email_sent_at?: string | null;
  attachment_paths?: string[] | null;
  attachment_count?: number | null;
}

const STATUS_OPTIONS = ["new", "open", "in_progress", "resolved", "closed"] as const;

function statusClass(s: string | null | undefined) {
  switch ((s ?? "").toLowerCase()) {
    case "new":
      return "bg-blue-500/15 text-blue-600 border-blue-500/30";
    case "open":
      return "bg-sky-500/15 text-sky-600 border-sky-500/30";
    case "in_progress":
      return "bg-orange-500/15 text-orange-600 border-orange-500/30";
    case "resolved":
      return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
    case "closed":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function emailStatusClass(s: string | null | undefined) {
  switch ((s ?? "").toLowerCase()) {
    case "sent":
      return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
    case "failed":
    case "dlq":
    case "bounced":
      return "bg-red-500/15 text-red-600 border-red-500/30";
    case "pending":
    case "queued":
      return "bg-orange-500/15 text-orange-600 border-orange-500/30";
    case "suppressed":
      return "bg-yellow-500/15 text-yellow-700 border-yellow-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

async function fetchSupportRequests(): Promise<SupportRequestRow[]> {
  const { data, error } = await (iosSupabase as any).rpc("admin_list_support_requests");
  if (error) throw error;
  return (data ?? []) as SupportRequestRow[];
}

async function updateStatus(id: string, status: string): Promise<void> {
  // Prefer dedicated RPC; fall back to direct UPDATE if RLS permits.
  const rpc = await (iosSupabase as any).rpc("admin_update_support_request_status", {
    p_id: id,
    p_status: status,
  });
  if (!rpc.error) return;
  const isMissing = /function .* does not exist|Could not find the function/i.test(
    rpc.error.message ?? "",
  );
  if (!isMissing) throw rpc.error;
  const { error: upErr } = await (iosSupabase as any)
    .from("support_requests")
    .update({ status })
    .eq("id", id);
  if (upErr) throw upErr;
}

function AttachmentLink({ path }: { path: string }) {
  const [loading, setLoading] = useState(false);
  const open = async () => {
    setLoading(true);
    try {
      const { data, error } = await iosSupabase.storage
        .from("support-attachments")
        .createSignedUrl(path, 600);
      if (error || !data?.signedUrl) {
        toast.error(
          `Cannot sign attachment URL — admin policy missing on support-attachments bucket. (${error?.message ?? "no url"})`,
        );
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } finally {
      setLoading(false);
    }
  };
  const name = path.split("/").pop() || path;
  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-50"
    >
      <Paperclip className="h-3 w-3" />
      <span className="truncate max-w-[260px]">{name}</span>
      <ExternalLink className="h-3 w-3" />
    </button>
  );
}

function DetailSheet({
  row,
  open,
  onOpenChange,
  onStatusChange,
  saving,
}: {
  row: SupportRequestRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onStatusChange: (status: string) => void;
  saving: boolean;
}) {
  if (!row) return null;
  const paths = row.attachment_paths ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="pr-8">{row.subject || "(no subject)"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4 text-sm">
          <div className="flex flex-wrap gap-2 items-center">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${statusClass(row.status)}`}>
              {row.status ?? "—"}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${emailStatusClass(row.email_status)}`}>
              email: {row.email_status ?? "—"}
            </span>
            {(row.category || row.request_type) && (
              <Badge variant="outline" className="text-xs">
                {row.category ?? row.request_type}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {formatDate(row.created_at)}
            </span>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <Select
              value={row.status ?? "new"}
              onValueChange={onStatusChange}
              disabled={saving}
            >
              <SelectTrigger className="mt-1 h-9 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card className="p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Message
            </div>
            <div className="whitespace-pre-wrap break-words text-sm">
              {row.message || "—"}
            </div>
          </Card>

          <Card className="p-3 space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Submitter
            </div>
            <div><span className="text-muted-foreground">Name:</span> {row.user_name ?? "—"}</div>
            <div><span className="text-muted-foreground">Email:</span> {row.user_email ?? "—"}</div>
            <div><span className="text-muted-foreground">Role:</span> {row.user_role ?? "—"}</div>
            <div><span className="text-muted-foreground">User ID:</span> <span className="font-mono text-xs">{row.user_id ?? "—"}</span></div>
          </Card>

          <Card className="p-3 space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Vineyard
            </div>
            <div><span className="text-muted-foreground">Name:</span> {row.vineyard_name ?? "—"}</div>
            <div><span className="text-muted-foreground">ID:</span> <span className="font-mono text-xs">{row.vineyard_id ?? "—"}</span></div>
          </Card>

          <Card className="p-3 space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              App / device
            </div>
            <div><span className="text-muted-foreground">Platform:</span> {row.platform ?? "—"}</div>
            <div><span className="text-muted-foreground">App version:</span> {row.app_version ?? "—"}</div>
            <div><span className="text-muted-foreground">Device:</span> {row.device ?? "—"}</div>
            <div><span className="text-muted-foreground">OS:</span> {row.os_version ?? "—"}</div>
            <div><span className="text-muted-foreground">Page:</span> {row.page_path ?? "—"}</div>
            {row.browser_info && (
              <div className="text-xs text-muted-foreground break-words">{row.browser_info}</div>
            )}
          </Card>

          <Card className="p-3 space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Email delivery
            </div>
            <div><span className="text-muted-foreground">Status:</span> {row.email_status ?? "—"}</div>
            <div><span className="text-muted-foreground">Sent:</span> {formatDate(row.email_sent_at)}</div>
            {row.email_error && (
              <div className="text-red-600 break-words text-xs">
                <AlertTriangle className="inline h-3 w-3 mr-1" />
                {row.email_error}
              </div>
            )}
          </Card>

          <Card className="p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Attachments ({paths.length})
            </div>
            {paths.length === 0 ? (
              <div className="text-xs text-muted-foreground">No attachments.</div>
            ) : (
              <div className="space-y-1">
                {paths.map((p) => (
                  <div key={p}><AttachmentLink path={p} /></div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function AdminSupportRequestsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const { data = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "support-requests"],
    queryFn: fetchSupportRequests,
    staleTime: 30_000,
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(
    () => new Set(["new", "open", "in_progress", "resolved"]),
  );
  const [emailFilter, setEmailFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [vineyardFilter, setVineyardFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(routeId ?? null);

  // Keep openId synced with the URL param so deep-link emails open the sheet
  // and Back/Forward navigation works as expected.
  useEffect(() => {
    setOpenId(routeId ?? null);
  }, [routeId]);

  const setOpen = (id: string | null) => {
    setOpenId(id);
    if (id) navigate(`/admin/support-requests/${id}`, { replace: false });
    else navigate(`/admin/support-requests`, { replace: false });
  };

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          data
            .map((r) => r.category ?? r.request_type ?? "")
            .filter((s): s is string => Boolean(s)),
        ),
      ).sort(),
    [data],
  );
  const vineyards = useMemo(
    () =>
      Array.from(
        new Set(data.map((r) => r.vineyard_name ?? "").filter((s): s is string => Boolean(s))),
      ).sort(),
    [data],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data
      .filter((r) => {
        if (statusFilter.size > 0 && !statusFilter.has(r.status ?? "")) return false;
        if (emailFilter !== "all" && (r.email_status ?? "") !== emailFilter) return false;
        const cat = r.category ?? r.request_type ?? "";
        if (categoryFilter !== "all" && cat !== categoryFilter) return false;
        if (vineyardFilter !== "all" && (r.vineyard_name ?? "") !== vineyardFilter) return false;
        if (!q) return true;
        return [r.subject, r.message, r.user_name, r.user_email]
          .map((x) => (x ?? "").toLowerCase())
          .some((x) => x.includes(q));
      })
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [data, search, statusFilter, emailFilter, categoryFilter, vineyardFilter]);

  const emailStatuses = useMemo(
    () =>
      Array.from(
        new Set(data.map((r) => r.email_status ?? "").filter((s): s is string => Boolean(s))),
      ).sort(),
    [data],
  );

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateStatus(id, status),
    onSuccess: (_d, vars) => {
      toast.success(`Status updated to ${vars.status}`);
      qc.invalidateQueries({ queryKey: ["admin", "support-requests"] });
      qc.invalidateQueries({ queryKey: ["admin", "support-requests", "unresolved-count"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to update status: ${msg}`);
    },
  });

  const selected = openId ? data.find((r) => r.id === openId) ?? null : null;

  return (
    <AdminGate>
      <AdminPageHeader
        title="Support Requests"
        subtitle={`${filtered.length} of ${data.length}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <Card className="p-3 mb-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Search subject, message, name, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 max-w-sm"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                Status: {statusFilter.size === 0
                  ? "none"
                  : statusFilter.size === STATUS_OPTIONS.length
                    ? "all"
                    : Array.from(statusFilter).join(", ")}
                <ChevronDown className="h-4 w-4 ml-1 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {STATUS_OPTIONS.map((s) => (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={statusFilter.has(s)}
                  onCheckedChange={(checked) => {
                    setStatusFilter((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(s);
                      else next.delete(s);
                      return next;
                    });
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  {s}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setStatusFilter(new Set(STATUS_OPTIONS))}>
                Select all
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter(new Set())}>
                Clear
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Select value={emailFilter} onValueChange={setEmailFilter}>
            <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Email status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All email</SelectItem>
              {emailStatuses.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {categories.length > 0 && (
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {vineyards.length > 0 && (
            <Select value={vineyardFilter} onValueChange={setVineyardFilter}>
              <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Vineyard" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All vineyards</SelectItem>
                {vineyards.map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <AdminError error={error} />
        {isLoading && (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        )}
        {!isLoading && !error && filtered.length === 0 && (
          <AdminEmpty>No support requests match the current filters.</AdminEmpty>
        )}
        {!isLoading && filtered.length > 0 && (
          <div className="divide-y">
            {filtered.map((r) => {
              const cat = r.category ?? r.request_type;
              const attCount = r.attachment_count ?? r.attachment_paths?.length ?? 0;
              return (
                <button
                  key={r.id}
                  onClick={() => setOpen(r.id)}
                  className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">
                          {r.subject || "(no subject)"}
                        </span>
                        {cat && (
                          <Badge variant="outline" className="text-[10px]">{cat}</Badge>
                        )}
                        {attCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Paperclip className="h-3 w-3" />
                            {attCount}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {(r.message ?? "").slice(0, 140) || "—"}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {(r.user_name || r.user_email) ?? "—"}
                        {r.user_email && r.user_name ? ` · ${r.user_email}` : ""}
                        {r.vineyard_name ? ` · ${r.vineyard_name}` : ""}
                        {r.platform || r.app_version
                          ? ` · ${[r.platform, r.app_version, r.device].filter(Boolean).join(" ")}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(r.created_at)}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] border ${statusClass(r.status)}`}>
                        {r.status ?? "—"}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] border ${emailStatusClass(r.email_status)}`}>
                        ✉ {r.email_status ?? "—"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <DetailSheet
        row={selected}
        open={!!selected}
        onOpenChange={(v) => !v && setOpen(null)}
        onStatusChange={(s) => selected && statusMut.mutate({ id: selected.id, status: s })}
        saving={statusMut.isPending}
      />
    </AdminGate>
  );
}
