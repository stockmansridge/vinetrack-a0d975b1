import { useState } from "react";
import { ImageOff } from "lucide-react";
import fendtAsset from "@/assets/tractors/fendt-211v.jpg.asset.json";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { matchTractorReferencePhoto, type TractorPhotoIdentity, type TractorReferencePhoto } from "@/lib/tractorReferencePhotos";

export const TRACTOR_REFERENCE_PHOTOS: readonly TractorReferencePhoto[] = [{
  brands: ["Fendt"], models: ["211V", "211 V", "211 V Vario", "211V Vario"],
  // Original generation: https://www.tractordata.com/farm-tractors/010/8/5/10858-fendt-211v.html
  firstYear: 2010, lastYear: 2016,
  url: fendtAsset.url,
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Fendt_211_V_Vario,_Nidderdonwen-102.jpg",
  attribution: "Jwh · CC BY-SA 3.0 LU · Wikimedia Commons",
  label: "Fendt 211 V Vario",
}];

export default function TractorReferencePhoto({ tractor }: { tractor: TractorPhotoIdentity }) {
  const photo = matchTractorReferencePhoto(tractor, TRACTOR_REFERENCE_PHOTOS);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const missingIdentity = !tractor.brand?.trim() || !tractor.model?.trim() || tractor.model_year == null;
  if (!photo || failedUrl === photo.url) {
    const reason = missingIdentity ? "Brand, model and year needed" : "No verified reference photo available";
    return (
      <div className="flex h-16 w-24 items-center justify-center rounded border border-border bg-muted text-muted-foreground" title={reason} role="img" aria-label={reason}>
        <ImageOff className="h-5 w-5" aria-hidden="true" />
      </div>
    );
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