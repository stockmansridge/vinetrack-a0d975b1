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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import {
  fetchSprayRecordsForVineyard,
  type SprayRecord,
} from "@/lib/sprayRecordsQuery";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};

const fmtTime = (v?: string | null) => {
  if (!v) return "—";
  if (/^\d{2}:\d{2}/.test(v)) return v.slice(0, 5);
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return v;
};

const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));

const ANY = "__any__";

export default function SprayRecordsPage() {
  const { selectedVineyardId } = useVineyard();
  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [opType, setOpType] = useState<string>(ANY);
  const [selected, setSelected] = useState<SprayRecord | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["spray_records", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchSprayRecordsForVineyard(selectedVineyardId!),
  });

  const records = data?.records ?? [];

  const operationTypes = useMemo(() => {
    const s = new Set<string>();
    records.forEach((r) => r.operation_type && s.add(r.operation_type));
    return Array.from(s).sort();
  }, [records]);

  const rows = useMemo(() => {
    let list = records.slice();
    list.sort((a, b) => {
      const ad = (a.date ?? "") + (a.start_time ?? "");
      const bd = (b.date ?? "") + (b.start_time ?? "");
      return bd.localeCompare(ad);
    });
    if (from) list = list.filter((r) => (r.date ?? "") >= from);
    if (to) list = list.filter((r) => (r.date ?? "") <= to);
    if (opType !== ANY) list = list.filter((r) => r.operation_type === opType);
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((r) =>
        [r.date, r.tractor, r.spray_reference, r.operation_type, r.equipment_type, r.notes]
          .some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
  }, [records, filter, from, to, opType]);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[SprayRecordsPage] diagnostics", {
      selectedVineyardId,
      sprayRecordsCount: records.length,
      recordsBySource: data?.source ?? "n/a",
      rawCountBeforeTemplateFilter: data?.rawCount ?? 0,
      templatesExcluded: data?.templatesExcluded ?? 0,
      // No deleted/archive flag other than deleted_at, which is filtered server-side.
      missingDisplayFields: {
        missingDate: data?.missingDate ?? 0,
        missingTractor: data?.missingTractor ?? 0,
      },
      // Schema gaps surfaced for the team:
      //   - spray_records has no `paddock_id` → no paddock filter.
      //   - spray_records has no `operator` → no operator filter.
      //   - spray_records has no explicit status field.
      schemaGaps: ["no paddock_id", "no operator", "no status"],
      filtered: rows.length,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Spray records</h1>
          <p className="text-sm text-muted-foreground">
            Read-only. Templates and soft-deleted records are excluded.
          </p>
        </div>
      </div>

      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        Production data — read-only view. No edits, archives, or deletions are possible from this page.
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
          <div className="text-xs text-muted-foreground">Operation</div>
          <Select value={opType} onValueChange={setOpType}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any operation</SelectItem>
              {operationTypes.map((o) => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 ml-auto">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            placeholder="Date, tractor, reference, notes…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-72"
          />
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Tractor</TableHead>
              <TableHead>Equipment</TableHead>
              <TableHead>Temp °C</TableHead>
              <TableHead>Wind</TableHead>
              <TableHead>Humidity</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-6">Loading…</TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-destructive py-6">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                  No spray records found for this vineyard.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => setSelected(r)}
              >
                <TableCell>{fmtDate(r.date)}</TableCell>
                <TableCell>{fmtTime(r.start_time)}</TableCell>
                <TableCell>{fmtTime(r.end_time)}</TableCell>
                <TableCell>
                  {r.operation_type ? <Badge variant="secondary">{r.operation_type}</Badge> : "—"}
                </TableCell>
                <TableCell>{fmt(r.spray_reference)}</TableCell>
                <TableCell>{fmt(r.tractor)}</TableCell>
                <TableCell>{fmt(r.equipment_type)}</TableCell>
                <TableCell>{fmt(r.temperature)}</TableCell>
                <TableCell>
                  {r.wind_speed != null
                    ? `${r.wind_speed}${r.wind_direction ? ` ${r.wind_direction}` : ""}`
                    : "—"}
                </TableCell>
                <TableCell>{fmt(r.humidity)}</TableCell>
                <TableCell>{fmtDate(r.updated_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <SprayRecordSheet
        record={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  );
}


function SprayRecordSheet({
  record,
  open,
  onOpenChange,
}: {
  record: SprayRecord | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            Spray record — {fmtDate(record?.date)} {fmtTime(record?.start_time)}
          </SheetTitle>
        </SheetHeader>
        {record && (
          <div className="mt-4 space-y-4 text-sm">
            <Section title="Schedule">
              <Field label="Date" value={fmtDate(record.date)} />
              <Field label="Start" value={fmtTime(record.start_time)} />
              <Field label="End" value={fmtTime(record.end_time)} />
              <Field label="Operation" value={fmt(record.operation_type)} />
              <Field label="Reference" value={fmt(record.spray_reference)} />
            </Section>

            <Section title="Equipment">
              <Field label="Tractor" value={fmt(record.tractor)} />
              <Field label="Tractor gear" value={fmt(record.tractor_gear)} />
              <Field label="Equipment" value={fmt(record.equipment_type)} />
              <Field label="Fans/jets" value={fmt(record.number_of_fans_jets)} />
              <Field label="Avg speed" value={fmt(record.average_speed)} />
            </Section>

            <Section title="Conditions">
              <Field label="Temperature °C" value={fmt(record.temperature)} />
              <Field label="Wind speed" value={fmt(record.wind_speed)} />
              <Field label="Wind direction" value={fmt(record.wind_direction)} />
              <Field label="Humidity %" value={fmt(record.humidity)} />
            </Section>

            {record.notes && (
              <Section title="Notes">
                <p className="whitespace-pre-wrap text-foreground/90">{record.notes}</p>
              </Section>
            )}

            <TanksSection tanks={record.tanks} />

            <Section title="Meta">
              <Field label="Trip ID" value={fmt(record.trip_id)} />
              <Field label="Created" value={fmtDate(record.created_at)} />
              <Field label="Updated" value={fmtDate(record.updated_at)} />
              <Field label="Record ID" value={record.id} mono />
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
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

function TanksSection({ tanks }: { tanks: any }) {
  const arr = Array.isArray(tanks) ? tanks : tanks ? [tanks] : [];
  if (arr.length === 0) {
    return (
      <Section title="Tanks">
        <span className="text-muted-foreground">No tank data recorded.</span>
      </Section>
    );
  }
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
        Tanks ({arr.length})
      </div>
      <div className="space-y-2">
        {arr.map((t, i) => {
          const chems = Array.isArray(t?.chemicals) ? t.chemicals : [];
          return (
            <Collapsible key={i} defaultOpen={i === 0}>
              <div className="rounded-md border bg-card/50">
                <CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-left">
                  <div className="flex flex-col">
                    <span className="font-medium">
                      Tank {i + 1}
                      {t?.tank_number ? ` · #${t.tank_number}` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t?.water_volume != null ? `${t.water_volume} L water` : "Water volume —"}
                      {chems.length ? ` · ${chems.length} chemical${chems.length > 1 ? "s" : ""}` : ""}
                    </span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t p-3 space-y-2">
                  {chems.length > 0 && (
                    <div className="space-y-1">
                      {chems.map((c: any, ci: number) => (
                        <div
                          key={ci}
                          className="flex items-center justify-between text-xs border-b last:border-0 py-1"
                        >
                          <span>{c?.name ?? c?.chemical_name ?? "Chemical"}</span>
                          <span className="text-muted-foreground">
                            {c?.dose ?? c?.rate ?? c?.amount ?? ""}{" "}
                            {c?.unit ?? ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto">
                    {JSON.stringify(t, null, 2)}
                  </pre>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
