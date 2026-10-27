// Upload a laboratory report: creates the pending soil_samples row, stores
// the original document in the private bucket, records it, then invokes the
// deployed soil-analysis-extract parser. If the parser cannot start, the
// upload is preserved and shown as "Extraction failed" — evidence is never
// deleted.
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
  const [sampledAt, setSampledAt] = useState("");
  const [laboratory, setLaboratory] = useState("");
  const [labPaddockName, setLabPaddockName] = useState("");
  const [labSampleId, setLabSampleId] = useState("");
  const [depthFrom, setDepthFrom] = useState("");
  const [depthTo, setDepthTo] = useState("");
  const [notes, setNotes] = useState("");
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
        sampledAt: sampledAt || null,
        laboratory: laboratory || null,
        labPaddockName: labPaddockName || null,
        labSampleId: labSampleId || null,
        depthFromCm: depthFrom ? Number(depthFrom) : null,
        depthToCm: depthTo ? Number(depthTo) : null,
        notes: notes || null,
        uploadedBy: user?.id ?? null,
      });
      qc.invalidateQueries({ queryKey: ["soil-analysis"] });
      if (!outcome.extractionStarted) {
        // Records are preserved; the sample list shows "Extraction failed".
        setError(
          `The report was uploaded and kept, but automatic extraction could not start: ${outcome.extractionError}. The sample is marked "Extraction failed" — you can retry later.`,
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
      <DialogContent className="max-w-lg">
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
              The original file is kept as evidence and is never replaced. Results are extracted
              automatically and then held for your review.
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="soil-date">Sample date</Label>
              <Input id="soil-date" type="date" value={sampledAt} onChange={(e) => setSampledAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="soil-lab">Laboratory</Label>
              <Input id="soil-lab" value={laboratory} onChange={(e) => setLaboratory(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="soil-lab-paddock">Lab paddock name</Label>
              <Input
                id="soil-lab-paddock"
                value={labPaddockName}
                onChange={(e) => setLabPaddockName(e.target.value)}
                placeholder="As printed on the report"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="soil-lab-id">Lab sample ID</Label>
              <Input id="soil-lab-id" value={labSampleId} onChange={(e) => setLabSampleId(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="soil-depth-from">Depth from (cm)</Label>
              <Input id="soil-depth-from" type="number" value={depthFrom} onChange={(e) => setDepthFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="soil-depth-to">Depth to (cm)</Label>
              <Input id="soil-depth-to" type="number" value={depthTo} onChange={(e) => setDepthTo(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="soil-notes">Notes</Label>
            <Input id="soil-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}

          <div className="flex justify-start gap-2 pt-1">
            <Button onClick={submit} disabled={busy}>
              {busy ? "Uploading…" : "Upload report"}
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
