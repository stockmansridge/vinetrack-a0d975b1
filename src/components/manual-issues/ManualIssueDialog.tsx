// Create / edit a Manual Issue. Writes through the shared SQL 169 RPCs.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  applyScopeChange,
  buildSegments,
  categoryLabel,
  emptyIssueForm,
  formFromIssue,
  ISSUE_CATEGORIES,
  ISSUE_PRIORITIES,
  ISSUE_SCOPES,
  MANUAL_ISSUE_COLOUR,
  manualIssueErrorMessage,
  parseRowSelection,
  priorityLabel,
  ROW_SEGMENTS,
  scopeLabel,
  summariseSegments,
  validateIssueForm,
  type IssueFormState,
  type IssueScope,
  type ManualIssue,
} from "@/lib/manualIssues";
import { useSaveManualIssue } from "@/lib/manualIssuesQuery";
import { parsePolygonPoints, type LatLng } from "@/lib/paddockGeometry";
import ManualIssuesAppleMap from "@/components/manual-issues/ManualIssuesAppleMap";

export interface PaddockOption {
  id: string;
  name: string | null;
  polygon_points?: any;
}

export interface MemberOption {
  user_id: string;
  name: string;
}

export default function ManualIssueDialog({
  open,
  onOpenChange,
  vineyardId,
  issue,
  paddocks,
  members,
  defaultCentre,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vineyardId: string | null;
  issue?: ManualIssue | null;
  paddocks: PaddockOption[];
  members: MemberOption[];
  defaultCentre?: [number, number] | null;
}) {
  const { toast } = useToast();
  const save = useSaveManualIssue(vineyardId);
  const [form, setForm] = useState<IssueFormState>(emptyIssueForm());

  useEffect(() => {
    if (!open) return;
    setForm(issue ? formFromIssue(issue) : emptyIssueForm());
  }, [open, issue]);

  const set = (patch: Partial<IssueFormState>) => setForm((f) => ({ ...f, ...patch }));

  const polygons = useMemo(
    () =>
      paddocks
        .map((p) => ({ id: p.id, pts: parsePolygonPoints(p.polygon_points) }))
        .filter((p): p is { id: string; pts: LatLng[] } => p.pts.length >= 3),
    [paddocks],
  );

  const fallbackPolygons = useMemo(
    () =>
      polygons.length || !defaultCentre
        ? polygons
        : [{ id: "centre", pts: [{ lat: defaultCentre[0], lng: defaultCentre[1] }] as LatLng[] }],
    [polygons, defaultCentre],
  );


  const rows = parseRowSelection(form.rowSelection);
  const segmentPreview = summariseSegments(buildSegments(rows, form.rowSections));

  const submit = async () => {
    const problem = validateIssueForm(form);
    if (problem) {
      toast({ title: problem, variant: "destructive" });
      return;
    }
    try {
      await save.mutateAsync(form);
      toast({ title: form.id ? "Issue updated" : "Issue created" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: manualIssueErrorMessage(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit issue" : "New manual issue"}</DialogTitle>
          <DialogDescription>
            Manual Issues are shared with the VineTrack mobile apps.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="mi-title">Title</Label>
            <Input
              id="mi-title"
              value={form.title}
              maxLength={120}
              placeholder="e.g. Broken irrigation line"
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="mi-desc">Description</Label>
            <Textarea
              id="mi-desc"
              rows={3}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => set({ category: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ISSUE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => set({ priority: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ISSUE_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>{priorityLabel(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mi-due">Due date</Label>
              <Input
                id="mi-due"
                type="date"
                value={form.dueDate ?? ""}
                onChange={(e) => set({ dueDate: e.target.value || null })}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Assigned to</Label>
              <Select
                value={form.assignedUserId ?? "none"}
                onValueChange={(v) => set({ assignedUserId: v === "none" ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Block</Label>
              <Select
                value={form.paddockId ?? "none"}
                onValueChange={(v) => set({ paddockId: v === "none" ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="No block" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No block</SelectItem>
                  {paddocks.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name ?? "Unnamed block"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Location</Label>
            <div className="inline-flex rounded-md border bg-background p-0.5 w-fit">
              {ISSUE_SCOPES.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={form.locationScope === s ? "secondary" : "ghost"}
                  className="h-7 px-3 text-xs"
                  onClick={() => setForm((f) => applyScopeChange(f, s as IssueScope))}
                >
                  {scopeLabel(s)}
                </Button>
              ))}
            </div>
          </div>

          {form.locationScope === "point" && (
            <div className="space-y-2">
              <div className="h-[280px] w-full overflow-hidden rounded-md border">
                <ManualIssuesAppleMap
                  markers={
                    form.latitude != null && form.longitude != null
                      ? [{ id: "picked", lat: form.latitude, lng: form.longitude, colour: MANUAL_ISSUE_COLOUR }]
                      : []
                  }
                  polygons={fallbackPolygons}
                  onPick={(lat, lng) => set({ latitude: lat, longitude: lng })}
                  fitKey={form.id ?? "new"}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {form.latitude != null && form.longitude != null
                  ? `Pinned at ${form.latitude.toFixed(5)}, ${form.longitude.toFixed(5)} — click the map to move it.`
                  : "Click the map to place the issue."}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="mi-row">Row number (optional)</Label>
                  <Input
                    id="mi-row"
                    inputMode="decimal"
                    value={form.drivingRowNumber ?? ""}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      set({ drivingRowNumber: e.target.value === "" || !Number.isFinite(n) ? null : n });
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Side of row (optional)</Label>
                  <Select
                    value={form.pinSide ?? "none"}
                    onValueChange={(v) => set({ pinSide: v === "none" ? null : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not specified</SelectItem>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {form.locationScope === "row" && (
            <div className="space-y-3">
              <div className="grid gap-2">
                <Label htmlFor="mi-rows">Rows</Label>
                <Input
                  id="mi-rows"
                  placeholder="e.g. 8-9, 12"
                  value={form.rowSelection}
                  onChange={(e) => set({ rowSelection: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Row sections</Label>
                <div className="flex flex-wrap gap-4">
                  {ROW_SEGMENTS.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.rowSections.includes(s)}
                        onCheckedChange={(c) =>
                          set({
                            rowSections: c
                              ? [...form.rowSections, s].sort((a, b) => a - b)
                              : form.rowSections.filter((x) => x !== s),
                          })
                        }
                      />
                      Section {s}
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {segmentPreview ?? "Select at least one row."}
              </p>
            </div>
          )}

          {form.locationScope === "block" && (
            <p className="text-sm text-muted-foreground">
              This issue applies to the whole selected block.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Saving…" : form.id ? "Save changes" : "Create issue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
