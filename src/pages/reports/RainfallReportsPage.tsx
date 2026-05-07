import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon, CloudRain, Download, Info } from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import {
  fetchDailyRainfall,
  rangeForPreset,
  sourceLabel,
  summarizeRainfall,
  type RangePreset,
} from "@/lib/rainfallQuery";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "last7", label: "Last 7 days" },
  { value: "last14", label: "Last 14 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "currentYear", label: "Current year" },
  { value: "last365", label: "Last 365 days" },
  { value: "custom", label: "Custom" },
];

export default function RainfallReportsPage() {
  const { selectedVineyardId } = useVineyard();
  const [preset, setPreset] = useState<RangePreset>("last30");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();

  const { from, to } = useMemo(() => {
    if (preset === "custom" && customFrom && customTo) {
      return { from: customFrom, to: customTo };
    }
    return rangeForPreset(preset === "custom" ? "last30" : preset);
  }, [preset, customFrom, customTo]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["rainfall", selectedVineyardId, from.toISOString(), to.toISOString()],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchDailyRainfall(selectedVineyardId!, from, to),
  });

  const rows = data?.ok ? data.rows : [];
  const summary = useMemo(() => summarizeRainfall(rows), [rows]);

  if (!selectedVineyardId) {
    return (
      <div className="p-6">
        <EmptyState
          title="No vineyard selected"
          message="Pick a vineyard from the switcher to view rainfall data."
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Rainfall Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Daily rainfall recorded for the selected vineyard. Sourced via the
            secure <code className="font-mono text-xs">get_daily_rainfall</code> RPC.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled title="Export coming soon">
          <Download className="h-4 w-4 mr-1" /> Export (coming soon)
        </Button>
      </div>

      {/* Range controls */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant={preset === p.value ? "default" : "outline"}
              onClick={() => setPreset(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap gap-2 items-center">
            <DateField label="From" value={customFrom} onChange={setCustomFrom} />
            <DateField label="To" value={customTo} onChange={setCustomTo} />
            {(!customFrom || !customTo) && (
              <span className="text-xs text-muted-foreground">
                Pick both dates to apply the custom range.
              </span>
            )}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          Range: {format(from, "PP")} → {format(to, "PP")}
        </div>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Total rainfall" value={`${summary.totalMm} mm`} />
        <SummaryCard label="Rain days" value={String(summary.rainDays)} />
        <SummaryCard
          label="Wettest day"
          value={
            summary.wettest
              ? `${summary.wettest.mm} mm`
              : "—"
          }
          sub={summary.wettest ? format(new Date(summary.wettest.date), "PP") : undefined}
        />
        <SummaryCard
          label="Avg / rain day"
          value={summary.avgPerRainDay != null ? `${summary.avgPerRainDay} mm` : "—"}
        />
        <SummaryCard label="Source" value={summary.sourceLabel} />
      </div>

      {/* Table or empty / error state */}
      {isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Loading rainfall…
        </Card>
      )}

      {!isLoading && error && (
        <EmptyState
          title="Could not load rainfall"
          message={(error as Error).message}
        />
      )}

      {!isLoading && data && data.ok === false ? (
        <RpcErrorState reason={data.reason} message={data.message} />
      ) : null}

      {!isLoading && data?.ok && rows.length === 0 && (
        <EmptyState
          title="No rainfall recorded for this period"
          message="If a Davis station is configured, persisted rainfall may not be backfilled yet. Check Weather settings."
        />
      )}

      {!isLoading && data?.ok && rows.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Rainfall (mm)</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Station</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.date}>
                  <TableCell>{r.date ? format(new Date(r.date), "PP") : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.rainfall_mm == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      r.rainfall_mm.toFixed(1)
                    )}
                  </TableCell>
                  <TableCell>{r.source ?? "—"}</TableCell>
                  <TableCell>{r.station_name ?? "—"}</TableCell>
                  <TableCell className="max-w-[240px] truncate">{r.notes ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.updated_at ? format(new Date(r.updated_at), "PP p") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card className="p-4 bg-muted/30 flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Manual rainfall corrections will be available to Owners and Managers later.
        </p>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <Card className="p-8 text-center space-y-2">
      <CloudRain className="h-8 w-8 mx-auto text-muted-foreground" />
      <div className="font-medium">{title}</div>
      <p className="text-sm text-muted-foreground max-w-xl mx-auto">{message}</p>
    </Card>
  );
}

function RpcErrorState({ reason, message }: { reason: "rpc_missing" | "forbidden" | "error"; message: string }) {
  const map = {
    rpc_missing: {
      title: "Rainfall service not available",
      msg: "The get_daily_rainfall RPC is not deployed yet. Ask Rork to expose it on the backend.",
    },
    forbidden: {
      title: "Permission denied",
      msg: "You do not have access to rainfall data for this vineyard.",
    },
    error: {
      title: "Could not load rainfall",
      msg: message,
    },
  } as const;
  const m = map[reason];
  return <EmptyState title={m.title} message={m.msg} />;
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("justify-start text-left font-normal", !value && "text-muted-foreground")}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(value, "PP") : label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={onChange}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
