import { useRef, useState } from "react";
import { ChevronDown, Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AdminGate, AdminPageHeader } from "./_shared";
import { GuideImageCoverage } from "@/components/guide/GuideImageCoverage";

import {
  focusToObjectPosition,
  guideImageGroups,
  validateGuideImageFile,
  type GuideImageFocus,
  type GuideImageKey,
  type GuideImageSlot,
} from "@/lib/guide/guideImages";
import {
  guideImagePublicUrl,
  useGuideImages,
  useRemoveGuideImage,
  useSetGuideImageFocus,
  useUploadGuideImage,
} from "@/lib/guide/guideImageStore";

/**
 * System Admin → Guide Images.
 *
 * Runtime content management for every How VineTrack Works image slot.
 * One upload per stable key feeds BOTH the landing row and that area's
 * drill-down hero — admins never upload the same image twice. Stage 4A adds
 * per-step workflow screenshots, grouped under their guide area and collapsed
 * by default so the page stays manageable.
 *
 * Access is the existing authoritative System Admin gate (AdminGate +
 * useIsSystemAdmin). No separate role mechanism is introduced here.
 */
export default function GuideImagesPage() {
  const groups = guideImageGroups();
  return (
    <AdminGate>
      <div className="p-4 sm:p-6">
        <AdminPageHeader
          title="Guide Images"
          subtitle="Imagery used by How VineTrack Works — landing page, area guides and workflow screenshots."
        />
        <div className="space-y-6">
          <GuideImageCoverage />

          {groups.map((group) => (
            <section key={group.group} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {group.groupLabel}
              </h2>
              {group.primary.map((slot) => (
                <SlotRow key={slot.key} slot={slot} />
              ))}
              {group.workflow.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm">
                      <ChevronDown className="mr-1.5 h-4 w-4" />
                      {group.secondaryLabel} ({group.workflow.length})
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 pt-3">
                    {group.workflow.map((slot) => (
                      <SlotRow key={slot.key} slot={slot} />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}

            </section>
          ))}
        </div>
      </div>
    </AdminGate>
  );
}


function SlotRow({ slot }: { slot: GuideImageSlot }) {
  const { toast } = useToast();
  const { data } = useGuideImages();
  const asset = data?.[slot.key as GuideImageKey];
  const url = guideImagePublicUrl(asset);
  const focus: GuideImageFocus = asset?.focus ?? slot.defaultFocus;

  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [broken, setBroken] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const upload = useUploadGuideImage();
  const setFocus = useSetGuideImageFocus();
  const remove = useRemoveGuideImage();

  const busy = upload.isPending || setFocus.isPending || remove.isPending;

  async function onPick(file: File | undefined) {
    if (!file) return;
    const problem = validateGuideImageFile(file);
    if (problem) {
      toast({ title: "Image not accepted", description: problem, variant: "destructive" });
      return;
    }
    try {
      setBroken(false);
      await upload.mutateAsync({ key: slot.key, file, focus });
      toast({ title: "Image updated", description: `${slot.label} now uses the new image.` });
    } catch (e) {
      toast({
        title: "Upload failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  return (
    <Card className="p-4">
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div
          role="button"
          tabIndex={0}
          aria-label={`${slot.label}: drop an image here or press Enter to choose a file`}
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
            if (busy) return;
            // One image per slot — only the first dropped file is used.
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
              alt={`${slot.label} guide image`}
              style={{ objectPosition: focusToObjectPosition(focus) }}
              onError={() => setBroken(true)}
              className={slot.kind === "screenshot" ? "h-full w-full object-contain p-1" : "h-full w-full object-cover"}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
              <ImageIcon className="h-6 w-6 opacity-60" aria-hidden />
              <span className="text-xs">No custom image — placeholder in use</span>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{slot.label}</h3>
            <Badge variant="secondary" className="font-mono text-[11px]">
              {slot.key}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{slot.usage}</p>
          <p className="text-xs text-muted-foreground">
            Recommended: {slot.guidance} Minimum recommended width {slot.minWidth}px. JPEG, PNG
            or WebP, up to 10 MB.{" "}
            {slot.kind === "screenshot"
              ? "Screenshots are shown whole (contain) — nothing is cropped away."
              : "Photos crop with object-fit: cover — they are never stretched."}
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
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
            <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              {upload.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-4 w-4" />
              )}
              {url ? "Replace image" : "Upload image"}
            </Button>

            {url && (
              <>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">Focus</span>
                  {(["left", "center", "right"] as GuideImageFocus[]).map((f) => (
                    <Button
                      key={f}
                      size="sm"
                      variant={focus === f ? "default" : "outline"}
                      disabled={busy}
                      onClick={() =>
                        setFocus
                          .mutateAsync({ key: slot.key, focus: f })
                          .catch((e) =>
                            toast({
                              title: "Could not save focus",
                              description: e instanceof Error ? e.message : String(e),
                              variant: "destructive",
                            }),
                          )
                      }
                    >
                      {f === "center" ? "Centre" : f === "left" ? "Left" : "Right"}
                    </Button>
                  ))}
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Remove
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this image?</AlertDialogTitle>
            <AlertDialogDescription>
              {slot.label} will revert to the default placeholder across How VineTrack Works.
              Only this slot's stored image is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                remove
                  .mutateAsync(slot.key)
                  .then(() => toast({ title: "Image removed" }))
                  .catch((e) =>
                    toast({
                      title: "Could not remove image",
                      description: e instanceof Error ? e.message : String(e),
                      variant: "destructive",
                    }),
                  )
              }
            >
              Remove image
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
