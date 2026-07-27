import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { PageHead } from "@/components/PageHead";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, ArrowLeft, Check, Pencil, Plus } from "lucide-react";
import {
  ALLOCATION_METHOD_LABEL,
  useAvailableRows,
  useCreateSystem,
  useCreateValve,
  useIrrigationSystems,
  useIrrigationValves,
  useSetValveBlocks,
  useSetValveRows,
  useSetupStatus,
  useUpdateSystem,
  useUpdateValve,
  useValveBlocks,
  useValveConnectionSummaries,
  useValveRows,
  type AllocationMethod,
  type IrrigationSystem,
  type IrrigationValve,
  type SetValveRowsResult,
  type ValveBlockInput,
  type ValveConnectionSummary,
} from "@/lib/irrigationQuery";
import {
  blockCoveragePercent,
  extractSelectedRowIds,
  formatEstimate,
  formatRowRanges,
  normaliseAvailableRows,
  normaliseServerRowSummary,
  savedEstimateLines,
  summariseSavedRows,
  weightingBasisLabel,
  type ServerRowSummary,
} from "@/lib/irrigationRows";

import { ValveRowSelector } from "@/components/irrigation/ValveRowSelector";


function useBlocks(vineyardId: string | null) {
  return useQuery({
    queryKey: ["irrigation", "blocks", vineyardId],
    enabled: !!vineyardId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id, name")
        .eq("vineyard_id", vineyardId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string | null }>;
    },
  });
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

function SystemDialog({
  vineyardId,
  system,
  open,
  onOpenChange,
}: {
  vineyardId: string | null;
  system: IrrigationSystem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useCreateSystem(vineyardId);
  const update = useUpdateSystem(vineyardId);
  const [name, setName] = useState(system?.name ?? "");
  const [waterSource, setWaterSource] = useState(system?.water_source ?? "");
  const [controller, setController] = useState(system?.controller_name ?? "");
  const [notes, setNotes] = useState(system?.notes ?? "");
  const busy = create.isPending || update.isPending;

  const save = async () => {
    try {
      if (system) {
        await update.mutateAsync({
          id: system.id,
          name,
          water_source: waterSource || null,
          controller_name: controller || null,
          notes: notes || null,
        });
      } else {
        await create.mutateAsync({
          name,
          water_source: waterSource || null,
          controller_name: controller || null,
          notes: notes || null,
        });
      }
      toast({ title: system ? "System updated" : "System added" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't save system", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{system ? "Edit irrigation system" : "New irrigation system"}</DialogTitle>
          <DialogDescription>
            A system groups the valves fed by one pump, bore, dam or controller.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="sys-name">System name</Label>
            <Input id="sys-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sys-source">Water source</Label>
            <Input
              id="sys-source"
              placeholder="Dam, bore, river, mains…"
              value={waterSource}
              onChange={(e) => setWaterSource(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="sys-controller">Controller</Label>
            <Input
              id="sys-controller"
              placeholder="Controller name (optional)"
              value={controller}
              onChange={(e) => setController(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="sys-notes">Notes</Label>
            <Textarea id="sys-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SystemsTab({ vineyardId }: { vineyardId: string | null }) {
  const systems = useIrrigationSystems(vineyardId, true);
  const update = useUpdateSystem(vineyardId);
  const [editing, setEditing] = useState<IrrigationSystem | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Irrigation systems</CardTitle>
          <CardDescription>Pumps, bores and controllers that feed your valves.</CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> New system
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {systems.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {systems.data?.length === 0 && (
          <div className="text-sm text-muted-foreground">No irrigation systems yet.</div>
        )}
        <div className="divide-y divide-border">
          {systems.data?.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  {!s.is_active && <Badge variant="outline">Inactive</Badge>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[s.water_source, s.controller_name].filter(Boolean).join(" · ") || "No details"}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(s);
                    setOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    update
                      .mutateAsync({ id: s.id, is_active: !s.is_active })
                      .catch((e: Error) =>
                        toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
                      )
                  }
                >
                  {s.is_active ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      {open && (
        <SystemDialog
          key={editing?.id ?? "new"}
          vineyardId={vineyardId}
          system={editing}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Valves
// ---------------------------------------------------------------------------

function ValveDialog({
  vineyardId,
  valve,
  systems,
  open,
  onOpenChange,
}: {
  vineyardId: string | null;
  valve: IrrigationValve | null;
  systems: IrrigationSystem[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useCreateValve(vineyardId);
  const update = useUpdateValve(vineyardId);
  const [systemId, setSystemId] = useState(valve?.irrigation_system_id ?? systems[0]?.id ?? "");
  const [name, setName] = useState(valve?.name ?? "");
  const [valveNumber, setValveNumber] = useState(valve?.valve_number ?? "");
  const [configured, setConfigured] = useState(
    valve?.configured_flow_litres_per_hour != null ? String(valve.configured_flow_litres_per_hour) : "",
  );
  const [measured, setMeasured] = useState(
    valve?.measured_flow_litres_per_hour != null ? String(valve.measured_flow_litres_per_hour) : "",
  );
  const busy = create.isPending || update.isPending;

  const save = async () => {
    try {
      if (valve) {
        await update.mutateAsync({
          id: valve.id,
          name,
          valve_number: valveNumber || null,
          configured_flow_litres_per_hour: num(configured),
          measured_flow_litres_per_hour: num(measured),
          clear_configured_flow: configured.trim() === "",
        });
      } else {
        await create.mutateAsync({
          irrigation_system_id: systemId,
          name,
          valve_number: valveNumber || null,
          configured_flow_litres_per_hour: num(configured),
          measured_flow_litres_per_hour: num(measured),
        });
      }
      toast({ title: valve ? "Valve updated" : "Valve added" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't save valve", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{valve ? "Edit valve" : "New valve"}</DialogTitle>
          <DialogDescription>
            The configured flow rate is the operational value used when recording with
            &ldquo;configured valve flow rate&rdquo;.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!valve && (
            <div>
              <Label>Irrigation system</Label>
              <Select value={systemId} onValueChange={setSystemId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a system" />
                </SelectTrigger>
                <SelectContent>
                  {systems.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="valve-name">Valve name</Label>
              <Input id="valve-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="valve-number">Valve number</Label>
              <Input
                id="valve-number"
                value={valveNumber}
                onChange={(e) => setValveNumber(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="valve-flow">Configured flow (L/hour)</Label>
              <Input
                id="valve-flow"
                inputMode="decimal"
                value={configured}
                onChange={(e) => setConfigured(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="valve-measured">Measured flow (L/hour)</Label>
              <Input
                id="valve-measured"
                inputMode="decimal"
                value={measured}
                onChange={(e) => setMeasured(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !name.trim() || (!valve && !systemId)}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ValvesTab({
  vineyardId,
  onConfigure,
}: {
  vineyardId: string | null;
  onConfigure: (valveId: string) => void;
}) {
  const systems = useIrrigationSystems(vineyardId);
  const valves = useIrrigationValves(vineyardId, true);
  const update = useUpdateValve(vineyardId);
  const [editing, setEditing] = useState<IrrigationValve | null>(null);
  const [open, setOpen] = useState(false);
  const valveIds = useMemo(() => (valves.data ?? []).map((v) => v.id), [valves.data]);
  const summaries = useValveConnectionSummaries(vineyardId, valveIds);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Valves</CardTitle>
          <CardDescription>Each valve waters one or more blocks.</CardDescription>
        </div>
        <Button
          size="sm"
          disabled={!systems.data?.length}
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> New valve
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {!systems.data?.length && (
          <PortalNotice
            compact
            variant="warning"
            description="Add an irrigation system before creating valves."
          />
        )}
        {valves.data?.length === 0 && (
          <div className="text-sm text-muted-foreground">No valves yet.</div>
        )}
        <div className="divide-y divide-border">
          {valves.data?.map((v) => {
            const s = summaries[v.id];
            const ready = valveIsReady(s);
            return (
              <div key={v.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{v.name}</span>
                    {!v.is_active && <Badge variant="outline">Inactive</Badge>}
                    <Badge variant="outline">
                      Allocation method: {s?.configured ? valveMethodText(s) : "None"}
                    </Badge>
                    <Badge variant="secondary">{valveConnectionsText(s)}</Badge>
                    <Badge variant={ready ? "default" : "outline"}>
                      {s?.loading
                        ? "Checking…"
                        : ready
                          ? "Ready to record"
                          : s?.configured
                            ? "Needs attention"
                            : "Setup required"}
                    </Badge>

                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {v.system_name} ·{" "}
                    {v.configured_flow_litres_per_hour != null
                      ? `${v.configured_flow_litres_per_hour} L/h configured`
                      : "No configured flow"}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" onClick={() => onConfigure(v.id)}>
                    Configure connections
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(v);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      update
                        .mutateAsync({ id: v.id, is_active: !v.is_active })
                        .catch((e: Error) =>
                          toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
                        )
                    }
                  >
                    {v.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      {open && (
        <ValveDialog
          key={editing?.id ?? "new"}
          vineyardId={vineyardId}
          valve={editing}
          systems={systems.data ?? []}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Connections (valve → blocks or valve → rows)
// ---------------------------------------------------------------------------

interface DraftRow extends ValveBlockInput {
  block_name: string;
  selected: boolean;
}

function pct(v: number | null | undefined, digits = 1) {
  return v == null ? "—" : `${Number(v).toFixed(digits)}%`;
}

/**
 * Renders a server estimate. Never shows a missing value as zero. A dirty draft
 * has no server figures yet, which is stated plainly rather than as an error.
 */
function estimateText(
  value: number | null | undefined,
  isEstimated: boolean | null | undefined,
  dirty: boolean,
): string {
  const text = formatEstimate(value ?? null, isEstimated ?? true);
  if (text != null) return text;
  return dirty ? "Recalculated on save" : "Not available";
}

/** Sums server block totals only when every block reports one. */
function sumSummary(
  summary: ServerRowSummary | null | undefined,
  key: "selected_vine_count" | "selected_emitter_count",
): number | null {
  if (!summary) return null;
  const blocks = Array.from(summary.blocks.values());
  if (blocks.length === 0 || blocks.some((b) => b[key] == null)) return null;
  return blocks.reduce((s, b) => s + Number(b[key]), 0);
}

/**
 * Saved-configuration estimate. The available total always shows; rows the
 * backend could not estimate are reported alongside it rather than collapsing
 * the whole figure to "Not available".
 */
function savedEstimate(
  total: number | null,
  isEstimated: boolean | null,
  rowsWithValue: number,
  rowsMissing: number,
  noun: string,
): { primary: string; secondary: string | null } {
  return savedEstimateLines(
    {
      total,
      rows_with_value: rowsWithValue,
      rows_missing: rowsMissing,
      is_estimated: isEstimated,
      basis: null,
    },
    rowsWithValue + rowsMissing,
    noun,
  );
}

/** Two-line estimate cell used in the saved-configuration surfaces. */
function SavedEstimate({
  lines,
  className,
}: {
  lines: { primary: string; secondary: string | null };
  className?: string;
}) {
  return (
    <span className={className}>
      <span className="tabular-nums">{lines.primary}</span>
      {lines.secondary && (
        <span className="block text-xs text-muted-foreground">{lines.secondary}</span>
      )}
    </span>
  );
}





/** Allocation method label for a valve's saved configuration. */
function valveMethodText(s: ValveConnectionSummary | undefined): string {
  if (!s || s.loading) return "…";
  if (!s.configured) return "—";
  if (s.uses_rows) return "Rows";
  return ALLOCATION_METHOD_LABEL[s.method ?? "manual_percentage"];
}

/** Connections count text — always includes the number, never a bare "Rows". */
function valveConnectionsText(s: ValveConnectionSummary | undefined): string {
  if (!s || s.loading) return "…";
  if (!s.configured) return "No connections";
  const blocks = `${s.block_count} block${s.block_count === 1 ? "" : "s"}`;
  if (s.uses_rows) {
    if (!s.row_count) return `No rows assigned · ${blocks}`;
    return `${s.row_count} row${s.row_count === 1 ? "" : "s"} · ${blocks}`;
  }
  return blocks;
}

/** Short combined status text used in dropdowns. */
function valveStatusText(s: ValveConnectionSummary | undefined): string {
  if (!s || s.loading) return "…";
  if (!s.configured) return "Not configured";
  return `${valveMethodText(s)} · ${valveConnectionsText(s)}`;
}

function valveReadinessText(s: ValveConnectionSummary | undefined): string {
  if (!s || s.loading) return "Checking…";
  if (!s.configured) return "Setup required";
  return valveIsReady(s) ? "Ready" : "Needs attention";
}


function valveIsReady(s: ValveConnectionSummary | undefined): boolean {
  if (!s || !s.configured) return false;
  if (s.uses_rows) return s.row_count > 0;
  return s.allocation_total != null && Math.abs(s.allocation_total - 100) <= 0.05;
}

function RowsConnection({
  vineyardId,
  valveId,
  guardChange,
  onDirtyChange,
}: {
  vineyardId: string | null;
  valveId: string;
  guardChange: (dirty: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const available = useAvailableRows(vineyardId, valveId);
  const linked = useValveRows(vineyardId, valveId);
  const savedBlocks = useValveBlocks(vineyardId, valveId);
  const save = useSetValveRows(vineyardId);
  const clear = useSetValveBlocks(vineyardId);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [result, setResult] = useState<SetValveRowsResult | null>(null);

  // Preselect exactly the linked row UUIDs (never inferred from row_start/end).
  useEffect(() => {
    if (!linked.data || loadedFor === valveId) return;
    setSelected(new Set(extractSelectedRowIds(linked.data)));
    setLoadedFor(valveId);
    onDirtyChange(false);
  }, [linked.data, valveId, loadedFor, onDirtyChange]);

  const savedIds = useMemo(
    () => new Set(extractSelectedRowIds(linked.data ?? [])),
    [linked.data],
  );
  const dirty =
    savedIds.size !== selected.size ||
    Array.from(selected).some((id) => !savedIds.has(id));

  useEffect(() => {
    onDirtyChange(dirty);
    guardChange(dirty);
  }, [dirty, onDirtyChange, guardChange]);

  const blocks = useMemo(
    () => normaliseAvailableRows(available.data, valveId),
    [available.data, valveId],
  );
  const allRows = useMemo(() => blocks.flatMap((b) => b.rows), [blocks]);
  const rowById = useMemo(
    () => new Map(allRows.map((r) => [r.row_id, r])),
    [allRows],
  );

  const draftRows = useMemo(
    () => Array.from(selected).map((id) => rowById.get(id)).filter(Boolean),
    [selected, rowById],
  );
  const savedRows = useMemo(
    () => Array.from(savedIds).map((id) => rowById.get(id)).filter(Boolean),
    [savedIds, rowById],
  );

  const shownRows = dirty ? draftRows : savedRows;
  const shownIds = dirty ? selected : savedIds;
  const missingLength = shownRows.filter((r) => r!.row_length_m == null);

  // Descriptive coverage per block for the currently shown selection.
  const coverageBlocks = useMemo(
    () =>
      blocks
        .map((b) => {
          const sel = b.rows.filter((r) => shownIds.has(r.row_id));
          return {
            block_id: b.block_id,
            block_name: b.block_name,
            selected: sel.length,
            total: b.rows.length,
            coverage: blockCoveragePercent(sel.length, b.rows.length),
            row_numbers: sel.map((r) => r.row_number),
          };
        })
        .filter((b) => b.selected > 0),
    [blocks, shownIds],
  );

  // Server-authoritative water share: the save response when previewing a fresh
  // save, otherwise the stored valve-block allocations.
  const waterShare = useMemo(() => {
    const map = new Map<string, number | null>();
    if (result?.blocks) {
      for (const b of result.blocks) map.set(String(b.block_id), b.allocation_percentage ?? null);
      return map;
    }
    for (const b of savedBlocks.data ?? []) {
      if (b.is_active === false) continue;
      map.set(String(b.block_id), b.allocation_percentage);
    }
    return map;
  }, [result, savedBlocks.data]);

  // Server row summaries. Saved state is reloaded from
  // list_irrigation_valve_rows; the save response is only a fallback. A dirty
  // draft has no server summary, so nothing authoritative is shown for it.
  const savedSummary = useMemo(
    () => normaliseServerRowSummary(linked.data),
    [linked.data],
  );
  // SQL 129 saved snapshots: each saved row carries the backend's own vine and
  // emitter figure, so the totals below are those server values added up.
  const savedRowSnapshot = useMemo(() => summariseSavedRows(linked.data), [linked.data]);
  const resultSummary = useMemo(
    () => (result ? normaliseServerRowSummary(result) : null),
    [result],
  );
  const shownSummary: ServerRowSummary | null = dirty
    ? null
    : savedSummary.blocks.size > 0
      ? savedSummary
      : resultSummary;

  const savedBlockTotals = useMemo(() => {
    const map = new Map<string, { vines: number | null; emitters: number | null }>();
    for (const b of savedBlocks.data ?? []) {
      if (b.is_active === false) continue;
      map.set(String(b.block_id), {
        vines: b.serviced_vine_count ?? null,
        emitters: b.serviced_emitter_count ?? null,
      });
    }
    return map;
  }, [savedBlocks.data]);

  const serverBasis =
    savedSummary.weighting_basis ??
    savedRowSnapshot.weighting_basis ??
    result?.weighting_basis ??
    (savedBlocks.data ?? []).find((b) => b.weighting_basis)?.weighting_basis ??
    null;

  /** Blocks that already hold saved rows — these open expanded in the selector. */
  const savedBlockIds = useMemo(
    () => Array.from(savedRowSnapshot.blocks.keys()),
    [savedRowSnapshot],
  );


  const submit = async () => {
    try {
      const res = await save.mutateAsync({
        valve_id: valveId,
        row_ids: Array.from(selected),
      });
      setResult(res ?? null);
      setLoadedFor(null);
      await Promise.all([linked.refetch(), savedBlocks.refetch()]);
      toast({ title: "Valve rows saved" });
    } catch (e) {
      toast({
        title: "Couldn't save rows",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  /** Discards the unsaved selection only — the saved configuration is untouched. */
  const resetDraft = () => {
    setSelected(new Set(savedIds));
    setResult(null);
    onDirtyChange(false);
  };

  /**
   * Destructive: removes the valve's saved row configuration on the server.
   * Verified against SQL 126/129 — `set_irrigation_valve_rows` with an empty
   * `p_row_ids` clears both the saved rows and their block allocations.
   */
  const deleteConnection = async () => {
    if (
      !window.confirm(
        "Delete this valve's saved connection? The valve will not be able to record sessions until it is configured again. Existing irrigation records keep their own snapshot and are unaffected.",
      )
    )
      return;
    try {
      // Rows are the authoritative link; clearing block allocations alone left
      // every saved row still connected (and ticked after a reload).
      await save.mutateAsync({ valve_id: valveId, row_ids: [] });
      await clear.mutateAsync({ valve_id: valveId, blocks: [] });
      setResult(null);
      setSelected(new Set());
      const [refreshed] = await Promise.all([
        linked.refetch(),
        savedBlocks.refetch(),
      ]);
      // Re-run the preselect effect against the freshly cleared server state.
      setSelected(new Set(extractSelectedRowIds(refreshed.data ?? [])));
      setLoadedFor(valveId);
      onDirtyChange(false);
      toast({ title: "Connection deleted" });
    } catch (e) {
      toast({
        title: "Couldn't delete the connection",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  const warnings = Array.from(
    new Set([...(result?.warnings ?? []), ...savedSummary.warnings]),
  ).filter(Boolean);

  const totalRows = allRows.length;
  // The vineyard row list can fail independently of the saved configuration
  // (e.g. a backend function error). Never present that as "0 mapped rows".
  const rowsUnavailable = !!available.error || (available.isLoading && totalRows === 0);
  const mappedText = rowsUnavailable
    ? "vineyard row list unavailable"
    : `${totalRows} mapped rows across the vineyard`;


  const savedVineLines = savedEstimate(
    savedRowSnapshot.vines.total,
    savedRowSnapshot.vines.is_estimated,
    savedRowSnapshot.vines.rows_with_value,
    savedRowSnapshot.vines.rows_missing,
    "vines",
  );
  const savedEmitterLines = savedEstimate(
    savedRowSnapshot.emitters.total,
    savedRowSnapshot.emitters.is_estimated,
    savedRowSnapshot.emitters.rows_with_value,
    savedRowSnapshot.emitters.rows_missing,
    "emitters",
  );

  return (
    <div className="space-y-4">
      <ValveRowSelector
        payload={available.data}
        currentValveId={valveId}
        selected={selected}
        onChange={setSelected}
        loading={available.isLoading || linked.isLoading}
        error={(available.error as Error) ?? (linked.error as Error) ?? null}
        weightingBasis={serverBasis}
        expandedBlockIds={savedBlockIds}
      />

      {linked.error && (
        <PortalNotice
          variant="error"
          title="Couldn't load the valve's saved rows"
          description={(linked.error as Error).message}
        />
      )}

      {/* Saved configuration and unsaved draft are deliberately kept apart:
          deleting the saved connection is a server change, resetting the draft
          only discards the current selection. */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Saved connection</span>
            <Badge variant={savedIds.size > 0 ? "secondary" : "outline"}>
              {savedIds.size > 0 ? "Saved" : "Not configured"}
            </Badge>
          </div>
          <div className="text-sm">
            <strong className="tabular-nums">
              {savedIds.size} row{savedIds.size === 1 ? "" : "s"}
            </strong>{" "}
            <span className="text-muted-foreground">of {mappedText}</span>
          </div>
          {savedIds.size > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {savedVineLines.primary} · {savedEmitterLines.primary}
              {(savedVineLines.secondary || savedEmitterLines.secondary) && (
                <span className="block">
                  {savedVineLines.secondary ?? savedEmitterLines.secondary}
                </span>
              )}
            </div>
          )}
          <div className="mt-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={deleteConnection}
              disabled={savedIds.size === 0 || save.isPending || clear.isPending}
            >
              {clear.isPending ? "Deleting…" : "Delete connection"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Draft selection</span>
            <Badge variant={dirty ? "outline" : "secondary"}>
              {dirty ? "Unsaved changes" : "Matches saved"}
            </Badge>
          </div>
          <div className="text-sm">
            <strong className="tabular-nums">
              {selected.size} row{selected.size === 1 ? "" : "s"} selected
            </strong>{" "}
            <span className="text-muted-foreground">
              ({rowsUnavailable ? mappedText : `of ${totalRows} mapped rows`})
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={resetDraft} disabled={!dirty}>
              Reset draft
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={save.isPending || selected.size === 0 || !dirty}
            >
              {save.isPending ? "Saving…" : "Save connections"}
            </Button>
          </div>
        </div>
      </div>

      {selected.size === 0 && (
        <PortalNotice
          compact
          variant="warning"
          description={
            savedIds.size > 0
              ? "No rows are selected in the draft. The saved connection is still active — use Reset draft to bring back the saved rows, or Delete connection to remove it from this valve."
              : "Tick the rows this valve waters, then choose Save connections."
          }
        />
      )}

      {missingLength.length > 0 && (
        <PortalNotice
          compact
          variant="warning"
          description={`${missingLength.length} selected row${
            missingLength.length === 1 ? " has" : "s have"
          } no mapped length. The allocation may use equal-row weighting unless complete row lengths are available for every selected row.`}
        />
      )}

      {warnings.length > 0 && (
        <PortalNotice
          variant="warning"
          title="Allocation warnings"
          description={
            <ul className="list-disc pl-4">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          }
        />
      )}

      <div className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">
            {dirty ? "Unsaved preview" : "Current saved configuration"}
          </span>
          <Badge variant={dirty ? "outline" : "secondary"}>
            {dirty ? "Draft — not saved" : "Saved"}
          </Badge>
        </div>
        <div className="text-sm">
          Allocation method: <strong>Rows</strong>
          {" · "}Rows:{" "}
          <strong className="tabular-nums">
            {shownIds.size} row{shownIds.size === 1 ? "" : "s"}
          </strong>{" "}
          <span className="text-muted-foreground">of {mappedText}</span>
          {" · "}Blocks supplied:{" "}
          <strong className="tabular-nums">{coverageBlocks.length}</strong>
          {" · "}Allocation basis: <strong>{weightingBasisLabel(serverBasis)}</strong>
        </div>
        <div className="flex flex-wrap gap-x-6 text-sm">
          <span>
            <span className="text-muted-foreground">Estimated vines: </span>
            {dirty ? (
              <strong>Recalculated on save</strong>
            ) : (
              <SavedEstimate
                className="font-semibold"
                lines={savedEstimate(
                  shownSummary?.selected_vine_count ??
                    sumSummary(shownSummary, "selected_vine_count") ??
                    savedRowSnapshot.vines.total,
                  shownSummary?.vine_count_is_estimated ?? savedRowSnapshot.vines.is_estimated,
                  savedRowSnapshot.vines.rows_with_value,
                  savedRowSnapshot.vines.rows_missing,
                  "vines",
                )}
              />
            )}
          </span>
          <span>
            <span className="text-muted-foreground">Estimated emitters: </span>
            {dirty ? (
              <strong>Recalculated on save</strong>
            ) : (
              <SavedEstimate
                className="font-semibold"
                lines={savedEstimate(
                  shownSummary?.selected_emitter_count ??
                    sumSummary(shownSummary, "selected_emitter_count") ??
                    savedRowSnapshot.emitters.total,
                  shownSummary?.emitter_count_is_estimated ??
                    savedRowSnapshot.emitters.is_estimated,
                  savedRowSnapshot.emitters.rows_with_value,
                  savedRowSnapshot.emitters.rows_missing,
                  "emitters",
                )}
              />
            )}
          </span>
        </div>
        {shownRows.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {dirty ? "Draft rows" : "Saved rows"}:{" "}
            {formatRowRanges(shownRows.map((r) => r!.row_number))}
          </div>
        )}


        <div className="rounded-lg border border-border">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(6,minmax(0,110px))] gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Block</span>
            <span className="text-right">Selected rows</span>
            <span className="text-right">Estimated vines</span>
            <span className="text-right">Estimated emitters</span>
            <span className="text-right">Row coverage</span>
            <span className="text-right">Length coverage</span>
            <span className="text-right">Share of valve water</span>
          </div>
          {coverageBlocks.map((b) => {
            const srv = shownSummary?.blocks.get(b.block_id) ?? null;
            const snap = dirty ? null : savedRowSnapshot.blocks.get(b.block_id) ?? null;
            const servicedBlock = dirty ? null : savedBlockTotals.get(b.block_id) ?? null;
            const vineLines = snap
              ? savedEstimate(
                  srv?.selected_vine_count ?? servicedBlock?.vines ?? snap.vines.total,
                  srv?.vine_count_is_estimated ?? snap.vines.is_estimated,
                  snap.vines.rows_with_value,
                  snap.vines.rows_missing,
                  "vines",
                )
              : null;
            const emitterLines = snap
              ? savedEstimate(
                  srv?.selected_emitter_count ?? servicedBlock?.emitters ?? snap.emitters.total,
                  srv?.emitter_count_is_estimated ?? snap.emitters.is_estimated,
                  snap.emitters.rows_with_value,
                  snap.emitters.rows_missing,
                  "emitters",
                )
              : null;
            return (
              <div
                key={b.block_id}
                className="grid grid-cols-[minmax(0,1fr)_repeat(6,minmax(0,110px))] gap-2 border-b border-border px-3 py-1.5 text-sm last:border-0"
              >
                <span className="truncate">{b.block_name}</span>
                <span className="text-right tabular-nums">
                  {b.selected} of {srv?.total_block_row_count ?? b.total}
                </span>
                <span className="text-right tabular-nums">
                  {vineLines ? (
                    <SavedEstimate lines={vineLines} />
                  ) : (
                    estimateText(srv?.selected_vine_count ?? null, srv?.vine_count_is_estimated ?? true, dirty)
                  )}
                </span>
                <span className="text-right tabular-nums">
                  {emitterLines ? (
                    <SavedEstimate lines={emitterLines} />
                  ) : (
                    estimateText(srv?.selected_emitter_count ?? null, srv?.emitter_count_is_estimated ?? true, dirty)
                  )}
                </span>
                <span className="text-right tabular-nums">
                  {pct(srv?.row_coverage_percent ?? b.coverage)}
                </span>
                <span className="text-right tabular-nums">
                  {srv?.length_coverage_percent == null
                    ? dirty
                      ? "Recalculated on save"
                      : "Not available"
                    : pct(srv.length_coverage_percent)}
                </span>
                <span className="text-right tabular-nums">
                  {dirty ? (
                    <span className="text-muted-foreground">Recalculated on save</span>
                  ) : (
                    pct(srv?.allocation_percentage ?? waterShare.get(b.block_id) ?? null, 2)
                  )}
                </span>
              </div>
            );
          })}
          {coverageBlocks.length === 0 && (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              No connections configured.
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Vine and emitter figures are the estimates stored by the vineyard backend against each
          saved row; they do not change the allocation basis. Share of valve water and length
          coverage are server-calculated. An unsaved draft has no server figures until it is saved.
        </p>
      </div>
    </div>
  );
}


function ConnectionsOverview({
  valves,
  summaries,
  selectedValveId,
  onSelect,
}: {
  valves: IrrigationValve[];
  summaries: Record<string, ValveConnectionSummary>;
  selectedValveId: string;
  onSelect: (id: string) => void;
}) {
  if (valves.length === 0) return null;
  const cols =
    "grid w-full grid-cols-[auto_minmax(0,1.2fr)_minmax(0,140px)_minmax(0,1fr)_minmax(0,130px)] items-center gap-2 md:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,130px)_minmax(0,1fr)_minmax(0,110px)_minmax(0,110px)_minmax(0,120px)]";
  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Configured valves
      </div>
      <div
        className={`${cols} border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}
      >
        <span />
        <span>Valve</span>
        <span>Allocation method</span>
        <span>Connections</span>
        <span className="hidden md:block">Estimated vines</span>
        <span className="hidden md:block">Estimated emitters</span>
        <span>Status</span>
      </div>
      {valves.map((v) => {
        const s = summaries[v.id];
        const ready = valveIsReady(s);
        const vines = s?.uses_rows
          ? savedEstimate(
              s.estimated_vine_count,
              s.vine_count_is_estimated,
              s.rows_with_vine_estimate,
              s.rows_missing_vine_estimate,
              "vines",
            )
          : null;
        const emitters = s?.uses_rows
          ? savedEstimate(
              s.estimated_emitter_count,
              s.emitter_count_is_estimated,
              s.rows_with_emitter_estimate,
              s.rows_missing_emitter_estimate,
              "emitters",
            )
          : null;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v.id)}
            className={`${cols} border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/40 ${
              v.id === selectedValveId ? "bg-sidebar-accent" : ""
            }`}
          >
            {ready ? (
              <Check className="h-4 w-4 text-primary" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="truncate font-medium">{v.name}</span>
            <span className="truncate text-xs text-muted-foreground">{valveMethodText(s)}</span>
            <span className="truncate text-xs text-muted-foreground">
              {valveConnectionsText(s)}
              {vines && emitters && (
                <span className="block tabular-nums md:hidden">
                  {vines.primary} · {emitters.primary}
                  {vines.secondary && <span className="block">{vines.secondary}</span>}
                </span>
              )}
            </span>
            <span className="hidden text-xs tabular-nums text-muted-foreground md:block">
              {vines ? <SavedEstimate lines={vines} /> : "—"}
            </span>
            <span className="hidden text-xs tabular-nums text-muted-foreground md:block">
              {emitters ? <SavedEstimate lines={emitters} /> : "—"}
            </span>
            <span className="truncate text-xs">
              <Badge variant={ready ? "secondary" : "outline"}>{valveReadinessText(s)}</Badge>
            </span>

          </button>
        );
      })}
    </div>
  );
}


function ConnectionsTab({
  vineyardId,
  focusValveId,
}: {
  vineyardId: string | null;
  focusValveId?: string | null;
}) {
  const valves = useIrrigationValves(vineyardId);
  const blocks = useBlocks(vineyardId);
  const [valveId, setValveId] = useState<string>("");
  const existing = useValveBlocks(vineyardId, valveId || null);
  const save = useSetValveBlocks(vineyardId);
  const [method, setMethod] = useState<AllocationMethod>("manual_percentage");
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [rowsDirty, setRowsDirty] = useState(false);

  const valveIds = useMemo(() => (valves.data ?? []).map((v) => v.id), [valves.data]);
  const summaries = useValveConnectionSummaries(vineyardId, valveIds);
  const currentSummary = valveId ? summaries[valveId] : undefined;

  const confirmDiscard = () =>
    !rowsDirty || window.confirm("You have unsaved row changes. Discard them?");

  const selectValve = (id: string) => {
    if (!confirmDiscard()) return;
    setRowsDirty(false);
    setValveId(id);
    setLoadedFor(null);
  };

  // Open with the valve requested from the Valves tab.
  useEffect(() => {
    if (focusValveId && focusValveId !== valveId) {
      setRowsDirty(false);
      setValveId(focusValveId);
      setLoadedFor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusValveId]);

  // Follow the saved allocation method when a valve is selected.
  useEffect(() => {
    const s = valveId ? summaries[valveId] : undefined;
    if (s && s.configured && s.method) setMethod(s.uses_rows ? "rows" : s.method);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valveId, currentSummary?.configured, currentSummary?.method, currentSummary?.uses_rows]);

  // Seed the draft from the saved configuration whenever the valve changes.
  if (valveId && existing.data && loadedFor !== valveId) {
    const next: Record<string, DraftRow> = {};
    for (const b of blocks.data ?? []) {
      const saved = existing.data.find((e) => e.block_id === b.id);
      next[b.id] = {
        block_id: b.id,
        block_name: b.name ?? "Block",
        selected: !!saved,
        allocation_method: (saved?.allocation_method as AllocationMethod) ?? "manual_percentage",
        allocation_percentage: saved?.allocation_percentage ?? null,
        serviced_area_m2: saved?.serviced_area_m2 ?? null,
        serviced_vine_count: saved?.serviced_vine_count ?? null,
        serviced_emitter_count: saved?.serviced_emitter_count ?? null,
      };
    }
    setDraft(next);
    setLoadedFor(valveId);
  }

  const rows = useMemo(() => Object.values(draft), [draft]);
  const selected = rows.filter((r) => r.selected);
  const percentTotal = selected.reduce((sum, r) => sum + (r.allocation_percentage ?? 0), 0);
  const manual = method === "manual_percentage";
  const rowsMode = method === "rows";

  const patch = (id: string, values: Partial<DraftRow>) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], ...values } }));

  const submit = async () => {
    try {
      await save.mutateAsync({
        valve_id: valveId,
        blocks: selected.map((r) => ({
          block_id: r.block_id,
          allocation_method: method,
          allocation_percentage: manual ? r.allocation_percentage : null,
          serviced_area_m2: r.serviced_area_m2 ?? null,
          serviced_vine_count: r.serviced_vine_count ?? null,
          serviced_emitter_count: r.serviced_emitter_count ?? null,
        })),
      });
      toast({ title: "Valve connections saved" });
      setLoadedFor(null);
    } catch (e) {
      toast({
        title: "Couldn't save connections",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Valve to block or valve to row connections</CardTitle>
        <CardDescription>
          Allocations decide how each session&rsquo;s water is split between blocks. Saving
          replaces the active configuration; existing records keep their own snapshot.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ConnectionsOverview
          valves={valves.data ?? []}
          summaries={summaries}
          selectedValveId={valveId}
          onSelect={selectValve}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Valve</Label>
            <Select value={valveId} onValueChange={selectValve}>
              <SelectTrigger>
                <SelectValue placeholder="Select a valve" />
              </SelectTrigger>
              <SelectContent>
                {valves.data?.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name} · {valveStatusText(summaries[v.id])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Allocation method</Label>
            <Select
              value={method}
              onValueChange={(v) => {
                if (!confirmDiscard()) return;
                setRowsDirty(false);
                setMethod(v as AllocationMethod);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ALLOCATION_METHOD_LABEL) as AllocationMethod[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {ALLOCATION_METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {valveId && (
          <div className="rounded-lg border border-border px-3 py-2 text-sm">
            <div className="mb-1 font-semibold">Current configuration</div>
            {!currentSummary || currentSummary.loading ? (
              <div className="text-muted-foreground">Loading…</div>
            ) : !currentSummary.configured ? (
              <div className="text-muted-foreground">No connections configured</div>
            ) : (
              <>
                <dl className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">Method: </span>
                    {valveMethodText(currentSummary)}
                  </div>
                  {currentSummary.uses_rows && (
                    <div>
                      <span className="text-muted-foreground">Rows: </span>
                      <span className="tabular-nums">{currentSummary.row_count}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Blocks: </span>
                    <span className="tabular-nums">{currentSummary.block_count}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Allocation basis: </span>
                    {weightingBasisLabel(currentSummary.weighting_basis)}
                  </div>
                  {currentSummary.uses_rows && (
                    <>
                      <div>
                        <span className="text-muted-foreground">Estimated vines: </span>
                        <SavedEstimate
                          lines={savedEstimate(
                            currentSummary.estimated_vine_count,
                            currentSummary.vine_count_is_estimated,
                            currentSummary.rows_with_vine_estimate,
                            currentSummary.rows_missing_vine_estimate,
                            "vines",
                          )}
                        />
                      </div>
                      <div>
                        <span className="text-muted-foreground">Estimated emitters: </span>
                        <SavedEstimate
                          lines={savedEstimate(
                            currentSummary.estimated_emitter_count,
                            currentSummary.emitter_count_is_estimated,
                            currentSummary.rows_with_emitter_estimate,
                            currentSummary.rows_missing_emitter_estimate,
                            "emitters",
                          )}
                        />
                      </div>
                    </>
                  )}

                  {currentSummary.last_saved && (
                    <div>
                      <span className="text-muted-foreground">Last saved: </span>
                      {new Date(currentSummary.last_saved).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </div>
                  )}
                </dl>
                {currentSummary.uses_rows && currentSummary.row_numbers.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Saved rows: {formatRowRanges(currentSummary.row_numbers)}
                  </div>
                )}
              </>

            )}
          </div>
        )}

        {valveId && rowsMode && (
          <RowsConnection
            key={valveId}
            vineyardId={vineyardId}
            valveId={valveId}
            guardChange={setRowsDirty}
            onDirtyChange={setRowsDirty}
          />
        )}

        {valveId && !rowsMode && (
          <>
            <div className="rounded-lg border border-border">
              <div className="grid grid-cols-[auto_1fr_repeat(3,minmax(0,120px))] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span />
                <span>Block</span>
                <span>%</span>
                <span>Vines</span>
                <span>Emitters</span>
              </div>
              {rows.map((r) => (
                <div
                  key={r.block_id}
                  className="grid grid-cols-[auto_1fr_repeat(3,minmax(0,120px))] items-center gap-2 border-b border-border px-3 py-2 last:border-0"
                >
                  <Checkbox
                    checked={r.selected}
                    onCheckedChange={(c) => patch(r.block_id, { selected: !!c })}
                    aria-label={`Include ${r.block_name}`}
                  />
                  <span className="truncate text-sm">{r.block_name}</span>
                  <Input
                    inputMode="decimal"
                    disabled={!r.selected || !manual}
                    value={r.allocation_percentage ?? ""}
                    onChange={(e) =>
                      patch(r.block_id, { allocation_percentage: num(e.target.value) })
                    }
                    className="h-8"
                  />
                  <Input
                    inputMode="numeric"
                    disabled={!r.selected}
                    value={r.serviced_vine_count ?? ""}
                    onChange={(e) =>
                      patch(r.block_id, { serviced_vine_count: num(e.target.value) })
                    }
                    className="h-8"
                  />
                  <Input
                    inputMode="numeric"
                    disabled={!r.selected}
                    value={r.serviced_emitter_count ?? ""}
                    onChange={(e) =>
                      patch(r.block_id, { serviced_emitter_count: num(e.target.value) })
                    }
                    className="h-8"
                  />
                </div>
              ))}
            </div>

            {manual && selected.length > 0 && Math.abs(percentTotal - 100) > 0.05 && (
              <PortalNotice
                compact
                variant="warning"
                description={`Allocations total ${percentTotal.toFixed(2)}% — they must add up to 100% before this valve can record sessions.`}
              />
            )}
            {!manual && (
              <PortalNotice
                compact
                variant="info"
                description="Percentages are derived on the server from the selected measure. Leave the % column blank."
              />
            )}

            <div className="flex justify-end">
              <Button onClick={submit} disabled={save.isPending || selected.length === 0}>
                {save.isPending ? "Saving…" : "Save connections"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export default function IrrigationSetupPage() {
  const { selectedVineyardId } = useVineyard();
  const status = useSetupStatus(selectedVineyardId);
  const [tab, setTab] = useState("systems");
  const [focusValveId, setFocusValveId] = useState<string | null>(null);

  const configureValve = (valveId: string) => {
    setFocusValveId(valveId);
    setTab("connections");
  };

  return (
    <div className="space-y-6">
      <PageHead
        title="Irrigation Setup | VineTrack"
        description="Configure irrigation systems, valves and valve-to-block or valve-to-row connections."
        path="/irrigation/setup"
        noindex
      />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to="/irrigation">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Irrigation Records
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Irrigation setup</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Systems, valves, and valve-to-block or valve-to-row connections.
          </p>
        </div>
        {status.data && (
          <Badge variant={status.data.is_operational ? "default" : "secondary"}>
            {status.data.is_operational ? "Ready to record" : "Setup incomplete"}
          </Badge>
        )}
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="systems">Systems</TabsTrigger>
          <TabsTrigger value="valves">Valves</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
        </TabsList>
        <TabsContent value="systems" className="mt-4">
          <SystemsTab vineyardId={selectedVineyardId} />
        </TabsContent>
        <TabsContent value="valves" className="mt-4">
          <ValvesTab vineyardId={selectedVineyardId} onConfigure={configureValve} />
        </TabsContent>
        <TabsContent value="connections" className="mt-4">
          <ConnectionsTab vineyardId={selectedVineyardId} focusValveId={focusValveId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
