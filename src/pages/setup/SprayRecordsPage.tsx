import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

interface SprayRecord {
  id: string;
  vineyard_id: string;
  trip_id?: string | null;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  temperature?: number | null;
  wind_speed?: number | null;
  wind_direction?: string | null;
  humidity?: number | null;
  spray_reference?: string | null;
  notes?: string | null;
  number_of_fans_jets?: number | null;
  average_speed?: number | null;
  equipment_type?: string | null;
  tractor?: string | null;
  tractor_gear?: string | null;
  is_template?: boolean | null;
  operation_type?: string | null;
  tanks?: any;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
}

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};

const fmtTime = (v?: string | null) => {
  if (!v) return "—";
  // accept "HH:mm:ss" or ISO
  if (/^\d{2}:\d{2}/.test(v)) return v.slice(0, 5);
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return v;
};

const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));

export default function SprayRecordsPage() {
  const { selectedVineyardId } = useVineyard();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<SprayRecord | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["spray_records", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<SprayRecord>("spray_records", selectedVineyardId!),
  });

  const rows = useMemo(() => {
    const list = (data ?? []).filter((r) => !r.is_template);
    // sort newest first by date then start_time
    list.sort((a, b) => {
      const ad = (a.date ?? "") + (a.start_time ?? "");
      const bd = (b.date ?? "") + (b.start_time ?? "");
      return bd.localeCompare(ad);
    });
    if (!filter.trim()) return list;
    const f = filter.toLowerCase();
    return list.filter((r) =>
      [r.date, r.tractor, r.spray_reference, r.operation_type, r.equipment_type, r.notes]
        .some((v) => String(v ?? "").toLowerCase().includes(f)),
    );
  }, [data, filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Spray records</h1>
          <p className="text-sm text-muted-foreground">
            Read-only. Filter by date, tractor, reference, or operation type.
          </p>
        </div>
        <Input
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-64"
        />
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
                <TableCell colSpan={11} className="text-center text-muted-foreground py-6">
                  Loading…
                </TableCell>
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
                  No spray records for this vineyard yet.
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
                  {r.operation_type ? (
                    <Badge variant="secondary">{r.operation_type}</Badge>
                  ) : (
                    "—"
                  )}
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
