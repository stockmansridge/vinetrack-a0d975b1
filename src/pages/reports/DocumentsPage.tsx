// Documents / Exports Library — central launcher for portal-generated
// reports. Designed so a future Supabase Storage-backed document table can
// be merged into the same `LibraryItem[]` list with minimal changes.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Info,
  Search,
  CloudRain,
} from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { fetchTripsForVineyard, type Trip } from "@/lib/tripsQuery";
import { fetchSprayJobs, type SprayJob } from "@/lib/sprayJobsQuery";
import { downloadTripPdf } from "@/lib/tripReport";
import {
  downloadRainfallPdf,
  downloadRainfallCsv,
} from "@/lib/rainfallExport";
import { fetchDailyRainfall, rangeForPreset } from "@/lib/rainfallQuery";

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
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useSortableTable } from "@/lib/useSortableTable";

interface PaddockLite {
  id: string;
  name: string | null;
}

type ReportType = "trip" | "spray-job" | "yearly-spray" | "rainfall";

type SourceKind = "portal" | "ios";

interface LibraryItem {
  id: string;
  name: string;
  type: ReportType;
  typeLabel: string;
  vineyardName: string;
  paddockName?: string | null;
  related?: string | null; // trip/job/date range descriptor
  createdAt?: string | null;
  source: SourceKind;
  formats: ("pdf" | "csv" | "xlsx")[];
  // Action: either inline generator or navigation target.
  onDownload?: (fmt: "pdf" | "csv" | "xlsx") => void | Promise<void>;
  openHref?: string;
}

const TYPE_LABELS: Record<ReportType, string> = {
  trip: "Trip Report",
  "spray-job": "Spray Job",
  "yearly-spray": "Yearly Spray Program",
  rainfall: "Rainfall Report",
};

const TRIP_FUNCTION_LABELS: Record<string, string> = {
  spray: "Spray",
  mowing: "Mowing",
  slashing: "Slashing",
  harrowing: "Harrowing",
  seeding: "Seeding",
  spreading: "Spreading",
  fertiliser: "Fertiliser",
  pruning: "Pruning",
  shootThinning: "Shoot thinning",
  canopyWork: "Canopy work",
  irrigationCheck: "Irrigation check",
  repairs: "Repairs",
  other: "Other",
};
const tripFn = (v?: string | null) =>
  v ? TRIP_FUNCTION_LABELS[v] ?? v : null;

const tripDisplay = (t: Trip): string => {
  if (t.trip_title?.trim()) return t.trip_title.trim();
  return tripFn(t.trip_function) ?? t.tracking_pattern ?? t.paddock_name ?? "Trip";
};

const fmtDay = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : format(d, "PP");
};

export default function DocumentsPage() {
  const { selectedVineyardId, memberships } = useVineyard();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ??
    "Vineyard";

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ReportType>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | SourceKind>("all");
  const [paddockFilter, setPaddockFilter] = useState<string>("__any__");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const paddocksQuery = useQuery({
    queryKey: ["paddocks-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PaddockLite>("paddocks", selectedVineyardId!),
  });
  const paddocks = paddocksQuery.data ?? [];
  const paddockMap = useMemo(
    () => new Map(paddocks.map((p) => [p.id, p.name ?? "—"])),
    [paddocks],
  );

  const tripsQuery = useQuery({
    queryKey: ["library-trips", selectedVineyardId, paddocks.map((p) => p.id).join(",")],
    enabled: !!selectedVineyardId,
    queryFn: () =>
      fetchTripsForVineyard(selectedVineyardId!, paddocks.map((p) => p.id)),
  });
  const trips = tripsQuery.data?.trips ?? [];

  const sprayJobsQuery = useQuery({
    queryKey: ["library-spray-jobs", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchSprayJobs(selectedVineyardId!, { template: false }),
  });
  const sprayJobs = sprayJobsQuery.data ?? [];

  // Build library items from existing data sources.
  const items: LibraryItem[] = useMemo(() => {
    const out: LibraryItem[] = [];

    // Trips → Trip Report PDFs
    for (const t of trips) {
      const padIds: string[] = Array.isArray(t.paddock_ids)
        ? (t.paddock_ids as string[])
        : t.paddock_id
          ? [t.paddock_id]
          : [];
      const padName =
        padIds.length === 0
          ? t.paddock_name ?? null
          : padIds.length === 1
            ? paddockMap.get(padIds[0]) ?? t.paddock_name ?? null
            : `${padIds.length} blocks`;
      const blockNames = padIds
        .map((id) => paddockMap.get(id))
        .filter(Boolean) as string[];
      out.push({
        id: `trip:${t.id}`,
        name: tripDisplay(t),
        type: "trip",
        typeLabel: TYPE_LABELS.trip,
        vineyardName,
        paddockName: padName,
        related: tripFn(t.trip_function) ?? undefined,
        createdAt: t.start_time ?? t.created_at ?? null,
        source: "portal",
        formats: ["pdf"],
        onDownload: () =>
          downloadTripPdf(t, {
            paddockName: padName ?? null,
            tripDisplay: tripDisplay(t),
            tripFunctionLabel: tripFn(t.trip_function),
            vineyardName,
            blockNames,
            pinCount: Array.isArray(t.pin_ids) ? (t.pin_ids as any[]).length : 0,
          }),
      });
    }

    // Spray Jobs → individual Spray Job PDFs (route to Spray Jobs page for export with full lookups)
    for (const j of sprayJobs) {
      out.push({
        id: `sprayjob:${j.id}`,
        name: j.name ?? "Spray job",
        type: "spray-job",
        typeLabel: TYPE_LABELS["spray-job"],
        vineyardName,
        paddockName: null,
        related: j.status ?? null,
        createdAt: j.planned_date ?? j.created_at ?? null,
        source: "portal",
        formats: ["pdf"],
        openHref: "/spray-jobs",
      });
    }

    // Yearly Spray Programs → derive set of years from spray jobs
    const years = new Set<number>();
    for (const j of sprayJobs) {
      const d = j.planned_date ?? j.created_at;
      if (!d) continue;
      const yr = new Date(d).getFullYear();
      if (!isNaN(yr)) years.add(yr);
    }
    Array.from(years)
      .sort((a, b) => b - a)
      .forEach((yr) => {
        out.push({
          id: `yearly:${yr}`,
          name: `Yearly Spray Program — ${yr}`,
          type: "yearly-spray",
          typeLabel: TYPE_LABELS["yearly-spray"],
          vineyardName,
          paddockName: null,
          related: `${yr}-01-01 → ${yr}-12-31`,
          createdAt: `${yr}-01-01`,
          source: "portal",
          formats: ["pdf", "csv"],
          openHref: "/spray-jobs",
        });
      });

    return out;
  }, [trips, sprayJobs, paddockMap, vineyardName]);

  // Apply filters
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(dateTo).getTime() + 86_400_000 : null;
    return items.filter((it) => {
      if (typeFilter !== "all" && it.type !== typeFilter) return false;
      if (sourceFilter !== "all" && it.source !== sourceFilter) return false;
      if (paddockFilter !== "__any__") {
        // We only know paddockName per item, not id. Match by name string.
        const want = paddockMap.get(paddockFilter);
        if (!want || it.paddockName !== want) return false;
      }
      if (fromTs && it.createdAt && new Date(it.createdAt).getTime() < fromTs)
        return false;
      if (toTs && it.createdAt && new Date(it.createdAt).getTime() > toTs)
        return false;
      if (s) {
        const hay = `${it.name} ${it.typeLabel} ${it.related ?? ""} ${
          it.paddockName ?? ""
        }`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [items, search, typeFilter, sourceFilter, paddockFilter, dateFrom, dateTo, paddockMap]);

  const loading = tripsQuery.isLoading || sprayJobsQuery.isLoading;

  if (!selectedVineyardId) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center space-y-2">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="font-medium">No vineyard selected</div>
          <p className="text-sm text-muted-foreground">
            Pick a vineyard from the switcher to view exports.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-semibold">Documents & Exports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Central launcher for vineyard reports and exports. Generate or download
          Trip, Spray and Rainfall reports from one place.
        </p>
      </div>

      {/* Rainfall on-demand section */}
      <RainfallExports vineyardId={selectedVineyardId} vineyardName={vineyardName} />

      {/* Filters */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, type or block…"
              className="pl-8"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Report type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="trip">Trip Reports</SelectItem>
              <SelectItem value="spray-job">Spray Jobs</SelectItem>
              <SelectItem value="yearly-spray">Yearly Spray Program</SelectItem>
              <SelectItem value="rainfall">Rainfall Reports</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as any)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="portal">Portal generated</SelectItem>
              <SelectItem value="ios">iOS generated</SelectItem>
            </SelectContent>
          </Select>
          <Select value={paddockFilter} onValueChange={setPaddockFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Block / paddock" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">All blocks</SelectItem>
              {paddocks.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name ?? "—"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-[150px]"
            aria-label="From date"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-[150px]"
            aria-label="To date"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {filtered.length} of {items.length} items
        </div>
      </Card>

      {/* Library table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Vineyard</TableHead>
              <TableHead>Block</TableHead>
              <TableHead>Related</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                  No documents match the current filters.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              filtered.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{it.typeLabel}</Badge>
                  </TableCell>
                  <TableCell>{it.vineyardName}</TableCell>
                  <TableCell>{it.paddockName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{it.related ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDay(it.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={it.source === "portal" ? "outline" : "default"}>
                      {it.source === "portal" ? "Portal" : "iOS"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {it.formats.map((f) =>
                      it.onDownload ? (
                        <Button
                          key={f}
                          size="sm"
                          variant="outline"
                          onClick={() => it.onDownload!(f)}
                        >
                          {f === "pdf" ? (
                            <FileText className="h-3.5 w-3.5 mr-1" />
                          ) : (
                            <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
                          )}
                          {f.toUpperCase()}
                        </Button>
                      ) : null,
                    )}
                    {it.openHref && (
                      <Button asChild size="sm" variant="ghost">
                        <Link to={it.openHref}>
                          <ExternalLink className="h-3.5 w-3.5 mr-1" />
                          Open
                        </Link>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-4 bg-muted/30 flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground" />
        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            Trip and Rainfall reports are generated on demand from current data.
            Spray Job and Yearly Spray Program PDFs/CSVs open the Spray Jobs page
            where rich chemical/equipment lookups are available.
          </div>
          <div>
            Future iOS-generated PDFs, CSVs and Excel files (spray compliance,
            irrigation, growth stage, yield estimation) will appear in this same
            list once a documents storage bucket is connected.
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---------- Rainfall on-demand exports ----------

function RainfallExports({
  vineyardId,
  vineyardName,
}: {
  vineyardId: string;
  vineyardName: string;
}) {
  const [preset, setPreset] = useState<"last30" | "last365" | "currentYear">(
    "last30",
  );
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);

  const run = async (fmt: "pdf" | "csv") => {
    setBusy(fmt);
    try {
      const { from, to } = rangeForPreset(preset);
      const res = await fetchDailyRainfall(vineyardId, from, to);
      const rows = res.ok ? res.rows : [];
      if (fmt === "pdf") await downloadRainfallPdf(rows, vineyardName, from, to);
      else downloadRainfallCsv(rows, vineyardName, from, to);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CloudRain className="h-4 w-4 text-muted-foreground" />
        <div className="font-medium">Rainfall Report</div>
        <span className="text-xs text-muted-foreground">
          Generate from selected range
        </span>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={preset} onValueChange={(v) => setPreset(v as any)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last30">Last 30 days</SelectItem>
            <SelectItem value="last365">Last 365 days</SelectItem>
            <SelectItem value="currentYear">Current year</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("pdf")}>
          <Download className="h-4 w-4 mr-1" />
          PDF
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("csv")}>
          <Download className="h-4 w-4 mr-1" />
          CSV
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to="/reports/rainfall">
            <ExternalLink className="h-4 w-4 mr-1" />
            Custom range
          </Link>
        </Button>
      </div>
    </Card>
  );
}
