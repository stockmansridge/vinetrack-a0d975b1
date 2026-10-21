import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchTractorPhotoUrl, removeTractorPhoto, saveTractorPhoto, tractorPhotoQueryKey, validateTractorPhoto } from "@/lib/tractorPhotos";

/** Uploads straight to the saved tractor. New tractors must be created first. */
export default function TractorPhotoPicker({ tractorId, vineyardId }: { tractorId?: string | null; vineyardId?: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !!tractorId && !!vineyardId;
  const { data: url } = useQuery({
    queryKey: tractorPhotoQueryKey(tractorId ?? "none"),
    queryFn: () => fetchTractorPhotoUrl(tractorId!),
    enabled: ready,
    retry: false,
  });

  async function chooseFile(file?: File) {
    setError(null);
    if (!file || !ready) return;
    const invalid = validateTractorPhoto(file);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      await saveTractorPhoto(vineyardId!, tractorId!, file);
      await qc.invalidateQueries({ queryKey: tractorPhotoQueryKey(tractorId!) });
      toast.success("Photo saved");
    } catch (e) {
      setError(`Photo not saved: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!ready) return;
    setBusy(true);
    try {
      await removeTractorPhoto(tractorId!);
      await qc.invalidateQueries({ queryKey: tractorPhotoQueryKey(tractorId!) });
      toast.success("Photo removed");
    } catch (e) { setError(`Photo not removed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  return <section className="space-y-3 border-t border-border pt-3" aria-label="Tractor photo">
    <Label>Tractor photo</Label>
    {!ready ? <p className="text-xs text-muted-foreground">Create the tractor first, then edit it to add a photo.</p> : <>
      {url && <div className="flex items-start gap-2">
        <img src={url} alt="Tractor photo" className="h-28 min-w-0 flex-1 object-contain" />
        <Button type="button" variant="ghost" size="icon" aria-label="Remove photo" disabled={busy} onClick={() => void remove()}><Trash2 className="h-4 w-4" /></Button>
      </div>}
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} {url ? "Replace image" : "Upload image"}
      </Button>
      <Input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload tractor image" className="sr-only" onChange={(event) => {
        void chooseFile(event.target.files?.[0]);
        event.target.value = "";
      }} />
      <p className="text-xs text-muted-foreground">Saves immediately. PNG, JPG or WebP up to 5 MB.</p>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
