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
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Database, Download, Upload, AlertTriangle, FileJson, PlusCircle } from "lucide-react";
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
  type ImportApplyResult,
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

// Union of all writable columns for "import as new" mode.
const NEW_BLOCK_COLUMNS = Array.from(
  new Set(GROUP_ORDER.flatMap((g) => FIELD_GROUP_COLUMNS[g])),
);

function isEmpty(v: any) {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

interface CreateResult {
  blocksCreated: number;
  fieldsWritten: number;
  skippedFields: number;
  errors: string[];
}

async function applyImportAsNew(
  source: FullBlock[],
  targetVineyardId: string,
): Promise<CreateResult> {
  const result: CreateResult = {
    blocksCreated: 0,
    fieldsWritten: 0,
    skippedFields: 0,
    errors: [],
  };
  for (const s of source) {
    const row: Record<string, any> = {
      vineyard_id: targetVineyardId,
      name: (s.name ?? "").trim() || "Imported block",
    };
    let written = 0;
    for (const col of NEW_BLOCK_COLUMNS) {
      const v = (s as any)[col];
      if (isEmpty(v)) {
        result.skippedFields++;
        continue;
      }
      row[col] = v;
      written++;
    }
    const { error } = await supabase.from("paddocks").insert(row);
    if (error) {
      result.errors.push(`${row.name}: ${error.message}`);
      continue;
    }
    result.blocksCreated++;
    result.fieldsWritten += written;
  }
  return result;
}

export default function PaddockFullBlockBackupDialog() {
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const queryClient = useQueryClient();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ??
    "Vineyard";

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"export" | "import">("export");
  const [view, setView] = useState<"home" | "preview" | "result">("home");
  const [parsed, setParsed] = useState<FullBlockBackup | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [opts, setOpts] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [importAsNew, setImportAsNew] = useState(false);
  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<
    | { mode: "update"; data: ImportApplyResult }
    | { mode: "new"; data: CreateResult }
    | null
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  // Counts for "import as new" mode
  const newCounts = useMemo(() => {
    if (!parsed) return { sourceBlocks: 0, toCreate: 0, toUpdate: 0, fieldsToWrite: 0 };
    let fields = 0;
    for (const s of parsed.blocks) {
      for (const col of NEW_BLOCK_COLUMNS) {
        if (!isEmpty((s as any)[col])) fields++;
      }
    }
    return {
      sourceBlocks: parsed.blocks.length,
      toCreate: parsed.blocks.length,
      toUpdate: 0,
      fieldsToWrite: fields,
    };
  }, [parsed]);

  const destHasBlocks = blocks.length > 0;

  const reset = () => {
    setParsed(null);
    setFilename("");
    setOpts(DEFAULT_IMPORT_OPTIONS);
    setImportAsNew(false);
    setConfirmDuplicates(false);
    setLastResult(null);
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
    if (!parsed || !selectedVineyardId) return;
    setBusy(true);
    try {
      if (importAsNew) {
        const result = await applyImportAsNew(parsed.blocks, selectedVineyardId);
        setLastResult({ mode: "new", data: result });
        if (result.errors.length) {
          toast.error(
            `Created ${result.blocksCreated} block(s), ${result.errors.length} error(s).`,
          );
        } else {
          toast.success(
            `Created ${result.blocksCreated} block(s), wrote ${result.fieldsWritten} field(s).`,
          );
        }
      } else {
        if (!plan) return;
        const result = await applyImportPlan(plan, selectedVineyardId);
        setLastResult({ mode: "update", data: result });
        if (result.errors.length) {
          toast.error(
            `Updated ${result.blocksUpdated} block(s), wrote ${result.fieldsWritten} field(s), ${result.errors.length} error(s).`,
          );
        } else {
          toast.success(
            `Updated ${result.blocksUpdated} block(s), wrote ${result.fieldsWritten} field(s). ${result.blocksUnchanged} unchanged.`,
          );
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["list", "paddocks"] });
      await queryClient.invalidateQueries({ queryKey: ["paddocks-fullblock"] });
      await queryClient.invalidateQueries({ queryKey: ["paddocks-export"] });
      await queryClient.invalidateQueries({ queryKey: ["paddocks-boundary-export"] });
      await queryClient.invalidateQueries({ queryKey: ["paddocks-boundary-import"] });
      setView("result");
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  };

  // Counts for matching preview
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

  const canApply = importAsNew
    ? canEdit &&
      newCounts.toCreate > 0 &&
      (!destHasBlocks || confirmDuplicates)
    : canEdit && counts.willWrite > 0 && counts.matched > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1">
          <Database className="h-4 w-4" /> Full Block Backup & Restore
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Full Block Backup & Restore</DialogTitle>
          <DialogDescription>
            Export or restore full block setup data for <b>{vineyardName}</b>,
            including boundaries, rows, row direction, spacing, emitter
            settings, vine counts and variety allocations.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="text-sm">Use this for backup, restore or migration</AlertTitle>
          <AlertDescription className="text-xs">
            This is the recommended tool for copying blocks between vineyards,
            restoring missing data, or migrating a full block setup. For simple
            spreadsheet review, use reports/exports if available.
          </AlertDescription>
        </Alert>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="export">
              <Download className="mr-1 h-4 w-4" /> Export
            </TabsTrigger>
            <TabsTrigger value="import">
              <Upload className="mr-1 h-4 w-4" /> Restore
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
                <code className="break-words">{FIELD_LIST.join(", ")}</code>.
                Computed/derived values (area, row count, total length) are{" "}
                <b>not</b> stored — they're recalculated from this data.
              </AlertDescription>
            </Alert>
            <div className="flex justify-end">
              <Button onClick={handleExport} disabled={isLoading || !blocks.length}>
                <Download className="mr-1 h-4 w-4" /> Export Full Block Backup
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
                  <span className="font-medium">
                    Import / Restore Full Block Backup
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {canEdit
                      ? "Upload a VineTrack Full Block Backup JSON file. Blocks are matched by name and you can preview every field before applying changes."
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

                {/* Import-as-new switch */}
                <div className="flex items-start justify-between gap-3 rounded border bg-muted/20 p-3">
                  <div className="space-y-1">
                    <Label htmlFor="import-as-new" className="text-sm font-medium">
                      Import all as new blocks
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Use this when the destination vineyard is empty or you
                      want to copy a full vineyard/block setup into this
                      vineyard.
                    </p>
                  </div>
                  <Switch
                    id="import-as-new"
                    checked={importAsNew}
                    onCheckedChange={(v) => {
                      setImportAsNew(v);
                      setConfirmDuplicates(false);
                    }}
                  />
                </div>

                {importAsNew ? (
                  <>
                    <div className="grid grid-cols-4 gap-2">
                      <Stat label="Source blocks" value={newCounts.sourceBlocks} />
                      <Stat label="Blocks to create" value={newCounts.toCreate} />
                      <Stat label="Blocks to update" value={newCounts.toUpdate} />
                      <Stat label="Fields to write" value={newCounts.fieldsToWrite} />
                    </div>

                    {destHasBlocks && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle className="text-sm">
                          This vineyard already has blocks
                        </AlertTitle>
                        <AlertDescription className="text-xs space-y-2">
                          <div>
                            Importing all as new blocks may create duplicates.
                            <b> {vineyardName}</b> currently has {blocks.length}{" "}
                            block{blocks.length === 1 ? "" : "s"}.
                          </div>
                          <label className="flex items-center gap-2 text-xs">
                            <Checkbox
                              checked={confirmDuplicates}
                              onCheckedChange={(v) =>
                                setConfirmDuplicates(v === true)
                              }
                            />
                            <span>
                              I understand and want to create new blocks anyway.
                            </span>
                          </label>
                        </AlertDescription>
                      </Alert>
                    )}

                    <ScrollArea className="h-56 rounded border p-2 text-xs">
                      {parsed.blocks.map((s, i) => {
                        const fields = NEW_BLOCK_COLUMNS.filter(
                          (c) => !isEmpty((s as any)[c]),
                        );
                        return (
                          <div key={i} className="border-b py-1 last:border-b-0">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">
                                {s.name || (
                                  <em className="text-muted-foreground">(no name)</em>
                                )}
                              </span>
                              <Badge variant="secondary" className="gap-1">
                                <PlusCircle className="h-3 w-3" /> will create new block
                              </Badge>
                            </div>
                            <div className="ml-2 mt-0.5 flex flex-wrap gap-1">
                              {fields.map((c, j) => (
                                <Badge
                                  key={j}
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {c}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </ScrollArea>
                  </>
                ) : (
                  <>
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
                      <Stat label="Fields to write" value={counts.willWrite} />
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
                          These target blocks already have a non-empty value and
                          the relevant group is not set to overwrite. Tick
                          "Overwrite existing" to replace them.
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
                                  <Badge
                                    key={`w${j}`}
                                    variant="outline"
                                    className="text-[10px]"
                                  >
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
                  </>
                )}
              </div>
            )}

            {view === "result" && lastResult && (
              <div className="space-y-3">
                <Alert>
                  <AlertTitle className="text-sm">Import complete</AlertTitle>
                  <AlertDescription className="text-xs">
                    {lastResult.mode === "new"
                      ? "Source blocks were imported as new blocks into this vineyard."
                      : "Matched blocks were updated using the selected field groups."}
                  </AlertDescription>
                </Alert>
                {lastResult.mode === "new" ? (
                  <div className="grid grid-cols-4 gap-2">
                    <Stat label="Blocks created" value={lastResult.data.blocksCreated} />
                    <Stat label="Blocks updated" value={0} />
                    <Stat label="Fields written" value={lastResult.data.fieldsWritten} />
                    <Stat
                      label="Skipped fields"
                      value={lastResult.data.skippedFields}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    <Stat label="Blocks created" value={0} />
                    <Stat
                      label="Blocks updated"
                      value={lastResult.data.blocksUpdated}
                    />
                    <Stat
                      label="Fields written"
                      value={lastResult.data.fieldsWritten}
                    />
                    <Stat
                      label="Blocks unchanged"
                      value={lastResult.data.blocksUnchanged}
                    />
                  </div>
                )}
                {lastResult.data.errors.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle className="text-sm">
                      {lastResult.data.errors.length} error(s)
                    </AlertTitle>
                    <AlertDescription className="text-xs">
                      <ul className="list-disc pl-4">
                        {lastResult.data.errors.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
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
                disabled={busy || !canApply}
                className="gap-1"
              >
                {importAsNew ? (
                  <>
                    <PlusCircle className="h-4 w-4" /> Import {newCounts.toCreate}{" "}
                    Block{newCounts.toCreate === 1 ? "" : "s"}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" /> Restore Backup ({counts.willWrite}{" "}
                    field{counts.willWrite === 1 ? "" : "s"})
                  </>
                )}
              </Button>
            </>
          ) : view === "result" ? (
            <Button
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Done
            </Button>
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
