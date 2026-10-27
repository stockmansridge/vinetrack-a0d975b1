// Upload a laboratory report: intentionally minimal. The user picks the
// file and vineyard only — the deployed soil-analysis-extract parser reads
// the report and fills sample date, laboratory, depths and measurements,
// which the user then confirms on the Review Results screen. If the parser
// cannot start, the upload is preserved and shown as "Extraction failed" —
// evidence is never deleted.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import {
  uploadSoilSample,
  validateSoilUpload,
  SOIL_UPLOAD_ACCEPT,
  type SoilSample,
} from "@/lib/soilAnalysis";

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
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [vineyardId, setVineyardId] = useState<string>(selectedVineyardId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveVineyard = vineyardId || selectedVineyardId || "";

  const submit = async () => {
    setError(null);
    if (!file) return setError("Choose a laboratory report file.");
    const invalid = validateSoilUpload(file);
    if (invalid) return setError(invalid);
    if (!effectiveVineyard) return setError("Choose a vineyard before uploading.");
    setBusy(true);
    try {
      const outcome = await uploadSoilSample({
        file,
        vineyardId: effectiveVineyard,
        uploadedBy: user?.id ?? null,
      });
      qc.invalidateQueries({ queryKey: ["soil-analysis"] });
      if (!outcome.extractionStarted) {
        // Records are preserved; the sample list shows "Extraction failed".
        setError(
          `The report was uploaded and kept, but extraction could not start: ${outcome.extractionError}. The sample is marked "Extraction failed" — you can retry from the sample page.`,
        );
        return;
      }
      onUploaded(outcome.sample);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload soil analysis report</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <Label htmlFor="soil-file">Report file (PDF, JPG, PNG or WebP, up to 15 MB)</Label>
            <Input
              id="soil-file"
              ref={fileRef}
              type="file"
              accept={SOIL_UPLOAD_ACCEPT.join(",")}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              VineTrack will read the report and ask you to confirm the extracted details before
              they are saved as confirmed data. The original file is kept as evidence and is never
              replaced.
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

          <div className="flex justify-start gap-2 pt-1">
            <Button onClick={submit} disabled={busy}>
              {busy ? "Uploading & reading…" : "Upload & read report"}
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
