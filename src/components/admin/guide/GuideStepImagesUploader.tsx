import { useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { validateGuideImageFile } from "@/lib/guide/guideImages";
import { guideStepImageUrl, useUploadGuideStepImage } from "@/lib/guide/guideContentStore";
import { MAX_STEP_IMAGES, type GuideStepImage } from "@/lib/guide/guideContent";

/**
 * Per-row screenshot management for up to MAX_STEP_IMAGES images.
 *
 * Files go into the existing guide-images bucket via the shared uploader —
 * removing an image only clears the reference from this row, never the file
 * or any other slot.
 */
export function GuideStepImagesUploader({
  sectionKey,
  stepId,
  images,
  fallbackUrl,
  onChange,
}: {
  sectionKey: string;
  stepId: string;
  images: GuideStepImage[];
  /** Built-in Guide Images slot preview when the row has no upload. */
  fallbackUrl?: string;
  onChange: (next: GuideStepImage[]) => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const upload = useUploadGuideStepImage();
  const busy = upload.isPending;
  const full = images.length >= MAX_STEP_IMAGES;

  async function onPick(files: FileList | File[] | null | undefined) {
    const list = Array.from(files ?? []);
    if (list.length === 0 || busy) return;
    const room = MAX_STEP_IMAGES - images.length;
    if (room <= 0) {
      toast({
        title: "Image limit reached",
        description: `A step can show up to ${MAX_STEP_IMAGES} images.`,
        variant: "destructive",
      });
      return;
    }
    const accepted: File[] = [];
    for (const file of list.slice(0, room)) {
      const problem = validateGuideImageFile(file);
      if (problem) {
        toast({ title: "Image not accepted", description: problem, variant: "destructive" });
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;
    try {
      const uploaded: GuideStepImage[] = [];
      for (const file of accepted) {
        uploaded.push(await upload.mutateAsync({ sectionKey, stepId, file }));
      }
      onChange([...images, ...uploaded].slice(0, MAX_STEP_IMAGES));
      toast({
        title: uploaded.length === 1 ? "Screenshot uploaded" : "Screenshots uploaded",
        description: "Save the section to publish.",
      });
    } catch (e) {
      toast({
        title: "Upload failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= images.length) return;
    const next = [...images];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop screenshots here or press Enter to choose files"
        onClick={() => !busy && !full && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy && !full) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy && !full) setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          void onPick(e.dataTransfer.files);
        }}
        className={cn(
          "relative min-h-[110px] w-full overflow-hidden rounded-lg border bg-muted/30 p-2 transition-colors",
          dragOver ? "border-2 border-dashed border-primary bg-primary/10" : "border-border",
          busy ? "cursor-progress opacity-90" : full ? "cursor-default" : "cursor-pointer",
        )}
      >
        {images.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {images.map((img, i) => (
              <figure key={img.path} className="relative overflow-hidden rounded-md border border-border bg-background">
                <img
                  src={guideStepImageUrl(img)}
                  alt={`Step screenshot ${i + 1}`}
                  className="h-[92px] w-full object-contain p-1"
                />
                <figcaption className="flex items-center justify-between gap-1 border-t border-border px-1 py-0.5">
                  <span className="text-[10.5px] font-medium text-muted-foreground">#{i + 1}</span>
                  <span className="flex items-center">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      aria-label={`Move image ${i + 1} earlier`}
                      disabled={i === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        move(i, i - 1);
                      }}
                    >
                      ←
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      aria-label={`Move image ${i + 1} later`}
                      disabled={i === images.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        move(i, i + 1);
                      }}
                    >
                      →
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      aria-label={`Remove image ${i + 1}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange(images.filter((_, j) => j !== i));
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : fallbackUrl ? (
          <img src={fallbackUrl} alt="Step screenshot" className="h-[130px] w-full object-contain" />
        ) : (
          <div className="flex h-[110px] w-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageIcon className="h-6 w-6 opacity-60" aria-hidden />
            <span className="text-xs">Drop screenshots here or choose files</span>
          </div>
        )}

        {busy && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-xs font-medium">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Uploading…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            void onPick(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || full}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-1.5 h-4 w-4" />
          {images.length > 0 ? "Add image" : "Upload image"}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {images.length}/{MAX_STEP_IMAGES} images
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        JPEG, PNG or WebP, up to 10 MB each. Up to {MAX_STEP_IMAGES} per step. Screenshots are shown
        whole — nothing is cropped.
      </p>
    </div>
  );
}
