import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAdminVineyards, type AdminPaddock } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty } from "./_shared";
import {
  diagnoseVineyard,
  buildTextReport,
  toCsv,
  type BlockDiagnostic,
  type Severity,
  type Category,
} from "@/lib/blockDiagnostics";
import { ExternalLink, Copy, Download, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type ScopeMode = "all" | "issues" | "selected";

const sevColor: Record<Severity, string> = {
  critical: "bg-red-500/15 text-red-600 border-red-500/30",
  warning: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  info: "bg-blue-500/15 text-blue-600 border-blue-500/30",
};

function SeverityBadge({ s }: { s: Severity }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${sevColor[s]}`}>
      {s}
    </span>
  );
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyText(text: string, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: label });
  } catch {
    toast({ title: "Copy failed", variant: "destructive" });
  }
}

export default function BlockTroubleshooterPage() {
  const { user } = useAuth();
  const vineyardsQ = useAdminVineyards();
  const vineyards = vineyardsQ.data ?? [];

  const [vineyardId, setVineyardId] = useState<string>("");
  const [scope, setScope] = useState<ScopeMode>("selected");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [runAll, setRunAll] = useState(false);
  const [selected, setSelected] = useState<BlockDiagnostic | null>(null);

  const targetVineyards = useMemo(() => {
    if (scope === "selected") return vineyards.filter((v) => v.id === vineyardId);
    return vineyards;
  }, [vineyards, vineyardId, scope]);

  const paddockQueries = useQueries({
    queries: targetVineyards.map((v) => ({
      queryKey: ["admin", "paddocks", v.id],
      enabled: !!v.id && (scope === "selected" ? !!vineyardId : runAll),
      staleTime: 30_000,
      queryFn: async () => {
        const { data, error } = await (iosSupabase as any).rpc("admin_list_vineyard_paddocks", {
          p_vineyard_id: v.id,
        });
        if (error) throw error;
        return (data ?? []) as AdminPaddock[];
      },
    })),
  });

  const diagnostics = useMemo<BlockDiagnostic[]>(() => {
    const out: BlockDiagnostic[] = [];
    targetVineyards.forEach((v, i) => {
      const list = (paddockQueries[i]?.data ?? []) as AdminPaddock[];
      out.push(...diagnoseVineyard(v.id, v.name, list));
    });
    return out;
  }, [targetVineyards, paddockQueries]);

  const summary = useMemo(() => {
    const blocksWithIssues = diagnostics.filter((d) => d.issues.length > 0);
    const counts = {
      vineyards: new Set(diagnostics.map((d) => d.vineyardId)).size,
      blocks: diagnostics.length,
      blocksWithIssues: blocksWithIssues.length,
      missingGeometry: 0,
      invalidGeometry: 0,
      missingRows: 0,
      rowNumbering: 0,
      irrigation: 0,
    };
    diagnostics.forEach((d) => {
      d.issues.forEach((i) => {
        if (i.code === "no_polygon") counts.missingGeometry++;
        if (i.code === "invalid_vertices" || i.code === "too_few_points") counts.invalidGeometry++;
        if (i.code === "no_rows") counts.missingRows++;
        if (
          i.code === "row_count_mismatch" ||
          i.code === "duplicate_row_numbers" ||
          i.code === "missing_row_numbers" ||
          i.code === "row_number_order" ||
          i.code === "row_gaps"
        )
          counts.rowNumbering++;
        if (i.category === "irrigation") counts.irrigation++;
      });
    });
    return counts;
  }, [diagnostics]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return diagnostics.filter((d) => {
      if (scope === "issues" && d.issues.length === 0) return false;
      if (q && !d.paddock.name?.toLowerCase().includes(q) && !d.vineyardName.toLowerCase().includes(q)) return false;
      if (severityFilter !== "all" && !d.issues.some((i) => i.severity === severityFilter)) return false;
      if (categoryFilter !== "all" && !d.issues.some((i) => i.category === categoryFilter)) return false;
      return true;
    });
  }, [diagnostics, search, severityFilter, categoryFilter, scope]);

  const scopeLabel =
    scope === "selected"
      ? vineyards.find((v) => v.id === vineyardId)?.name ?? "(no vineyard)"
      : scope === "issues"
        ? "All vineyards (issues only)"
        : "All vineyards";

  const loading = paddockQueries.some((q) => q.isFetching);
  const refetchAll = () => paddockQueries.forEach((q) => q.refetch());

  const noVineyardSelected = scope === "selected" && !vineyardId;
  const needRunAll = scope !== "selected" && !runAll;

  return (
    <AdminGate>
      <AdminPageHeader
        title="Block Setup Troubleshooter"
        subtitle="Read-only diagnostics for blocks, polygons, rows, and irrigation."
      />
      <AdminError error={vineyardsQ.error} />

      <Card className="p-4 space-y-3 mb-4">
        <div className="grid sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <Label className="text-xs">Vineyard</Label>
            <Select value={vineyardId} onValueChange={setVineyardId}>
              <SelectTrigger><SelectValue placeholder="Select a vineyard…" /></SelectTrigger>
              <SelectContent className="max-h-80">
                {vineyards.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Scope</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as ScopeMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="selected">Selected vineyard</SelectItem>
                <SelectItem value="all">All vineyards</SelectItem>
                <SelectItem value="issues">Only vineyards with issues</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            {scope !== "selected" && !runAll && (
              <Button onClick={() => setRunAll(true)} className="w-full">Run diagnostics</Button>
            )}
            {(scope === "selected" || runAll) && (
              <Button variant="outline" onClick={refetchAll} className="w-full">
                <RefreshCw className="h-4 w-4" /> Refresh
              </Button>
            )}
          </div>
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          <Input placeholder="Filter by block or vineyard…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="identity">Identity</SelectItem>
              <SelectItem value="geometry">Geometry</SelectItem>
              <SelectItem value="rows">Rows</SelectItem>
              <SelectItem value="irrigation">Irrigation</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => copyText(buildTextReport(scopeLabel, visible, user?.email), "Report copied")}>
              <Copy className="h-4 w-4" /> Copy report
            </Button>
            <Button variant="outline" onClick={() => download(`block-diagnostics-${Date.now()}.csv`, toCsv(visible), "text/csv")}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" onClick={() => download(`block-diagnostics-${Date.now()}.json`, JSON.stringify(visible, null, 2), "application/json")}>
              <Download className="h-4 w-4" /> JSON
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
        <SummaryCard label="Vineyards" value={summary.vineyards} />
        <SummaryCard label="Blocks" value={summary.blocks} />
        <SummaryCard label="With issues" value={summary.blocksWithIssues} />
        <SummaryCard label="Missing polygon" value={summary.missingGeometry} />
        <SummaryCard label="Invalid polygon" value={summary.invalidGeometry} />
        <SummaryCard label="Missing rows" value={summary.missingRows} />
        <SummaryCard label="Row numbering" value={summary.rowNumbering} />
        <SummaryCard label="Irrigation" value={summary.irrigation} />
      </div>

      {noVineyardSelected && (
        <AdminEmpty>Select a vineyard to run diagnostics.</AdminEmpty>
      )}
      {needRunAll && !noVineyardSelected && (
        <AdminEmpty>Click "Run diagnostics" to scan all vineyards.</AdminEmpty>
      )}

      {!noVineyardSelected && !needRunAll && (
        <Card className="overflow-hidden">
          {loading && <div className="p-3 text-sm text-muted-foreground">Running diagnostics…</div>}
          {!loading && visible.length === 0 && (
            <AdminEmpty>No block setup issues found for the selected scope.</AdminEmpty>
          )}
          {visible.length > 0 && (
            <div className="divide-y">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground bg-muted/40">
                <div className="col-span-3">Vineyard / Block</div>
                <div className="col-span-1">Sev</div>
                <div className="col-span-2">Category</div>
                <div className="col-span-4">Issue</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>
              {visible.flatMap((d) =>
                (d.issues.length ? d.issues : [{ severity: "info", category: "identity", code: "ok", summary: "No issues" } as any]).map(
                  (i, idx) => (
                    <button
                      key={`${d.paddock.id}-${idx}`}
                      onClick={() => setSelected(d)}
                      className="w-full grid grid-cols-12 gap-2 items-center px-3 py-2 text-sm text-left hover:bg-accent/40"
                    >
                      <div className="col-span-3 min-w-0">
                        <div className="font-medium truncate">{d.paddock.name || "(unnamed)"}</div>
                        <div className="text-xs text-muted-foreground truncate">{d.vineyardName}</div>
                      </div>
                      <div className="col-span-1"><SeverityBadge s={i.severity} /></div>
                      <div className="col-span-2 capitalize">{i.category}</div>
                      <div className="col-span-4 truncate">
                        {i.summary}
                        {i.detail && <span className="text-xs text-muted-foreground"> — {i.detail}</span>}
                      </div>
                      <div className="col-span-2 flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/blocks/${d.paddock.id}`} target="_blank">
                            <ExternalLink className="h-3.5 w-3.5" /> Block
                          </Link>
                        </Button>
                      </div>
                    </button>
                  ),
                ),
              )}
            </div>
          )}
        </Card>
      )}

      <DetailSheet diagnostic={selected} onClose={() => setSelected(null)} />
    </AdminGate>
  );
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </Card>
  );
}

function DetailSheet({
  diagnostic,
  onClose,
}: {
  diagnostic: BlockDiagnostic | null;
  onClose: () => void;
}) {
  if (!diagnostic) return null;
  const d = diagnostic;
  const g = d.geometryStats;
  const r = d.rowStats;
  const ir = d.irrigationStats;
  const report = buildTextReport(`${d.vineyardName} / ${d.paddock.name}`, [d]);
  return (
    <Sheet open={!!diagnostic} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{d.paddock.name || "(unnamed block)"}</SheetTitle>
          <SheetDescription>{d.vineyardName}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 mt-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to={`/blocks/${d.paddock.id}`} target="_blank"><ExternalLink className="h-3.5 w-3.5" /> Block Detail</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={`/setup/paddocks/${d.paddock.id}`} target="_blank"><ExternalLink className="h-3.5 w-3.5" /> Setup</Link>
            </Button>
            <Button size="sm" variant="outline" onClick={() => copyText(report, "Block report copied")}>
              <Copy className="h-3.5 w-3.5" /> Copy report
            </Button>
          </div>

          <Section title="Issues">
            {d.issues.length === 0 ? (
              <div className="text-muted-foreground">No issues detected.</div>
            ) : (
              <ul className="space-y-2">
                {d.issues.map((i, idx) => (
                  <li key={idx} className="border rounded p-2">
                    <div className="flex items-center gap-2">
                      <SeverityBadge s={i.severity} />
                      <Badge variant="outline" className="text-xs capitalize">{i.category}</Badge>
                      <span className="font-medium">{i.summary}</span>
                    </div>
                    {i.detail && <div className="text-xs text-muted-foreground mt-1">{i.detail}</div>}
                    {i.suggestion && <div className="text-xs mt-1"><span className="font-medium">Fix:</span> {i.suggestion}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Geometry">
            <Field label="Points" value={g.pointCount} />
            <Field label="Valid vertices" value={g.validCount} />
            <Field label="Invalid vertices" value={g.invalidCount} />
            <Field label="First invalid index" value={g.firstInvalidIndex ?? "—"} />
            <Field label="Centroid" value={g.centroid ? `${g.centroid.lat.toFixed(5)}, ${g.centroid.lng.toFixed(5)}` : "—"} />
            <Field label="Bounds" value={g.bounds ? `${g.bounds.minLat.toFixed(4)},${g.bounds.minLng.toFixed(4)} → ${g.bounds.maxLat.toFixed(4)},${g.bounds.maxLng.toFixed(4)}` : "—"} />
            <Field label="Area" value={g.areaSqM != null ? `${g.areaSqM.toFixed(0)} m² (${(g.areaSqM / 10_000).toFixed(2)} ha)` : "—"} />
            <Field label="Closed" value={g.isClosed == null ? "—" : g.isClosed ? "yes" : "no"} />
          </Section>

          <Section title="Rows">
            <Field label="Stored count" value={r.storedCount ?? "—"} />
            <Field label="Actual count" value={r.actualCount} />
            <Field label="First / last #" value={`${r.firstNumber ?? "—"} / ${r.lastNumber ?? "—"}`} />
            <Field label="Duplicates" value={r.duplicates.length ? r.duplicates.join(", ") : "—"} />
            <Field label="Missing #s" value={r.missingNumbers.length ? r.missingNumbers.slice(0, 20).join(", ") : "—"} />
            <Field label="Invalid geometry" value={r.invalidGeometryCount} />
          </Section>

          <Section title="Irrigation">
            <Field label="Flow (L/hr)" value={ir.flowLhr ?? "—"} />
            <Field label="Emitter count" value={ir.emitterCount ?? "—"} />
            <Field label="Emitter rate (L/hr/emitter)" value={ir.emitterRateLhr ?? "—"} />
            <Field label="Expected flow (L/hr)" value={ir.expectedFlowLhr != null ? ir.expectedFlowLhr.toFixed(1) : "—"} />
            <Field label="Display (kL/hr)" value={ir.displayKlhr != null ? ir.displayKlhr.toFixed(2) : "—"} />
          </Section>

          <Section title="Identifiers">
            <Field label="Block id" value={<span className="font-mono text-xs break-all">{d.paddock.id}</span>} />
            <Field label="Vineyard id" value={<span className="font-mono text-xs break-all">{d.vineyardId}</span>} />
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b last:border-b-0 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
