import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  fetchYieldReportsForVineyard,
  type YieldEstimationSession,
  type HistoricalYieldRecord,
} from "@/lib/yieldReportsQuery";
import YieldDamageAdjustmentPanel from "@/components/YieldDamageAdjustmentPanel";

const ANY = "__any__";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtNum = (v?: number | null, digits = 2) =>
  v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });

type AnyRow = (YieldEstimationSession | HistoricalYieldRecord) & { __kind: "session" | "historical" };

export default function YieldReportsPage() {
  const { selectedVineyardId } = useVineyard();
  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [yearFilter, setYearFilter] = useState<string>(ANY);
  const [completion, setCompletion] = useState<string>(ANY);
  const [tab, setTab] = useState<"all" | "sessions" | "historical">("all");
  const [selected, setSelected] = useState<AnyRow | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["yield_reports", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchYieldReportsForVineyard(selectedVineyardId!),
  });

  const sessions = data?.sessions ?? [];
  const historical = data?.historical ?? [];

  const years = useMemo(() => {
    const s = new Set<string>();
    historical.forEach((r) => {
      if (r.year != null) s.add(String(r.year));
      else if (r.season) s.add(r.season);
    });
    return Array.from(s).sort().reverse();
  }, [historical]);

  const allRows = useMemo<AnyRow[]>(() => {
    const a = sessions.map((s) => ({ ...s, __kind: "session" as const }));
    const b = historical.map((h) => ({ ...h, __kind: "historical" as const }));
    return [...a, ...b];
  }, [sessions, historical]);

  const rows = useMemo(() => {
    let list: AnyRow[] = tab === "sessions"
      ? allRows.filter((r) => r.__kind === "session")
      : tab === "historical"
      ? allRows.filter((r) => r.__kind === "historical")
      : allRows;

    list.sort((a, b) => {
      const ad = sortDate(a);
      const bd = sortDate(b);
      return (bd ?? "").localeCompare(ad ?? "");
    });

    if (from) list = list.filter((r) => (sortDate(r) ?? "") >= from);
    if (to) list = list.filter((r) => (sortDate(r) ?? "") <= to + "T23:59:59");

    if (yearFilter !== ANY) {
      list = list.filter((r) => {
        if (r.__kind === "historical") {
          const h = r as HistoricalYieldRecord;
          return String(h.year ?? "") === yearFilter || h.season === yearFilter;
        }
        return false;
      });
    }

    if (completion === "completed") {
      list = list.filter((r) =>
        r.__kind === "session" ? (r as YieldEstimationSession).is_completed : true,
      );
    } else if (completion === "open") {
      list = list.filter((r) =>
        r.__kind === "session" ? !(r as YieldEstimationSession).is_completed : false,
      );
    }

    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((r) => {
        if (r.__kind === "historical") {
          const h = r as HistoricalYieldRecord;
          return [h.season, h.year, h.notes]
            .some((v) => String(v ?? "").toLowerCase().includes(f));
        }
        const s = r as YieldEstimationSession;
        return JSON.stringify(s.payload ?? {}).toLowerCase().includes(f);
      });
    }
    return list;
  }, [allRows, tab, from, to, yearFilter, completion, filter]);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[YieldReportsPage] diagnostics", {
      selectedVineyardId,
      yieldReportsCount: (data?.sessionCount ?? 0) + (data?.historicalCount ?? 0),
      recordsBySource: data?.source ?? "n/a",
      breakdown: {
        sessions: data?.sessionCount ?? 0,
        historical: data?.historicalCount ?? 0,
      },
      deletedExcluded: {
        sessions: data?.deletedExcludedSessions ?? 0,
        historical: data?.deletedExcludedHistorical ?? 0,
      },
      missingDisplayFields: {
        missingSeason: data?.missingSeason ?? 0,
        missingYieldFields: data?.missingYieldFields ?? 0,
      },
      schemaGaps: [
        "no top-level paddock_id / variety / block_id (live inside payload/block_results jsonb)",
        "no estimated vs actual split column (only total_yield_tonnes on historical)",
        "no archive flag (only deleted_at on both tables)",
      ],
      filtered: rows.length,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Yield reports</h1>
        <p className="text-sm text-muted-foreground">
          Read-only. Soft-deleted records are excluded.
        </p>
      </div>

      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        Production data — read-only view. No edits, archives, or deletions are possible from this page.
      </div>

      <YieldDamageAdjustmentPanel vineyardId={selectedVineyardId} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="all">All ({allRows.length})</TabsTrigger>
          <TabsTrigger value="sessions">Estimation sessions ({sessions.length})</TabsTrigger>
          <TabsTrigger value="historical">Historical ({historical.length})</TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap items-end gap-2 mt-4">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">From</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">To</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Season / year</div>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any season</SelectItem>
                {years.map((y) => (<SelectItem key={y} value={y}>{y}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Completion</div>
            <Select value={completion} onValueChange={setCompletion}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All</SelectItem>
                <SelectItem value="open">Open sessions</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 ml-auto">
            <div className="text-xs text-muted-foreground">Search</div>
            <Input
              placeholder="Season, notes, payload…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-72"
            />
          </div>
        </div>

        <TabsContent value={tab} className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Season / year</TableHead>
                  <TableHead>Total yield (t)</TableHead>
                  <TableHead>Area (ha)</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                )}
                {error && (
                  <TableRow><TableCell colSpan={6} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
                )}
                {!isLoading && !error && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No yield reports found for this vineyard.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => {
                  const isHist = r.__kind === "historical";
                  const h = r as HistoricalYieldRecord;
                  const s = r as YieldEstimationSession;
                  return (
                    <TableRow key={r.__kind + ":" + r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                      <TableCell>{fmtDate(sortDate(r))}</TableCell>
                      <TableCell>
                        <Badge variant={isHist ? "secondary" : "outline"}>
                          {isHist ? "Historical" : "Estimation"}
                        </Badge>
                      </TableCell>
                      <TableCell>{isHist ? fmt(h.season ?? h.year) : "—"}</TableCell>
                      <TableCell>{isHist ? fmtNum(h.total_yield_tonnes) : "—"}</TableCell>
                      <TableCell>{isHist ? fmtNum(h.total_area_hectares) : "—"}</TableCell>
                      <TableCell>
                        {isHist
                          ? <Badge variant="secondary">Archived</Badge>
                          : s.is_completed
                          ? <Badge>Completed</Badge>
                          : <Badge variant="outline">Open</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <YieldSheet row={selected} vineyardId={selectedVineyardId} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  );
}

function sortDate(r: AnyRow): string | null | undefined {
  if (r.__kind === "historical") {
    const h = r as HistoricalYieldRecord;
    return h.archived_at ?? h.updated_at ?? h.created_at ?? null;
  }
  const s = r as YieldEstimationSession;
  return s.completed_at ?? s.session_created_at ?? s.updated_at ?? s.created_at ?? null;
}

function YieldSheet({
  row,
  vineyardId,
  open,
  onOpenChange,
}: {
  row: AnyRow | null;
  vineyardId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {row?.__kind === "historical" ? "Historical yield" : "Estimation session"}
            {row ? ` — ${fmtDate(sortDate(row))}` : ""}
          </SheetTitle>
        </SheetHeader>
        {row?.__kind === "historical" && (
          <HistoricalDetail row={row as HistoricalYieldRecord} vineyardId={vineyardId} />
        )}
        {row?.__kind === "session" && <SessionDetail row={row as YieldEstimationSession} />}
      </SheetContent>
    </Sheet>
  );
}

function HistoricalDetail({ row, vineyardId }: { row: HistoricalYieldRecord; vineyardId: string | null }) {
  const blocks = Array.isArray(row.block_results) ? row.block_results : null;
  return (
    <div className="mt-4 space-y-4 text-sm">
      <Section title="Summary">
        <Field label="Season" value={fmt(row.season)} />
        <Field label="Year" value={fmt(row.year)} />
        <Field label="Total yield (t)" value={fmtNum(row.total_yield_tonnes)} />
        <Field label="Total area (ha)" value={fmtNum(row.total_area_hectares)} />
        <Field label="t / ha" value={
          row.total_yield_tonnes != null && row.total_area_hectares
            ? fmtNum(row.total_yield_tonnes / row.total_area_hectares)
            : "—"
        } />
        <Field label="Archived at" value={fmtDate(row.archived_at)} />
      </Section>
      {row.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap">{row.notes}</p>
        </Section>
      )}
      <Section title={`Block results${blocks ? ` (${blocks.length})` : ""}`}>
        {blocks ? (
          <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto max-h-80">
            {JSON.stringify(blocks, null, 2)}
          </pre>
        ) : (
          <span className="text-muted-foreground">No block results recorded.</span>
        )}
      </Section>
      <Section title="Meta">
        <Field label="Created" value={fmtDate(row.created_at)} />
        <Field label="Updated" value={fmtDate(row.updated_at)} />
        <Field label="Record ID" value={row.id} mono />
      </Section>
    </div>
  );
}

function SessionDetail({ row }: { row: YieldEstimationSession }) {
  return (
    <div className="mt-4 space-y-4 text-sm">
      <Section title="Session">
        <Field label="Created" value={fmtDate(row.session_created_at ?? row.created_at)} />
        <Field label="Completed" value={row.is_completed ? "Yes" : "No"} />
        <Field label="Completed at" value={fmtDate(row.completed_at)} />
      </Section>
      <Section title="Payload">
        {row.payload ? (
          <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto max-h-96">
            {JSON.stringify(row.payload, null, 2)}
          </pre>
        ) : (
          <span className="text-muted-foreground">Empty payload.</span>
        )}
      </Section>
      <Section title="Meta">
        <Field label="Updated" value={fmtDate(row.updated_at)} />
        <Field label="Record ID" value={row.id} mono />
      </Section>
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
