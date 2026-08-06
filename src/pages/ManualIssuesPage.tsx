// Manual Issues — shared pin records (mode = 'ManualIssue') with map, list,
// detail, status actions, filtering and exports. SQL 169 contract.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useVineyard } from "@/context/VineyardContext";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { fetchList } from "@/lib/queries";
import { parsePolygonPoints, type LatLng } from "@/lib/paddockGeometry";
import ManualIssueDialog from "@/components/manual-issues/ManualIssueDialog";
import ManualIssuesAppleMap from "@/components/manual-issues/ManualIssuesAppleMap";
import ReportDateCell from "@/components/reports/ReportDateCell";
import {
  ACTIVE_STATUSES,
  categoryLabel,
  countByStatus,
  filterIssues,
  isOverdue,
  ISSUE_CATEGORIES,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  locationSummary,
  manualIssueErrorMessage,
  manualIssueMarkerColour,
  priorityLabel,
  statusLabel,
  type IssueFilters,
  type IssueStatus,
  type ManualIssue,
} from "@/lib/manualIssues";
import {
  useDeleteOrCancelManualIssue,
  useManualIssues,
  useSetManualIssueStatus,
} from "@/lib/manualIssuesQuery";
import {
  downloadManualIssuesCsv,
  downloadManualIssuesPdf,
  downloadManualIssuesXlsx,
} from "@/lib/manualIssuesExport";

interface Paddock {
  id: string;
  name: string | null;
  polygon_points: any;
}

const statusVariant = (s?: string | null) =>
  s === "completed" ? "secondary" : s === "cancelled" ? "outline" : "default";

export default function ManualIssuesPage() {
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const { toast } = useToast();
  const { lookup, resolve } = useTeamLookup(selectedVineyardId);
  const canManage = currentRole === "owner" || currentRole === "manager" || currentRole === "supervisor";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ManualIssue | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<IssueFilters>({ statuses: [...ACTIVE_STATUSES] });

  const { data: paddocks = [] } = useQuery({
    queryKey: ["paddocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<Paddock>("paddocks", selectedVineyardId!),
  });

  const { data: issues = [], isLoading, error } = useManualIssues(selectedVineyardId);
  const setStatus = useSetManualIssueStatus();
  const deleteOrCancel = useDeleteOrCancelManualIssue();

  const paddockName = (id: string | null) =>
    (id && paddocks.find((p) => p.id === id)?.name) || (id ? "Unnamed block" : "—");

  const visible = useMemo(() => filterIssues(issues, filters), [issues, filters]);
  const counts = useMemo(() => countByStatus(issues), [issues]);
  const selected = visible.find((i) => i.id === selectedId) ?? null;

  const polygons = useMemo(
    () =>
      paddocks
        .map((p) => ({ id: p.id, pts: parsePolygonPoints(p.polygon_points) }))
        .filter((p): p is { id: string; pts: LatLng[] } => p.pts.length >= 3),
    [paddocks],
  );

  const mapped = visible.filter(
    (i) => i.latitude != null && i.longitude != null && Math.abs(i.latitude) <= 90,
  );

  const markers = useMemo(
    () =>
      mapped.map((i) => ({
        id: i.id,
        lat: i.latitude!,
        lng: i.longitude!,
        colour: manualIssueMarkerColour(i.status),
        title: i.title,
      })),
    [mapped],
  );

  const hasGeometry = markers.length > 0 || polygons.length > 0;

  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? "Vineyard";

  const exportCtx = {
    vineyardName,
    paddockName,
    memberName: (id: string | null) => resolve(id) ?? "Unassigned",
    formatDate: (v: string | null) => (v ? new Date(v).toLocaleDateString("en-AU") : ""),
  };

  const members = useMemo(
    () => [...lookup.entries()].map(([user_id, v]) => ({ user_id, name: v.name })),
    [lookup],
  );

  const act = async (fn: () => Promise<unknown>, okMessage: string) => {
    try {
      await fn();
      toast({ title: okMessage });
    } catch (e) {
      toast({ title: manualIssueErrorMessage(e), variant: "destructive" });
    }
  };

  if (!selectedVineyardId) {
    return <div className="text-muted-foreground">Select a vineyard to view manual issues.</div>;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Manual Issues</h1>
          <p className="text-sm text-muted-foreground">
            Record general vineyard issues that are not associated with a mapped pin or automatically captured during field work. Use this page for operational concerns, follow-up items and problems that need to be assigned, monitored or resolved.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => downloadManualIssuesCsv(visible, exportCtx)}>CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadManualIssuesXlsx(visible, exportCtx)}>Excel</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadManualIssuesPdf(visible, exportCtx)}>PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canManage && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> New issue
            </Button>
          )}
        </div>
      </header>

      <Card className="p-3">
        <div className="grid gap-3 md:grid-cols-5">
          <Input
            placeholder="Search issues…"
            value={filters.search ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
          <Select
            value={filters.statuses?.length === 1 ? filters.statuses[0] : filters.statuses?.length === ISSUE_STATUSES.length ? "all" : "active"}
            onValueChange={(v) =>
              setFilters((f) => ({
                ...f,
                statuses:
                  v === "all" ? [...ISSUE_STATUSES] : v === "active" ? [...ACTIVE_STATUSES] : [v as IssueStatus],
              }))
            }
          >
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
              {ISSUE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.paddockId ?? "all"}
            onValueChange={(v) => setFilters((f) => ({ ...f, paddockId: v === "all" ? null : v }))}
          >
            <SelectTrigger><SelectValue placeholder="Block" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All blocks</SelectItem>
              {paddocks.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name ?? "Unnamed block"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.priority ?? "all"}
            onValueChange={(v) => setFilters((f) => ({ ...f, priority: v === "all" ? null : (v as any) }))}
          >
            <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {ISSUE_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>{priorityLabel(p)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.category ?? "all"}
            onValueChange={(v) => setFilters((f) => ({ ...f, category: v === "all" ? null : (v as any) }))}
          >
            <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {ISSUE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <div className="h-[420px] w-full bg-muted">
            {hasGeometry ? (
              <ManualIssuesAppleMap
                markers={markers}
                polygons={polygons}
                onSelect={setSelectedId}
                fitKey={selectedVineyardId ?? ""}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No mapped issues or block geometry yet.
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          {selected ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{selected.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {categoryLabel(selected.category)} · {priorityLabel(selected.priority)}
                  </p>
                </div>
                <Badge variant={statusVariant(selected.status)}>{statusLabel(selected.status)}</Badge>
              </div>
              {selected.description && <p className="text-sm">{selected.description}</p>}
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Block</dt>
                <dd>{paddockName(selected.paddock_id)}</dd>
                <dt className="text-muted-foreground">Location</dt>
                <dd>{locationSummary(selected)}</dd>
                <dt className="text-muted-foreground">Assigned to</dt>
                <dd>{resolve(selected.assigned_user_id) ?? "Unassigned"}</dd>
                <dt className="text-muted-foreground">Due</dt>
                <dd>{selected.due_date ? <ReportDateCell value={selected.due_date} /> : "—"}</dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{selected.created_at ? <ReportDateCell value={selected.created_at} /> : "—"}</dd>
              </dl>
              {canManage && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(selected);
                      setDialogOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  {selected.status !== "in_progress" && selected.status !== "completed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        act(() => setStatus.mutateAsync({ id: selected.id, status: "in_progress" }), "Marked in progress")
                      }
                    >
                      Start
                    </Button>
                  )}
                  {selected.status !== "completed" && (
                    <Button
                      size="sm"
                      onClick={() =>
                        act(() => setStatus.mutateAsync({ id: selected.id, status: "completed" }), "Issue completed")
                      }
                    >
                      Complete
                    </Button>
                  )}
                  {selected.status !== "cancelled" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        act(() => deleteOrCancel.mutateAsync({ id: selected.id, action: "cancel" }), "Issue cancelled")
                      }
                    >
                      Cancel issue
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() =>
                      act(async () => {
                        await deleteOrCancel.mutateAsync({ id: selected.id, action: "delete" });
                        setSelectedId(null);
                      }, "Issue deleted")
                    }
                  >
                    Delete
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select an issue from the map or list to see its details.
            </p>
          )}
        </Card>
      </div>

      <Card className="p-0">
        {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
        {error && (
          <div className="p-4 text-sm text-destructive">{manualIssueErrorMessage(error)}</div>
        )}
        {!isLoading && !error && visible.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No issues match these filters.</div>
        )}
        <div className="divide-y">
          {visible.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => setSelectedId(i.id)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 ${
                selectedId === i.id ? "bg-sidebar-accent" : ""
              }`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: manualIssueMarkerColour(i.status) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{i.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {paddockName(i.paddock_id)} · {locationSummary(i)} · {categoryLabel(i.category)}
                </span>
              </span>
              {isOverdue(i) && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <AlertTriangle className="h-3 w-3" /> Overdue
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">{priorityLabel(i.priority)}</Badge>
              <Badge variant={statusVariant(i.status)} className="text-xs">{statusLabel(i.status)}</Badge>
            </button>
          ))}
        </div>
      </Card>

      <ManualIssueDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        vineyardId={selectedVineyardId}
        issue={editing}
        paddocks={paddocks}
        members={members}
      />
    </div>
  );
}
