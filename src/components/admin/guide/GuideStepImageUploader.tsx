import { useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { validateGuideImageFile } from "@/lib/guide/guideImages";
import { guideStepImageUrl, useUploadGuideStepImage } from "@/lib/guide/guideContentStore";
import type { GuideStepImage } from "@/lib/guide/guideContent";

/**
 * Per-row screenshot management. Drag-and-drop, upload, replace, remove.
 * Files go into the existing guide-images bucket via the shared uploader —
 * removing a row's image only clears the reference, never other slots.
 */
export function GuideStepImageUploader({
  sectionKey,
  stepId,
  image,
  fallbackUrl,
  onChange,
}: {
  sectionKey: string;
  stepId: string;
  image?: GuideStepImage;
  /** Built-in Guide Images slot preview when the row has no upload. */
  fallbackUrl?: string;
  onChange: (next: GuideStepImage | undefined) => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [broken, setBroken] = useState(false);
  const upload = useUploadGuideStepImage();

  const url = (image ? guideStepImageUrl(image) : undefined) ?? fallbackUrl;
  const busy = upload.isPending;

  async function onPick(file: File | undefined) {
    if (!file || busy) return;
    const problem = validateGuideImageFile(file);
    if (problem) {
      toast({ title: "Image not accepted", description: problem, variant: "destructive" });
      return;
    }
    try {
      setBroken(false);
      const next = await upload.mutateAsync({ sectionKey, stepId, file });
      onChange(next);
      toast({ title: "Screenshot uploaded", description: "Save the section to publish it." });
    } catch (e) {
      toast({
        title: "Upload failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a screenshot here or press Enter to choose a file"
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) setDragOver(true);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) setDragOver(true);
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
          void onPick(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "relative h-[150px] w-full cursor-pointer overflow-hidden rounded-lg border bg-muted/30 transition-colors",
          dragOver ? "border-2 border-dashed border-primary bg-primary/10" : "border-border",
          busy && "cursor-progress opacity-90",
        )}
      >
        {url && !broken ? (
          <img
            src={url}
            alt="Step screenshot"
            onError={() => setBroken(true)}
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageIcon className="h-6 w-6 opacity-60" aria-hidden />
            <span className="text-xs">Drop screenshot here or choose file</span>
          </div>
        )}

        {dragOver && !busy && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/15 text-xs font-semibold text-primary">
            Drop image to upload
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
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            void onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload className="mr-1.5 h-4 w-4" />
          {url ? "Replace image" : "Upload image"}
        </Button>
        {image && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onChange(undefined)}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Remove image
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        JPEG, PNG or WebP, up to 10 MB. Screenshots are shown whole — nothing is cropped.
      </p>
    </div>
  );
}
