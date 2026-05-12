import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { useTeamLookup } from "@/hooks/useTeamLookup";
import { useGrowthStagePhoto } from "@/hooks/useGrowthStagePhoto";
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
import { Download, Image as ImageIcon } from "lucide-react";
import {
  fetchGrowthStageRecords,
  summariseLatestByBlock,
  toCsv,
  type GrowthStageRecord,
} from "@/lib/growthStageRecordsQuery";

const ANY = "__any__";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));

export default function GrowthStageRecordsPage() {
  const { selectedVineyardId } = useVineyard();
  const { resolve } = useTeamLookup(selectedVineyardId);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [block, setBlock] = useState<string>(ANY);
  const [variety, setVariety] = useState<string>(ANY);
  const [stage, setStage] = useState<string>(ANY);
  const [operator, setOperator] = useState<string>(ANY);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<GrowthStageRecord | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["growth_stage_records", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchGrowthStageRecords(selectedVineyardId!),
  });

  const all = data ?? [];

  const blocks = useMemo(() => {
    const m = new Map<string, string>();
    all.forEach((r) => r.paddock_id && m.set(r.paddock_id, r.paddock_name ?? "—"));
    return Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);

  const varieties = useMemo(() => {
    const s = new Set<string>();
    all.forEach((r) => r.variety && s.add(r.variety));
    return Array.from(s).sort();
  }, [all]);

  const stages = useMemo(() => {
    const s = new Set<string>();
    all.forEach((r) => r.growth_stage_code && s.add(r.growth_stage_code));
    return Array.from(s).sort((a, b) => {
      const na = parseFloat(a);
      const nb = parseFloat(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [all]);

  const operators = useMemo(() => {
    const m = new Map<string, string>();
    all.forEach((r) => {
      if (!r.created_by) return;
      m.set(r.created_by, resolve(r.created_by) ?? "Unknown member");
    });
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, resolve]);

  const rows = useMemo(() => {
    let list = all.slice();
    list.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    if (from) list = list.filter((r) => (r.date ?? "").slice(0, 10) >= from);
    if (to) list = list.filter((r) => (r.date ?? "").slice(0, 10) <= to);
    if (block !== ANY) list = list.filter((r) => r.paddock_id === block);
    if (variety !== ANY) list = list.filter((r) => r.variety === variety);
    if (stage !== ANY) list = list.filter((r) => r.growth_stage_code === stage);
    if (operator !== ANY) list = list.filter((r) => r.created_by === operator);
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((r) =>
        [r.paddock_name, r.variety, r.growth_stage_code, r.notes, r.title]
          .some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
  }, [all, from, to, block, variety, stage, operator, filter]);

  const summary = useMemo(() => summariseLatestByBlock(all), [all]);

  const handleExport = () => {
    const csv = toCsv(rows, (id) => resolve(id) ?? "");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `growth-stage-records-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Growth Stage Records</h1>
          <p className="text-sm text-muted-foreground">
            Read-only. Sourced from field pins (mode “Growth” or any record with an E-L code) on the selected vineyard.
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={!rows.length}>
          <Download className="h-4 w-4 mr-1" /> Export CSV
        </Button>
      </div>

      {summary.length > 0 && (
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Latest stage by block
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {summary.map((s) => (
              <div
                key={s.paddock_id}
                className="rounded-md border bg-card/50 p-3 flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{s.paddock_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {s.variety ?? "Variety —"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmtDate(s.latest_date)}
                    {s.days_since != null ? ` · ${s.days_since}d ago` : ""}
                  </div>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  E-L {s.latest_stage ?? "—"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

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
          <div className="text-xs text-muted-foreground">Block</div>
          <Select value={block} onValueChange={setBlock}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All blocks</SelectItem>
              {blocks.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Variety</div>
          <Select value={variety} onValueChange={setVariety}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All varieties</SelectItem>
              {varieties.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">E-L stage</div>
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All stages</SelectItem>
              {stages.map((s) => (
                <SelectItem key={s} value={s}>E-L {s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Operator</div>
          <Select value={operator} onValueChange={setOperator}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All operators</SelectItem>
              {operators.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 ml-auto">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            placeholder="Block, variety, notes…"
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
              <TableHead>Block</TableHead>
              <TableHead>Variety</TableHead>
              <TableHead>E-L stage</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Photo</TableHead>
              <TableHead>Operator</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={7} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No growth stage records found for this vineyard.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                <TableCell>{fmtDate(r.date)}</TableCell>
                <TableCell>{fmt(r.paddock_name)}</TableCell>
                <TableCell>{fmt(r.variety)}</TableCell>
                <TableCell>
                  {r.growth_stage_code ? <Badge variant="secondary">E-L {r.growth_stage_code}</Badge> : "—"}
                </TableCell>
                <TableCell className="max-w-[280px] truncate">{fmt(r.notes)}</TableCell>
                <TableCell>{r.photo_path ? <ImageIcon className="h-4 w-4 text-muted-foreground" /> : "—"}</TableCell>
                <TableCell>{resolve(r.created_by) ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <DetailSheet
        record={selected}
        operatorName={(id) => resolve(id) ?? "Unknown member"}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  );
}

function DetailSheet({
  record,
  operatorName,
  open,
  onOpenChange,
}: {
  record: GrowthStageRecord | null;
  operatorName: (id?: string | null) => string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const photos = record?.photo_paths?.length ? record.photo_paths : (record?.photo_path ? [record.photo_path] : []);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Growth stage — {fmtDate(record?.date)}</SheetTitle>
        </SheetHeader>
        {record && (
          <div className="mt-4 space-y-4 text-sm">
            <Section title="Observation">
              <Field label="Date" value={fmtDate(record.date)} />
              <Field label="Block" value={fmt(record.paddock_name)} />
              <Field label="Variety" value={fmt(record.variety)} />
              <Field label="E-L stage" value={record.growth_stage_code ? `E-L ${record.growth_stage_code}` : "—"} />
              {record.growth_stage_label && (
                <Field label="Stage label" value={record.growth_stage_label} />
              )}
              <Field label="Mode" value={fmt(record.mode)} />
              {record.source && <Field label="Source" value={fmt(record.source)} />}
            </Section>
            {record.notes && (
              <Section title="Notes">
                <p className="whitespace-pre-wrap">{record.notes}</p>
              </Section>
            )}
            {photos.length > 0 && (
              <Section title={photos.length > 1 ? `Photos (${photos.length})` : "Photo"}>
                <div className="grid grid-cols-1 gap-2">
                  {photos.map((p) => (
                    <PhotoTile key={p} path={p} />
                  ))}
                </div>
              </Section>
            )}
            <Section title="Location">
              <Field label="Latitude" value={fmt(record.latitude)} />
              <Field label="Longitude" value={fmt(record.longitude)} />
              <Field label="Row" value={fmt(record.row_number)} />
            </Section>
            <Section title="Meta">
              <Field label="Created by" value={operatorName(record.created_by)} />
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

function PhotoTile({ path }: { path: string }) {
  const url = useGrowthStagePhoto(path);
  if (!url) {
    return <div className="text-muted-foreground text-xs">Photo unavailable.</div>;
  }
  return (
    <img
      src={url}
      alt="Growth stage observation"
      className="rounded-md border max-h-80 w-full object-contain bg-muted"
    />
  );
}

function Field({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs break-all text-right" : "text-right"}>
        {value == null || value === "" ? "—" : String(value)}
      </span>
    </div>
  );
}
