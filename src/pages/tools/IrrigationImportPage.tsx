import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Info,
  LifeBuoy,
  Loader2,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { toast } from "sonner";
import { useVineyard } from "@/context/VineyardContext";
import ImportValveMappingStep from "@/components/irrigation/import/ImportValveMappingStep";
import ImportRowReview from "@/components/irrigation/import/ImportRowReview";
import ImportBatchHistory from "@/components/irrigation/import/ImportBatchHistory";
import {
  COMPARISON_LABEL,
  browserTimezone,
  litresToCubicLabel,
  useCommitImport,
  useImportBatch,
  useImportPreview,
  useImportProviderSettings,
  useImportProviders,
  useImportValves,
  useParseImportFile,
  useSaveImportProviderSettings,
  useValidateImport,
  type CommitResult,
  type ImportPreview,
  type ParseResult,
  type VolumeComparison,
} from "@/lib/irrigationImportQuery";
import { resolveProviderHelp, type ProviderHelp } from "@/lib/irrigationImportProviderHelp";
import { SupportRequestSheet } from "@/components/support/SupportRequestSheet";

const SUPPORT_PREFILL = {
  category: "feature",
  subject: "Request an irrigation controller import",
  message: [
    "I would like VineTrack to support irrigation imports from:",
    "",
    "Controller brand:",
    "Controller model:",
    "Export format, if known:",
  ].join("\n"),
};


type StepId = "source" | "upload" | "settings" | "valves" | "review" | "preview" | "results";

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "source", label: "Import source" },
  { id: "upload", label: "Upload file" },
  { id: "settings", label: "Provider settings" },
  { id: "valves", label: "Valve mappings" },
  { id: "review", label: "Review" },
  { id: "preview", label: "Preview & commit" },
  { id: "results", label: "Results" },
];

export default function IrrigationImportPage() {
  const { selectedVineyardId, memberships } = useVineyard();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;

  const [step, setStep] = useState<StepId>("source");
  const [provider, setProvider] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [ackOpen, setAckOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);


  const providersQ = useImportProviders();
  const parse = useParseImportFile();
  const validate = useValidateImport();
  const commit = useCommitImport();

  const batchId = parseResult?.batch_id ?? null;
  const controllerKey = (parseResult?.file?.unit_name ?? parseResult?.batch?.external_controller_key ?? "") || "";
  const controllerName = parseResult?.file?.unit_name ?? parseResult?.batch?.external_controller_name ?? null;
  const revalidationOnly = !!parseResult?.duplicate_file;

  const settingsQ = useImportProviderSettings(selectedVineyardId, provider, controllerKey);
  const previewQ = useImportPreview(batchId);
  const batchQ = useImportBatch(batchId);
  const valvesQ = useImportValves(batchId);

  const preview: ImportPreview | null =
    (previewQ.data as ImportPreview | null) ?? (parseResult?.preview ?? null);

  const selectedProvider = useMemo(
    () => (providersQ.data ?? []).find((p) => p.provider_id === provider) ?? null,
    [providersQ.data, provider],
  );

  const providerHelp = useMemo(
    () =>
      resolveProviderHelp(
        provider,
        selectedProvider as unknown as {
          display_name?: string | null;
          import_instructions?: unknown;
          help_steps?: unknown;
        } | null,
      ),
    [provider, selectedProvider],
  );



  // Reset the whole wizard when the vineyard changes — batches are per vineyard.
  const lastVineyard = useRef(selectedVineyardId);
  useEffect(() => {
    if (lastVineyard.current !== selectedVineyardId) {
      lastVineyard.current = selectedVineyardId;
      setStep("source");
      setParseResult(null);
      setCommitResult(null);
    }
  }, [selectedVineyardId]);

  const unmappedValves = (valvesQ.data ?? []).filter(
    (v) => v.status !== "saved" && v.status !== "ignored",
  ).length;

  const goCommit = async () => {
    if (!batchId) return;
    setAckOpen(false);
    try {
      const result = await commit.mutateAsync({
        batchId,
        rowIds: null,
        acknowledgeCurrentConfiguration: true,
      });
      setCommitResult(result);
      setStep("results");
      toast.success(`${result.imported} irrigation session${result.imported === 1 ? "" : "s"} imported.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-muted-foreground">
          <Link to="/irrigation">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Irrigation Records
          </Link>
        </Button>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Irrigation import</h1>
        <p className="text-sm text-muted-foreground">
          Import controller irrigation history into VineTrack
          {vineyardName ? ` for ${vineyardName}` : ""}. System Administrators only.
        </p>
      </header>

      <Stepper current={step} onSelect={(id) => setStep(id)} enabled={batchId} />

      {!selectedVineyardId && (
        <PortalNotice variant="warning" title="Select a vineyard first">
          Imports are scoped to a single vineyard and controller.
        </PortalNotice>
      )}

      {step === "source" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Irrigation controller</CardTitle>
              <CardDescription>
                Select the system that created the irrigation export file. VineTrack uses this to
                interpret the file correctly.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {providersQ.isLoading && (
                <p className="text-sm text-muted-foreground">Loading irrigation controllers…</p>
              )}
              {providersQ.error && (
                <PortalNotice variant="error" title="Couldn't load irrigation controllers">
                  {(providersQ.error as Error).message}
                </PortalNotice>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                {(providersQ.data ?? []).map((p) => (
                  <button
                    key={p.provider_id}
                    type="button"
                    onClick={() => setProvider(p.provider_id)}
                    className={`rounded-lg border p-4 text-left transition-colors hover:bg-sidebar-accent/40 ${
                      provider === p.provider_id ? "border-sidebar-primary bg-sidebar-accent" : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <FileSpreadsheet className="h-4 w-4" />
                      {p.display_name}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.supported_file_types.map((t) => t.toUpperCase()).join(" / ")} ·{" "}
                      {Math.round((p.max_file_size_bytes ?? 0) / 1048576)} MB max
                    </p>
                  </button>
                ))}
              </div>

              {providerHelp && <ProviderInstructions help={providerHelp} />}

              <div className="flex justify-end">
                <Button disabled={!provider || !selectedVineyardId} onClick={() => setStep("upload")}>
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>

          <UnlistedControllerPanel onContact={() => setSupportOpen(true)} />
        </div>
      )}


      {step === "upload" && selectedVineyardId && provider && (
        <UploadStep
          provider={provider}
          providerLabel={selectedProvider?.display_name ?? provider}
          accept={selectedProvider?.supported_file_types ?? ["xlsx", "csv"]}
          maxBytes={selectedProvider?.max_file_size_bytes ?? null}
          help={providerHelp}
          busy={parse.isPending}

          onUpload={async (file, allowRevalidation) => {
            try {
              const result = await parse.mutateAsync({
                vineyardId: selectedVineyardId,
                provider,
                parserEdgeFunction:
                  selectedProvider?.parser_edge_function ?? `parse-${provider.replace(/_/g, "-")}-import`,
                file,
                timezone: browserTimezone(),
                allowRevalidation,
              });
              setParseResult(result);
              setCommitResult(null);
              if (result.duplicate_file) {
                toast.warning(result.message ?? "This file has already been processed for this vineyard.");
              } else {
                toast.success("File parsed. Review the import settings.");
              }
              setStep("settings");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e));
            }
          }}
          result={parseResult}
        />
      )}

      {step === "settings" && batchId && selectedVineyardId && provider && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Provider settings</CardTitle>
            <CardDescription>
              Controller: {controllerName ?? "Provider default"} · these rules classify this batch and
              become the saved default for this controller.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SettingsForm
              vineyardId={selectedVineyardId}
              provider={provider}
              controllerKey={controllerKey}
              controllerName={controllerName}
              batchId={batchId}
              initial={{
                minimum_volume_litres:
                  settingsQ.data?.minimum_volume_litres ??
                  preview?.threshold_litres ??
                  selectedProvider?.default_import_thresholds?.minimum_import_volume_litres ??
                  null,
                volume_comparison:
                  settingsQ.data?.volume_comparison ??
                  preview?.volume_comparison ??
                  selectedProvider?.default_import_thresholds?.comparison ??
                  "greater_than",
                exclude_test_programs:
                  settingsQ.data?.exclude_test_programs ??
                  preview?.exclude_test_programs ??
                  selectedProvider?.default_import_thresholds?.exclude_test_programs ??
                  true,
              }}
              onDone={() => setStep("valves")}
            />
          </CardContent>
        </Card>
      )}

      {step === "valves" && batchId && selectedVineyardId && provider && (
        <div className="space-y-4">
          <ImportValveMappingStep
            batchId={batchId}
            vineyardId={selectedVineyardId}
            provider={provider}
            controllerKey={controllerKey}
            controllerName={controllerName}
          />
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("settings")}>
              Back
            </Button>
            <Button onClick={() => setStep("review")}>Continue to review</Button>
          </div>
        </div>
      )}

      {step === "review" && batchId && (
        <div className="space-y-4">
          {unmappedValves > 0 && (
            <PortalNotice variant="warning" title={`${unmappedValves} controller valve(s) still need mapping`}>
              Events on those valves will not be imported until the mapping is resolved.
            </PortalNotice>
          )}
          <ImportRowReview
            batchId={batchId}
            providerLabel={selectedProvider?.display_name ?? provider ?? ""}
            thresholdLitres={preview?.threshold_litres}
            volumeComparison={preview?.volume_comparison}
            thresholdExplanation={preview?.threshold_explanation}
          />
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("valves")}>
              Back
            </Button>
            <Button
              onClick={async () => {
                await validate.mutateAsync({ batchId });
                await previewQ.refetch();
                setStep("preview");
              }}
              disabled={validate.isPending}
            >
              {validate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Preview import
            </Button>
          </div>
        </div>
      )}

      {step === "preview" && batchId && (
        <div className="space-y-4">
          <PreviewPanel
            preview={preview}
            providerLabel={selectedProvider?.display_name ?? provider ?? ""}
            controllerName={controllerName}
            unmappedValves={unmappedValves}
          />
          {revalidationOnly && (
            <PortalNotice variant="warning" title="Validation-only batch">
              This file was already processed for this vineyard, so this batch was re-parsed for
              validation only and can never be committed. Open the original batch in Import history to
              review its results.
            </PortalNotice>
          )}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("review")}>
              Back
            </Button>
            <Button
              size="lg"
              disabled={revalidationOnly || !preview || preview.selected_for_import === 0 || commit.isPending}
              onClick={() => setAckOpen(true)}
            >
              {commit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Commit import
              {preview ? ` (${preview.selected_for_import})` : ""}
            </Button>
          </div>
        </div>
      )}

      {step === "results" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Import results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {commitResult ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <Stat label="Imported" value={commitResult.imported} />
                <Stat label="Already imported" value={commitResult.already_imported} />
                <Stat label="Skipped duplicates" value={commitResult.skipped_duplicate} />
                <Stat label="Needs review" value={commitResult.needs_review} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No commit has been run in this session.</p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setParseResult(null); setCommitResult(null); setStep("source"); }}>
                Start another import
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ImportBatchHistory vineyardId={selectedVineyardId} provider={provider} />

      <Dialog open={ackOpen} onOpenChange={setAckOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Use the current valve configuration?</DialogTitle>
            <DialogDescription>
              Imported water will be allocated using the valve's current VineTrack connection. Confirm
              that this connection reflects the imported period.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAckOpen(false)}>
              Hold for review
            </Button>
            <Button onClick={() => void goCommit()}>Use current saved valve configuration</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {batchQ.error && (
        <PortalNotice variant="error" title="Couldn't load the batch">
          {(batchQ.error as Error).message}
        </PortalNotice>
      )}

      <SupportRequestSheet
        open={supportOpen}
        onOpenChange={setSupportOpen}
        prefill={SUPPORT_PREFILL}
      />
    </div>
  );
}

function ProviderInstructions({ help }: { help: ProviderHelp }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-4">
      <p className="text-sm font-medium">{help.title}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        {help.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {help.formatNote && <p className="mt-3 text-xs text-muted-foreground">{help.formatNote}</p>}
      {help.duplicateNote && (
        <p className="mt-1 text-xs text-muted-foreground">{help.duplicateNote}</p>
      )}
    </div>
  );
}

function UnlistedControllerPanel({ onContact }: { onContact: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Can't see your irrigation controller?</CardTitle>
        <CardDescription>
          We are continuing to add support for more irrigation systems. Contact VineTrack Support and
          tell us which controller you use, and we will review whether its export format can be
          added.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={onContact}>
          <LifeBuoy className="mr-1.5 h-4 w-4" /> Contact support
        </Button>
      </CardContent>
    </Card>
  );
}


function Stepper({
  current,
  onSelect,
  enabled,
}: {
  current: StepId;
  onSelect: (id: StepId) => void;
  enabled: string | null;
}) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((s, i) => {
        const active = s.id === current;
        const reachable = i <= 1 || !!enabled;
        return (
          <li key={s.id}>
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onSelect(s.id)}
              className={`rounded-md border px-3 py-1.5 transition-colors disabled:opacity-40 ${
                active
                  ? "border-sidebar-primary bg-sidebar-accent font-medium"
                  : i < currentIndex
                    ? "border-border text-muted-foreground hover:bg-sidebar-accent/40"
                    : "border-border text-muted-foreground"
              }`}
            >
              {i + 1}. {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function UploadStep({
  provider,
  providerLabel,
  accept,
  maxBytes,
  help,
  busy,
  onUpload,
  result,
}: {
  provider: string;
  providerLabel: string;
  accept: string[];
  maxBytes: number | null;
  help: ProviderHelp | null;
  busy: boolean;
  onUpload: (file: File, allowRevalidation: boolean) => Promise<void>;
  result: ParseResult | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [allowRevalidation, setAllowRevalidation] = useState(false);
  const maxMb = maxBytes ? Math.round(maxBytes / 1048576) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Upload the {providerLabel} export</CardTitle>
        <CardDescription>
          Accepted file types: {accept.map((a) => a.toUpperCase()).join(", ")}. The file is parsed on the
          server; nothing is written to your irrigation records at this stage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {help && <ProviderInstructions help={help} />}

        <div className="space-y-2">
          <Label htmlFor="import-file" className="flex items-center gap-1.5">
            Controller export file
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="About the export file">
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Upload the original controller export without editing its columns or headings.
              </TooltipContent>
            </Tooltip>
          </Label>
          <Input
            id="import-file"
            type="file"
            accept={accept.map((a) => `.${a}`).join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">
            Upload the original controller export without editing its columns or headings. Supported
            formats: {accept.map((a) => a.toUpperCase()).join(" and ")}
            {maxMb ? `. Maximum file size: ${maxMb} MB.` : "."}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={allowRevalidation}
            onCheckedChange={(v) => setAllowRevalidation(v === true)}
          />
          Re-process an already-imported file for validation only (never committable)
        </label>
        <Button disabled={!file || busy} onClick={() => file && void onUpload(file, allowRevalidation)}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          Upload and parse
        </Button>

        {result?.file && (
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">{result.file.name}</p>
            <p className="text-muted-foreground">
              Worksheet {result.file.worksheet ?? "—"} · Controller {result.file.unit_name ?? "—"} ·{" "}
              {result.file.source_rows ?? 0} rows · {result.file.rows_with_parse_errors ?? 0} parse errors
            </p>
            <p className="text-xs text-muted-foreground">Provider: {provider}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsForm({
  vineyardId,
  provider,
  controllerKey,
  controllerName,
  batchId,
  initial,
  onDone,
}: {
  vineyardId: string;
  provider: string;
  controllerKey: string;
  controllerName: string | null;
  batchId: string;
  initial: { minimum_volume_litres: number | null; volume_comparison: VolumeComparison; exclude_test_programs: boolean };
  onDone: () => void;
}) {
  const [cubic, setCubic] = useState(
    initial.minimum_volume_litres == null ? "" : String(initial.minimum_volume_litres / 1000),
  );
  const [comparison, setComparison] = useState<VolumeComparison>(initial.volume_comparison);
  const [excludeTest, setExcludeTest] = useState(initial.exclude_test_programs);
  const save = useSaveImportProviderSettings();
  const validate = useValidateImport();

  const litres = Math.round(Number(cubic || 0) * 1000);

  const submit = async () => {
    try {
      await save.mutateAsync({
        vineyardId,
        provider,
        controllerKey,
        controllerName,
        minimumVolumeLitres: litres,
        volumeComparison: comparison,
        excludeTestPrograms: excludeTest,
        timezone: browserTimezone(),
      });
      await validate.mutateAsync({
        batchId,
        thresholdLitres: litres,
        volumeComparison: comparison,
        excludeTestPrograms: excludeTest,
      });
      toast.success("Settings applied and events re-classified.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <div className="flex flex-col">
          <Label
            htmlFor="min-volume"
            className="flex h-6 items-center gap-1.5 leading-none"
          >
            Minimum water quantity (m³)
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="About the minimum water quantity" className="leading-none">
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Events below this quantity are excluded, which helps exclude controller tests and very
                short runs. The saved value for this vineyard, provider and controller is used; the
                provider default applies until you change it.
              </TooltipContent>
            </Tooltip>
          </Label>
          <Input
            id="min-volume"
            type="number"
            step="0.1"
            min="0"
            className="mt-2 h-11 rounded-md"
            value={cubic}
            onChange={(e) => setCubic(e.target.value)}
          />
          <p className="mt-1 min-h-[1rem] text-xs text-muted-foreground" />
        </div>
        <div className="flex flex-col">
          <Label htmlFor="volume-comparison" className="flex h-6 items-center gap-1.5 leading-none">
            Comparison
          </Label>
          <Select value={comparison} onValueChange={(v) => setComparison(v as VolumeComparison)}>
            <SelectTrigger id="volume-comparison" className="mt-2 h-11 rounded-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="greater_than">More than</SelectItem>
              <SelectItem value="greater_than_or_equal">At least</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 min-h-[1rem] text-xs text-muted-foreground" />
        </div>
      </div>


      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={excludeTest} onCheckedChange={(v) => setExcludeTest(v === true)} />
        <span className="flex items-center gap-1.5">
          Exclude Test programs
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label="About Test program exclusion">
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Controller programs named as tests are excluded by default. Individual events can still be
              included one by one from the review step.
            </TooltipContent>
          </Tooltip>
        </span>
      </label>

      <p className="text-xs text-muted-foreground">
        Rule: {COMPARISON_LABEL[comparison]} {litresToCubicLabel(litres)} · Test programs{" "}
        {excludeTest ? "excluded" : "included"}. Changing these settings affects future previews only —
        committed sessions never change.
      </p>

      <div className="flex justify-end">
        <Button onClick={() => void submit()} disabled={save.isPending || validate.isPending}>
          {(save.isPending || validate.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Apply and continue
        </Button>
      </div>
    </div>
  );
}

function PreviewPanel({
  preview,
  providerLabel,
  controllerName,
  unmappedValves,
}: {
  preview: ImportPreview | null;
  providerLabel: string;
  controllerName: string | null;
  unmappedValves: number;
}) {
  if (!preview) return <p className="text-sm text-muted-foreground">Loading preview…</p>;
  const matched = (preview.distinct_valves ?? 0) - unmappedValves;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Preview</CardTitle>
        <CardDescription>
          Import source: {providerLabel} · Controller: {controllerName ?? "—"} · Minimum water quantity:{" "}
          {COMPARISON_LABEL[preview.volume_comparison]} {litresToCubicLabel(preview.threshold_litres)} ·
          Test programs: {preview.exclude_test_programs ? "excluded" : "included"} · Duplicate handling:
          previously processed events are skipped · Valve mappings: {matched} matched /{" "}
          {unmappedValves} requiring review
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Source rows" value={preview.total_source_rows} />
        <Stat label="Selected for import" value={preview.selected_for_import} highlight />
        <Stat label="Eligible completed" value={preview.eligible_completed} />
        <Stat label="Already imported" value={preview.already_imported} />
        <Stat label="Below threshold" value={preview.below_threshold} />
        <Stat label="At threshold" value={preview.at_threshold} />
        <Stat label="Test programs" value={preview.test_program} />
        <Stat label="Cancelled" value={preview.cancelled} />
        <Stat label="Controller errors" value={preview.controller_errors} />
        <Stat label="Zero activity" value={preview.zero_activity} />
        <Stat label="Needs review" value={preview.needs_review} />
        <Stat label="Parse errors" value={preview.parse_errors} />
        <Stat label="Exact duplicates" value={preview.exact_duplicates} />
        <Stat label="Changed duplicates" value={preview.possible_changed_duplicates} />
        <Stat label="Unmapped valves" value={preview.unmapped_valves} />
        <Stat label="Distinct valves" value={preview.distinct_valves} />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-sidebar-primary bg-sidebar-accent" : "border-border"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value ?? 0}</p>
    </div>
  );
}
