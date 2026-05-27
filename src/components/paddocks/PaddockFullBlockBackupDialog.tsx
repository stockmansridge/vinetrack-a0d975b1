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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Database, Download, Upload, AlertTriangle, FileJson } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import {
  applyImportPlan,
  buildFullBlockBackup,
  buildImportPlan,
  DEFAULT_IMPORT_OPTIONS,
  downloadJson,
  FIELD_GROUP_COLUMNS,
  FIELD_GROUP_LABEL,
  FULL_BLOCK_FIELDS,
  parseFullBlockBackup,
  summarizeBackup,
  type FieldGroup,
  type FullBlock,
  type FullBlockBackup,
  type ImportOptions,
  type ImportPlan,
} from "@/lib/paddockFullBlockBackup";
import { toast } from "sonner";

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
function safeBase(s: string) {
  return s.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Vineyard";
}

const FIELD_LIST = FULL_BLOCK_FIELDS.filter(
  (f) => f !== "id" && f !== "vineyard_id" && f !== "name",
);

const GROUP_ORDER: FieldGroup[] = ["boundary", "rows", "setup", "varieties"];

export default function PaddockFullBlockBackupDialog() {
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const queryClient = useQueryClient();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ??
    "Vineyard";

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"export" | "import">("export");
  const [view, setView] = useState<"home" | "preview">("home");
  const [parsed, setParsed] = useState<FullBlockBackup | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [opts, setOpts] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Pull ALL stored block fields (no slim select).
  const selectClause = FULL_BLOCK_FIELDS.join(", ");

  const { data: blocks = [], isLoading } = useQuery<FullBlock[]>({
    queryKey: ["paddocks-fullblock", selectedVineyardId],
    enabled: !!selectedVineyardId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paddocks")
        .select(selectClause)
        .eq("vineyard_id", selectedVineyardId!)
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []) as unknown as FullBlock[];
    },
  });

  const stats = useMemo(() => summarizeBackup(blocks), [blocks]);
  const parsedStats = useMemo(
    () => (parsed ? summarizeBackup(parsed.blocks) : null),
    [parsed],
  );

  const plan: ImportPlan | null = useMemo(() => {
    if (!parsed) return null;
    return buildImportPlan(parsed.blocks, blocks, opts);
  }, [parsed, blocks, opts]);

  const reset = () => {
    setParsed(null);
    setFilename("");
    setOpts(DEFAULT_IMPORT_OPTIONS);
    setView("home");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleExport = () => {
    if (!blocks.length) {
      toast.info("No blocks to export.");
      return;
    }
    const json = buildFullBlockBackup(blocks, {
      id: selectedVineyardId ?? null,
      name: vineyardName,
    });
    downloadJson(
      `Blocks_${safeBase(vineyardName)}_${todayStr()}.full.json`,
      json,
    );
    toast.success(
      `Exported ${blocks.length} block${blocks.length === 1 ? "" : "s"} with full setup.`,
    );
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const p = parseFullBlockBackup(text);
      setParsed(p);
      setFilename(file.name);
      setView("preview");
      setTab("import");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not parse backup file");
    }
  };

  const setPreset = (preset: "all" | "boundaries" | "rows" | "setup" | "varieties") => {
    const next: ImportOptions = {
      groups: { boundary: false, rows: false, setup: false, varieties: false },
      overwrite: { boundary: false, rows: false, setup: false, varieties: false },
    };
    if (preset === "all") {
      next.groups = { boundary: true, rows: true, setup: true, varieties: true };
    } else if (preset === "boundaries") next.groups.boundary = true;
    else if (preset === "rows") next.groups.rows = true;
    else if (preset === "setup") next.groups.setup = true;
    else if (preset === "varieties") next.groups.varieties = true;
    setOpts(next);
  };

  const handleApply = async () => {
    if (!plan || !selectedVineyardId) return;
    setBusy(true);
    try {
      const result = await applyImportPlan(plan, selectedVineyardId);
      if (result.errors.length) {
        toast.error(
          `Updated ${result.blocksUpdated} block(s), wrote ${result.fieldsWritten} field(s), ${result.errors.length} error(s).`,
        );
      } else {
        toast.success(
          `Updated ${result.blocksUpdated} block(s), wrote ${result.fieldsWritten} field(s). ${result.blocksUnchanged} unchanged.`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["list", "paddocks"] });
      await queryClient.invalidateQueries({ queryKey: ["paddocks-fullblock"] });
      await queryClient.invalidateQueries({ queryKey: ["paddocks-export"] });
      await queryClient.invalidateQueries({ queryKey: ["paddocks-boundary-export"] });
      await queryClient.invalidateQueries({ queryKey: ["paddocks-boundary-import"] });
      reset();
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  };

  // Counts for preview
  const counts = useMemo(() => {
    if (!plan) return { matched: 0, noMatch: 0, willWrite: 0, willSkipExisting: 0 };
    let matched = 0,
      noMatch = 0,
      willWrite = 0,
      willSkipExisting = 0;
    for (const m of plan.matches) {
      if (m.status === "match") matched++;
      else noMatch++;
      for (const a of m.fieldActions) {
        if (a.action === "write") willWrite++;
        else if (a.action === "skip-existing-nonempty") willSkipExisting++;
      }
    }
    return { matched, noMatch, willWrite, willSkipExisting };
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
        <Button variant="outline" size="sm" className="gap-1">
          <Database className="h-4 w-4" /> Full block backup
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Full block backup</DialogTitle>
          <DialogDescription>
            Export every stored field for every block in <b>{vineyardName}</b>{" "}
            as a JSON file (boundaries, rows, setup, varieties), or restore
            from a previously exported backup.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="export">
              <Download className="mr-1 h-4 w-4" /> Export
            </TabsTrigger>
            <TabsTrigger value="import">
              <Upload className="mr-1 h-4 w-4" /> Import / restore
            </TabsTrigger>
          </TabsList>

          {/* ---------- EXPORT ---------- */}
          <TabsContent value="export" className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <Stat label="Total blocks" value={stats.total} />
              <Stat
                label="With boundary"
                value={stats.withBoundary}
                warn={stats.total > 0 && stats.withBoundary < stats.total}
              />
              <Stat
                label="With rows"
                value={stats.withRows}
                warn={stats.total > 0 && stats.withRows < stats.total}
              />
              <Stat label="With varieties" value={stats.withVarieties} />
            </div>
            <Alert>
              <FileJson className="h-4 w-4" />
              <AlertTitle>What's included</AlertTitle>
              <AlertDescription className="text-xs">
                Every stored column on each block:{" "}
                <code className="break-words">
                  {FIELD_LIST.join(", ")}
                </code>
                . Computed/derived values (area, row count, total length) are{" "}
                <b>not</b> stored — they're recalculated from this data.
              </AlertDescription>
            </Alert>
            <div className="flex justify-end">
              <Button onClick={handleExport} disabled={isLoading || !blocks.length}>
                <Download className="mr-1 h-4 w-4" /> Download JSON backup
              </Button>
            </div>
          </TabsContent>

          {/* ---------- IMPORT ---------- */}
          <TabsContent value="import" className="space-y-3">
            {view === "home" && (
              <>
                <Button
                  variant="outline"
                  className="h-auto w-full flex-col items-start gap-1 p-4 text-left"
                  onClick={() => fileRef.current?.click()}
                  disabled={!canEdit}
                >
                  <Upload className="h-4 w-4" />
                  <span className="font-medium">Choose JSON backup file</span>
                  <span className="text-xs text-muted-foreground">
                    {canEdit
                      ? "Preview matches before applying"
                      : "Manager role required"}
                  </span>
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
                <Alert>
                  <AlertTitle>Safe by default</AlertTitle>
                  <AlertDescription className="text-xs">
                    Blocks are matched by <b>name</b> (case-insensitive) within{" "}
                    <b>{vineyardName}</b>. Each field group can be enabled
                    independently. Non-empty existing values are <b>preserved</b>{" "}
                    unless you explicitly tick "overwrite existing" for that
                    group. Nothing is hard-deleted.
                  </AlertDescription>
                </Alert>
              </>
            )}

            {view === "preview" && parsed && plan && parsedStats && (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  <code>{filename}</code> · {parsed.blocks.length} block(s)
                  {parsed.vineyard?.name ? (
                    <>
                      {" "}
                      from <b>{parsed.vineyard.name}</b>
                    </>
                  ) : null}
                  {parsed.exported_at ? ` · exported ${parsed.exported_at}` : ""}
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <Stat label="Source blocks" value={parsed.blocks.length} />
                  <Stat
                    label="Matched"
                    value={counts.matched}
                    warn={counts.matched === 0}
                  />
                  <Stat
                    label="Unmatched"
                    value={counts.noMatch}
                    warn={counts.noMatch > 0}
                  />
                  <Stat
                    label="Fields to write"
                    value={counts.willWrite}
                  />
                </div>

                <div className="rounded border p-3">
                  <div className="mb-2 text-sm font-medium">Import options</div>
                  <div className="mb-2 flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => setPreset("all")}>
                      Full block setup
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPreset("boundaries")}>
                      Boundaries only
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPreset("rows")}>
                      Rows only
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPreset("setup")}>
                      Setup fields only
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPreset("varieties")}>
                      Varieties only
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {GROUP_ORDER.map((g) => (
                      <div key={g} className="rounded border bg-muted/20 p-2">
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={opts.groups[g]}
                            onCheckedChange={(v) =>
                              setOpts((o) => ({
                                ...o,
                                groups: { ...o.groups, [g]: v === true },
                              }))
                            }
                          />
                          <span className="font-medium">{FIELD_GROUP_LABEL[g]}</span>
                          <span className="text-xs text-muted-foreground">
                            ({FIELD_GROUP_COLUMNS[g].join(", ")})
                          </span>
                        </label>
                        {opts.groups[g] && (
                          <label className="ml-6 mt-1 flex items-center gap-2 text-xs">
                            <Checkbox
                              checked={opts.overwrite[g]}
                              onCheckedChange={(v) =>
                                setOpts((o) => ({
                                  ...o,
                                  overwrite: { ...o.overwrite, [g]: v === true },
                                }))
                              }
                            />
                            <span>
                              Overwrite existing non-empty values in this group
                            </span>
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {counts.willSkipExisting > 0 && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle className="text-sm">
                      {counts.willSkipExisting} field(s) will be preserved
                    </AlertTitle>
                    <AlertDescription className="text-xs">
                      These target blocks already have a non-empty value and the
                      relevant group is not set to overwrite. Tick "Overwrite
                      existing" to replace them.
                    </AlertDescription>
                  </Alert>
                )}

                <ScrollArea className="h-56 rounded border p-2 text-xs">
                  {plan.matches.map((m, i) => (
                    <div key={i} className="border-b py-1 last:border-b-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {m.source.name || (
                            <em className="text-muted-foreground">(no name)</em>
                          )}
                        </span>
                        {m.status === "match" ? (
                          <Badge variant="secondary">→ {m.targetName}</Badge>
                        ) : (
                          <Badge variant="destructive">no matching block</Badge>
                        )}
                      </div>
                      {m.status === "match" && (
                        <div className="ml-2 mt-0.5 flex flex-wrap gap-1">
                          {m.fieldActions
                            .filter((a) => a.action === "write")
                            .map((a, j) => (
                              <Badge key={`w${j}`} variant="outline" className="text-[10px]">
                                write {a.column}
                              </Badge>
                            ))}
                          {m.fieldActions
                            .filter((a) => a.action === "skip-existing-nonempty")
                            .map((a, j) => (
                              <Badge
                                key={`s${j}`}
                                variant="secondary"
                                className="text-[10px]"
                              >
                                keep {a.column}
                              </Badge>
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
                </ScrollArea>

                {plan.unmatchedTarget.length > 0 && (
                  <div className="rounded border bg-muted/30 p-2 text-xs">
                    <div className="mb-1 font-medium">
                      Blocks in <b>{vineyardName}</b> not in this backup (
                      {plan.unmatchedTarget.length}):
                    </div>
                    <div className="text-muted-foreground">
                      {plan.unmatchedTarget.map((p) => p.name).join(", ")}
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          {view === "preview" ? (
            <>
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={handleApply}
                disabled={
                  busy ||
                  !canEdit ||
                  counts.willWrite === 0 ||
                  counts.matched === 0
                }
                className="gap-1"
              >
                <Upload className="h-4 w-4" /> Apply import ({counts.willWrite} field
                {counts.willWrite === 1 ? "" : "s"})
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
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
