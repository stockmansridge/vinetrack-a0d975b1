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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Download, Upload, FileDown, FileUp, AlertTriangle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import {
  applyImport,
  buildApplyPlan,
  buildPaddocksCsv,
  buildPaddocksTemplateCsv,
  downloadCsv,
  parsePaddocksCsv,
  safeFileBase,
  type ApplyPlan,
  type ImportMode,
  type ParsedImport,
  type PaddockRow,
} from "@/lib/paddockImportExport";
import { toast } from "sonner";

const REPLACE_CONFIRM_PHRASE =
  "I understand this will archive or replace existing block setup.";

export default function PaddockImportExportDialog() {
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const queryClient = useQueryClient();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ??
    "Vineyard";

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"home" | "preview">("home");
  const [mode, setMode] = useState<ImportMode>("add-new");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: paddocks = [] } = useQuery<PaddockRow[]>({
    queryKey: ["paddocks-export", selectedVineyardId],
    enabled: !!selectedVineyardId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("*")
        .eq("vineyard_id", selectedVineyardId!)
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []) as PaddockRow[];
    },
  });

  const plan: ApplyPlan | null = useMemo(() => {
    if (!parsed) return null;
    return buildApplyPlan(parsed, paddocks, mode);
  }, [parsed, paddocks, mode]);

  const reset = () => {
    setParsed(null);
    setFilename("");
    setConfirmText("");
    setView("home");
    setMode("add-new");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleExport = () => {
    if (!paddocks.length) {
      toast.info("No paddocks to export.");
      return;
    }
    const csv = buildPaddocksCsv(paddocks, vineyardName);
    downloadCsv(`Paddocks_${safeFileBase(vineyardName)}_${todayStr()}.csv`, csv);
  };

  const handleTemplate = () => {
    downloadCsv("Paddocks_Import_Template.csv", buildPaddocksTemplateCsv());
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    const p = parsePaddocksCsv(text);
    setParsed(p);
    setFilename(file.name);
    setView("preview");
  };

  const handleApply = async () => {
    if (!plan || !selectedVineyardId) return;
    if (mode === "replace-all" && confirmText.trim() !== REPLACE_CONFIRM_PHRASE) {
      toast.error("Please type the confirmation phrase exactly.");
      return;
    }
    setBusy(true);
    try {
      const result = await applyImport(plan, paddocks, selectedVineyardId);
      const overrideNote =
        result.rowOverridesQueued > 0
          ? ` (${result.rowOverridesQueued} per-row override(s) reviewed — persistence pending)`
          : "";
      if (result.errors.length) {
        toast.error(
          `Import finished with ${result.errors.length} error(s). Created ${result.inserted}, updated ${result.updated}, archived ${result.archived}.${overrideNote}`,
        );
      } else {
        toast.success(
          `Created ${result.inserted}, updated ${result.updated}, archived ${result.archived}, skipped ${result.skipped}.${overrideNote}`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["list", "paddocks"] });
      await queryClient.invalidateQueries({ queryKey: ["paddocks-export"] });
      reset();
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const totalErrors = parsed?.rows.filter((r) => r.errors.length > 0).length ?? 0;
  const totalWarnings = parsed?.rows.filter((r) => r.warnings.length > 0).length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <FileDown className="h-4 w-4" /> Export / Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        {view === "home" && (
          <>
            <DialogHeader>
              <DialogTitle>Paddocks export & import</DialogTitle>
              <DialogDescription>
                Export your block setup as CSV, download a blank template, or
                import a CSV to add or update paddocks in <b>{vineyardName}</b>.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-3">
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={handleExport}
              >
                <Download className="h-4 w-4" />
                <span className="font-medium">Export paddocks</span>
                <span className="text-xs text-muted-foreground">
                  {paddocks.length} blocks → CSV
                </span>
              </Button>
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={handleTemplate}
              >
                <FileDown className="h-4 w-4" />
                <span className="font-medium">Import template</span>
                <span className="text-xs text-muted-foreground">
                  Blank CSV with required columns
                </span>
              </Button>
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={() => fileRef.current?.click()}
                disabled={!canEdit}
              >
                <Upload className="h-4 w-4" />
                <span className="font-medium">Import CSV</span>
                <span className="text-xs text-muted-foreground">
                  {canEdit ? "Preview before applying" : "Manager role required"}
                </span>
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <Alert>
              <AlertTitle>Safe by default</AlertTitle>
              <AlertDescription className="space-y-2 text-xs">
                <p>
                  Polygon and row geometry are <b>never</b> changed by import.
                  Only setup fields are written. Existing variety/clone
                  allocations linked to block polygons are preserved. Replace
                  mode soft-archives missing blocks and never hard-deletes.
                </p>
                <p>
                  <b>Row length overrides</b> are used for vineyard setup
                  calculations such as vines, posts, drippers, and irrigation
                  estimates. They do not change Live Trip row tracking or field
                  guidance geometry.
                </p>
                <p className="text-muted-foreground">
                  Compact format in the <code>row_lengths_override_m</code>{" "}
                  column: <code>1:245;2:244.2;3.5:243.8</code>. Per-row override
                  storage is awaiting a schema decision: values are validated
                  and shown in preview but not yet written to the database.
                </p>
              </AlertDescription>
            </Alert>
          </>
        )}

        {view === "preview" && parsed && plan && (
          <>
            <DialogHeader>
              <DialogTitle>Preview import</DialogTitle>
              <DialogDescription>
                <code>{filename}</code> · {parsed.rows.length} rows parsed
                {parsed.unknownColumns.length > 0 && (
                  <span className="ml-2 text-warning">
                    Unknown columns ignored: {parsed.unknownColumns.join(", ")}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div>
                <Label className="mb-2 block">Import mode</Label>
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => setMode(v as ImportMode)}
                  className="grid gap-2 sm:grid-cols-3"
                >
                  <ModeCard
                    value="add-new"
                    title="Add new only"
                    desc="Create new blocks. Skip rows whose name already exists."
                  />
                  <ModeCard
                    value="update-matching"
                    title="Update matching"
                    desc="Update setup fields on blocks matched by name. Geometry untouched."
                  />
                  <ModeCard
                    value="replace-all"
                    title="Replace / start again"
                    desc="Update matching, insert new, soft-archive any block missing from CSV."
                    danger
                  />
                </RadioGroup>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                <Stat label="Created" value={plan.toInsert.length} />
                <Stat label="Updated" value={plan.toUpdate.length} />
                <Stat
                  label="Archived"
                  value={plan.toArchive.length}
                  warn={plan.toArchive.length > 0}
                />
                <Stat label="Skipped" value={plan.toSkip.length} />
                <Stat
                  label="Warnings"
                  value={totalWarnings}
                  warn={totalWarnings > 0}
                />
                <Stat label="Errors" value={totalErrors} warn={totalErrors > 0} />
              </div>

              {plan.rowOverrideChanges.length > 0 && (
                <Alert>
                  <AlertTitle className="text-sm">
                    Row length override changes ({plan.rowOverrideChanges.length} block
                    {plan.rowOverrideChanges.length === 1 ? "" : "s"})
                  </AlertTitle>
                  <AlertDescription className="space-y-1 text-xs">
                    <p className="text-muted-foreground">
                      Calculation only — does not affect Live Trip tracking.
                      Persistence pending schema decision; values shown for
                      review only.
                    </p>
                    <div className="max-h-24 overflow-y-auto rounded border bg-muted/30 p-2">
                      {plan.rowOverrideChanges.map((c) => (
                        <div key={c.blockName} className="flex justify-between">
                          <span className="font-medium">{c.blockName}</span>
                          <span className="text-muted-foreground">
                            {c.cleared
                              ? "clear all overrides"
                              : `${c.count} row override${c.count === 1 ? "" : "s"}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {(totalErrors > 0 || totalWarnings > 0 || plan.toSkip.length > 0) && (
                <ScrollArea className="h-40 rounded border p-2 text-xs">
                  {parsed.rows
                    .filter((r) => r.errors.length || r.warnings.length)
                    .map((r) => (
                      <div key={r.rowIndex} className="mb-1">
                        <span className="font-mono text-muted-foreground">
                          row {r.rowIndex + 1}:
                        </span>{" "}
                        <span className="font-medium">
                          {r.values.name || "(no name)"}
                        </span>
                        {r.errors.map((e, i) => (
                          <Badge
                            key={`e${i}`}
                            variant="destructive"
                            className="ml-1"
                          >
                            {e}
                          </Badge>
                        ))}
                        {r.warnings.map((w, i) => (
                          <Badge key={`w${i}`} variant="secondary" className="ml-1">
                            {w}
                          </Badge>
                        ))}
                      </div>
                    ))}
                </ScrollArea>
              )}

              {mode === "replace-all" && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Replace mode is destructive</AlertTitle>
                  <AlertDescription className="space-y-2 text-xs">
                    <p>
                      {plan.toArchive.length} existing block(s) not in this CSV will
                      be archived (soft-deleted).
                    </p>
                    <p>Type the phrase below to enable apply:</p>
                    <code className="block rounded bg-muted p-1">
                      {REPLACE_CONFIRM_PHRASE}
                    </code>
                    <Input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="Type to confirm"
                    />
                  </AlertDescription>
                </Alert>
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
                  (plan.toInsert.length === 0 &&
                    plan.toUpdate.length === 0 &&
                    plan.toArchive.length === 0) ||
                  (mode === "replace-all" &&
                    confirmText.trim() !== REPLACE_CONFIRM_PHRASE)
                }
                className="gap-1"
              >
                <FileUp className="h-4 w-4" /> Apply import
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModeCard({
  value,
  title,
  desc,
  danger,
}: {
  value: string;
  title: string;
  desc: string;
  danger?: boolean;
}) {
  return (
    <Label
      htmlFor={`mode-${value}`}
      className={`flex cursor-pointer items-start gap-2 rounded border p-2 hover:bg-accent/40 ${
        danger ? "border-destructive/40" : ""
      }`}
    >
      <RadioGroupItem id={`mode-${value}`} value={value} className="mt-1" />
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </Label>
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

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
