// Upload laboratory reports: intentionally minimal. The user drops or picks
// one or more files and the vineyard only — the deployed soil-analysis-extract
// parser reads each report and fills sample date, laboratory, depths and
// measurements, which the user then confirms on the Review Results screen. If
// the parser cannot start, the upload is preserved and shown as "Extraction
// failed" — evidence is never deleted.
import { useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import { useToast } from "@/hooks/use-toast";
import {
  uploadSoilSample,
  validateSoilUpload,
  SOIL_UPLOAD_ACCEPT,
  type SoilSample,
} from "@/lib/soilAnalysis";
import { ExtractionErrorNotice } from "./ExtractionErrorNotice";

interface FileResult {
  name: string;
  ok: boolean;
  message: string | null;
}

export function UploadSampleDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (sample: SoilSample) => void;
}) {
  const { user } = useAuth();
  const { memberships, selectedVineyardId } = useVineyard();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [vineyardId, setVineyardId] = useState<string>(selectedVineyardId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FileResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const effectiveVineyard = vineyardId || selectedVineyardId || "";

  const addFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const next = Array.from(incoming);
    if (next.length === 0) return;
    setError(null);
    setFailures([]);
    // De-duplicate against already-chosen files by name + size.
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...next.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  };

  const removeFile = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index));

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    addFiles(event.dataTransfer.files);
  };

  const submit = async () => {
    setError(null);
    setFailures([]);
    if (files.length === 0) return setError("Choose at least one laboratory report file.");
    for (const file of files) {
      const invalid = validateSoilUpload(file);
      if (invalid) return setError(`${file.name}: ${invalid}`);
    }
    if (!effectiveVineyard) return setError("Choose a vineyard before uploading.");
    setBusy(true);
    const succeeded: SoilSample[] = [];
    const failed: FileFailure[] = [];
    try {
      for (const file of files) {
        try {
          const outcome = await uploadSoilSample({
            file,
            vineyardId: effectiveVineyard,
            uploadedBy: user?.id ?? null,
          });
          if (!outcome.extractionStarted) {
            // Records are preserved; shown via the concise failure notice.
            failed.push({ name: file.name, message: outcome.extractionError });
          } else {
            succeeded.push(outcome.sample);
          }
        } catch (e) {
          failed.push({ name: file.name, message: e instanceof Error ? e.message : String(e) });
        }
      }
      qc.invalidateQueries({ queryKey: ["soil-analysis"] });

      if (succeeded.length === 1 && failed.length === 0) {
        // Single clean upload: go straight to Review Results as before.
        setFiles([]);
        onUploaded(succeeded[0]);
        onOpenChange(false);
        return;
      }
      if (succeeded.length > 0) {
        toast({
          title: `${succeeded.length} report${succeeded.length === 1 ? "" : "s"} uploaded`,
          description: "Open each one from the Samples list to review and confirm the results.",
        });
      }
      if (failed.length > 0) {
        setFailures(failed);
        // Keep the failed files listed so the user can see what happened.
        setFiles([]);
        if (succeeded.length === 0) return;
      }
      if (failed.length === 0) {
        setFiles([]);
        onOpenChange(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload soil analysis reports</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <Label id="soil-file-label">Report files (PDF, JPG, PNG or WebP, up to 15 MB each)</Label>
            <div
              role="button"
              tabIndex={0}
              aria-labelledby="soil-file-label"
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-input hover:border-primary/60 hover:bg-muted/40"
              }`}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <FileUp className="h-6 w-6 text-muted-foreground" />
              <span className="font-medium">Drop reports here, or click to choose files</span>
              <span className="text-xs text-muted-foreground">You can add several reports at once</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={SOIL_UPLOAD_ACCEPT.join(",")}
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {files.length > 0 && (
              <ul className="space-y-1 pt-1">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}:${file.size}:${index}`}
                    className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs"
                  >
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => removeFile(index)}
                      disabled={busy}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              VineTrack will read the report and ask you to confirm the extracted details before
              they are saved as confirmed data. The original files are kept as evidence and are
              never replaced.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="soil-vineyard">Vineyard</Label>
            <select
              id="soil-vineyard"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={effectiveVineyard}
              onChange={(e) => setVineyardId(e.target.value)}
            >
              <option value="">Choose a vineyard…</option>
              {memberships.map((m) => (
                <option key={m.vineyard_id} value={m.vineyard_id}>
                  {m.vineyard_name ?? m.vineyard_id}
                </option>
              ))}
            </select>
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}
          {failures.map((f) => (
            <div key={f.name} className="space-y-1">
              <div className="text-xs font-medium">{f.name}</div>
              <ExtractionErrorNotice raw={f.message} />
            </div>
          ))}

          <div className="flex justify-start gap-2 pt-1">
            <Button onClick={submit} disabled={busy}>
              {busy
                ? "Uploading & reading…"
                : files.length > 1
                  ? `Upload & read ${files.length} reports`
                  : "Upload & read report"}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
