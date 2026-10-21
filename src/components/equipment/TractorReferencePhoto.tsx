import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { matchTractorReferencePhoto, type TractorPhotoIdentity, type TractorReferencePhoto } from "@/lib/tractorReferencePhotos";

// The previous Fendt source includes a rear implement and is not eligible.
export const TRACTOR_REFERENCE_PHOTOS: readonly TractorReferencePhoto[] = [];

export default function TractorReferencePhoto({ tractor, catalogue = TRACTOR_REFERENCE_PHOTOS }: { tractor: TractorPhotoIdentity; catalogue?: readonly TractorReferencePhoto[] }) {
  const photo = matchTractorReferencePhoto(tractor, catalogue);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (!photo || failedUrl === photo.url) {
    return <div className="h-16 w-24" aria-hidden="true" />;
  }
  return (
    <div onClick={(event) => event.stopPropagation()}>
      <Button variant="ghost" className="h-16 w-24 overflow-hidden rounded border border-border p-0" onClick={() => setOpen(true)} aria-label={`View ${photo.label} reference photo`} title={`${photo.label} — reference photo, not your tractor`}>
        <img src={photo.url} alt={`${photo.label} reference`} className="h-full w-full object-contain" loading="lazy" onError={() => setFailedUrl(photo.url)} />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{photo.label} — reference photo</DialogTitle></DialogHeader>
          <img src={photo.url} alt={photo.label} className="aspect-[3/2] w-full object-contain" />
          <p className="text-sm text-muted-foreground">Model reference only; equipment and fittings may differ from your tractor.</p>
          <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline">{photo.attribution}</a>
        </DialogContent>
      </Dialog>
    </div>
  );
}