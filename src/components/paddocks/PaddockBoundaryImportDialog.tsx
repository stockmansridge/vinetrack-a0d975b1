import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { MapPin, Upload, AlertTriangle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import {
  applyBoundaryImport,
  buildBoundaryPlan,
  parseBoundaryFile,
  type BoundaryFeature,
  type BoundaryPaddockRow,
  type BoundaryPlan,
  type ParsedBoundaries,
} from "@/lib/paddockBoundaryImport";
import { toast } from "sonner";

// We deliberately do NOT import Checkbox from elsewhere — it's a shadcn primitive.

export default function PaddockBoundaryImportDialog() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const queryClient = useQueryClient();
  const canEdit = currentRole === "owner" || currentRole === "manager";

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"home" | "preview">("home");
  const [parsed, setParsed] = useState<ParsedBoundaries | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: paddocks = [] } = useQuery<BoundaryPaddockRow[]>({
    queryKey: ["paddocks-boundary-import", selectedVineyardId],
    enabled: !!selectedVineyardId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id, name, polygon_points")
        .eq("vineyard_id", selectedVineyardId!)
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []) as BoundaryPaddockRow[];
    },
  });

  const plan: BoundaryPlan | null = useMemo(() => {
    if (!parsed) return null;
    return buildBoundaryPlan(parsed.features, paddocks);
  }, [parsed, paddocks]);

  const reset = () => {
    setParsed(null);
    setFilename("");
    setOverwriteExisting(false);
    setView("home");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const p = parseBoundaryFile(file.name, text);
      setParsed(p);
      setFilename(file.name);
      setView("preview");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not parse file");
    }
  };

  const handleApply = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const result = await applyBoundaryImport(plan, { overwriteExisting });
      const errPart = result.errors.length ? ` (${result.errors.length} error(s))` : "";
      if (result.errors.length) {
        toast.error(
          `Mapped ${result.mapped}, overwrote ${result.overwritten}, skipped ${result.skipped}.${errPart}`,
        );
      } else {
        toast.success(
          `Mapped ${result.mapped} block(s)${
            result.overwritten ? `, overwrote ${result.overwritten}` : ""
          }${result.skipped ? `, skipped ${result.skipped}` : ""}.`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["list", "paddocks"] });
      await queryClient.invalidateQueries({ queryKey: ["paddocks-boundary-import"] });
      await queryClient.invalidateQueries({ queryKey: ["paddocks-export"] });
      reset();
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Boundary import failed");
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => {
    if (!plan) return { matchNew: 0, matchOver: 0, noMatch: 0 };
    let matchNew = 0,
      matchOver = 0,
      noMatch = 0;
    for (const m of plan.matches) {
      if (m.status === "match-new") matchNew++;
      else if (m.status === "match-overwrite") matchOver++;
      else noMatch++;
    }
    return { matchNew, matchOver, noMatch };
  }, [plan]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1" disabled={!canEdit}>
          <MapPin className="h-4 w-4" /> Import boundaries
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        {view === "home" && (
          <>
            <DialogHeader>
              <DialogTitle>Import block boundaries</DialogTitle>
              <DialogDescription>
                Upload a <b>KML</b> or <b>GeoJSON</b> file containing block
                polygons. Each polygon is matched to an existing block by{" "}
                <b>name</b> and only the boundary is written.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-1">
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={() => fileRef.current?.click()}
                disabled={!canEdit}
              >
                <Upload className="h-4 w-4" />
                <span className="font-medium">Choose KML or GeoJSON file</span>
                <span className="text-xs text-muted-foreground">
                  {canEdit
                    ? "Preview matches before applying"
                    : "Manager role required"}
                </span>
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".kml,.geojson,.json,application/vnd.google-earth.kml+xml,application/geo+json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <Alert>
              <AlertTitle>How matching works</AlertTitle>
              <AlertDescription className="space-y-2 text-xs">
                <p>
                  Each polygon's <b>name</b> (KML <code>&lt;name&gt;</code> or
                  GeoJSON <code>properties.name</code>) must exactly match an
                  existing block name (case-insensitive).
                </p>
                <p>
                  Only <b>polygon boundaries</b> are written. Rows, vine
                  spacing, varieties, and all other setup fields are untouched.
                  Row geometry is regenerated by the iOS app the next time a
                  block is opened in the field.
                </p>
                <p className="text-muted-foreground">
                  Tips: export from Google Earth, QGIS, or a drone-mapping tool.
                  MultiPolygon features use the largest ring.
                </p>
              </AlertDescription>
            </Alert>
          </>
        )}

        {view === "preview" && parsed && plan && (
          <>
            <DialogHeader>
              <DialogTitle>Preview boundary import</DialogTitle>
              <DialogDescription>
                <code>{filename}</code> · {parsed.features.length} polygon
                {parsed.features.length === 1 ? "" : "s"} parsed
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="New boundaries" value={counts.matchNew} />
                <Stat
                  label="Will overwrite"
                  value={counts.matchOver}
                  warn={counts.matchOver > 0 && !overwriteExisting ? false : counts.matchOver > 0}
                />
                <Stat
                  label="No match"
                  value={counts.noMatch}
                  warn={counts.noMatch > 0}
                />
              </div>

              {counts.matchOver > 0 && (
                <label className="flex items-start gap-2 rounded border p-2 text-xs">
                  <Checkbox
                    checked={overwriteExisting}
                    onCheckedChange={(v) => setOverwriteExisting(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Overwrite existing boundaries on {counts.matchOver} block
                    {counts.matchOver === 1 ? "" : "s"} that already have one.
                    Leave unchecked to only fill in blocks without a boundary.
                  </span>
                </label>
              )}

              {parsed.warnings.length > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle className="text-sm">Parse warnings</AlertTitle>
                  <AlertDescription className="text-xs">
                    <ul className="list-disc pl-4">
                      {parsed.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <ScrollArea className="h-48 rounded border p-2 text-xs">
                {plan.matches.map((m, i) => (
                  <div key={i} className="flex items-center justify-between py-0.5">
                    <span className="font-medium">
                      {m.feature.name || <em className="text-muted-foreground">(no name)</em>}
                    </span>
                    {m.status === "match-new" && (
                      <Badge variant="secondary">→ {m.paddockName} (new)</Badge>
                    )}
                    {m.status === "match-overwrite" && (
                      <Badge variant="outline">
                        → {m.paddockName} (overwrite)
                      </Badge>
                    )}
                    {m.status === "no-match" && (
                      <Badge variant="destructive">no matching block</Badge>
                    )}
                  </div>
                ))}
              </ScrollArea>

              {plan.unmatchedPaddocks.length > 0 && (
                <div className="rounded border bg-muted/30 p-2 text-xs">
                  <div className="mb-1 font-medium">
                    Blocks in this vineyard with no polygon in the file (
                    {plan.unmatchedPaddocks.length}):
                  </div>
                  <div className="text-muted-foreground">
                    {plan.unmatchedPaddocks.map((p) => p.name).join(", ")}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={handleApply}
                disabled={
                  busy ||
                  !canEdit ||
                  counts.matchNew + (overwriteExisting ? counts.matchOver : 0) === 0
                }
                className="gap-1"
              >
                <MapPin className="h-4 w-4" /> Apply boundaries
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded border p-2 text-center ${
        warn ? "border-warning/60 bg-warning/10" : ""
      }`}
    >
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
