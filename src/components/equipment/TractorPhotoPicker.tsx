import { useEffect, useRef, useState } from "react";
import { ImagePlus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { matchTractorReferencePhoto, type TractorPhotoIdentity, type TractorReferencePhoto } from "@/lib/tractorReferencePhotos";
import { TRACTOR_REFERENCE_PHOTOS } from "./TractorReferencePhoto";

/** Preview only until a separate authorised photo persistence contract exists. */
export default function TractorPhotoPicker({ tractor, catalogue = TRACTOR_REFERENCE_PHOTOS }: {
  tractor: TractorPhotoIdentity;
  catalogue?: readonly TractorReferencePhoto[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ url: string; name: string } | null>(null);
  const [selected, setSelected] = useState<TractorReferencePhoto | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identity = JSON.stringify(tractor);
  useEffect(() => {
    setSelected(null);
    setShowResults(false);
  }, [identity]);
  useEffect(() => () => { if (upload) URL.revokeObjectURL(upload.url); }, [upload]);

  const complete = Boolean(tractor.brand?.trim() && tractor.model?.trim() && Number.isInteger(tractor.model_year));
  const candidates = catalogue.filter((photo) => matchTractorReferencePhoto(tractor, [photo]));
  const query = [tractor.brand, tractor.model, tractor.model_year, "tractor no attachments"].filter(Boolean).join(" ");
  const searchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
  const preview = upload?.url ?? selected?.url;

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
      setSelected(null);
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
      <Button type="button" variant="outline" size="sm" disabled={!complete} onClick={() => setShowResults(true)}>
        <Search className="h-4 w-4" /> Search tractor images
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
        <ImagePlus className="h-4 w-4" /> Upload image
      </Button>
      <Input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload tractor image" className="sr-only" onChange={(event) => {
        void chooseFile(event.target.files?.[0]);
        event.target.value = "";
      }} />
    </div>
    {!complete && <p className="text-xs text-muted-foreground">Brand, model and year are needed for image search.</p>}
    {showResults && <div className="space-y-2">
      {candidates.length === 0 ? <p className="text-sm text-muted-foreground">No verified matching photos available.</p> :
        <div className="grid grid-cols-2 gap-2">
          {candidates.map((photo) => <div key={photo.url} className="space-y-1">
            <Button type="button" variant="outline" className="h-24 w-full p-2" aria-label={`Preview ${photo.label}`} onClick={() => { setSelected(photo); setUpload(null); }}>
              <img src={photo.url} alt={photo.label} className="h-full w-full object-contain" />
            </Button>
            <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline">{photo.attribution}</a>
          </div>)}
        </div>}
      <Button type="button" variant="outline" size="sm" asChild><a href={searchUrl} target="_blank" rel="noopener noreferrer"><Search className="h-4 w-4" /> Search Google Images</a></Button>
    </div>}
    {preview && <div className="space-y-2">
      <div className="flex items-start gap-2">
        <img src={preview} alt="Tractor photo preview" className="h-28 min-w-0 flex-1 object-contain" />
        <Button type="button" variant="ghost" size="icon" aria-label="Remove photo preview" onClick={() => { setUpload(null); setSelected(null); }}><X className="h-4 w-4" /></Button>
      </div>
      {upload && <p className="break-all text-xs text-muted-foreground">{upload.name}</p>}
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">Preview only — photos are not saved with tractor changes yet. Paid search and background removal are unavailable until the A$20 monthly safeguard is connected.</p>
  </section>;
}