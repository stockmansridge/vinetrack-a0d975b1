// ============= Full file contents =============

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Preview only until a separate authorised photo persistence contract exists. */
export default function TractorPhotoPicker() {
  const input = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (upload) URL.revokeObjectURL(upload.url); }, [upload]);

  async function chooseFile(file?: File) {
    setError(null);
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPG or WebP image.");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setUpload({ url, name: file.name });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError("This file could not be opened as an image.");
    };
    image.src = url;
  }

  return <section className="space-y-3 border-t border-border pt-3" aria-label="Tractor photo">
    <Label>Tractor photo</Label>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
        <ImagePlus className="h-4 w-4" /> Upload image
      </Button>
      <Input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload tractor image" className="sr-only" onChange={(event) => {
        void chooseFile(event.target.files?.[0]);
        event.target.value = "";
      }} />
    </div>
    {upload && <div className="space-y-2">
      <div className="flex items-start gap-2">
        <img src={upload.url} alt="Tractor photo preview" className="h-28 min-w-0 flex-1 object-contain" />
        <Button type="button" variant="ghost" size="icon" aria-label="Remove photo preview" onClick={() => setUpload(null)}><X className="h-4 w-4" /></Button>
      </div>
      <p className="break-all text-xs text-muted-foreground">{upload.name}</p>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">Preview only — photos are not saved with tractor changes yet.</p>
  </section>;
}
