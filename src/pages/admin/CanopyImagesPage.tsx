// System Admin → Spray Calculator → Canopy Reference Images.
//
// Eight stable slots, one per canopy type × size combination. Uploading or
// resetting an image changes ONLY the illustration shown in the Spray
// Calculator: canopy type, canopy size, canopy density, the AWRI dilute
// L/100 m table, the L/ha conversion and the concentration factor are entirely
// unaffected.
import { useRef, useState } from "react";
import { ImageIcon, RotateCcw, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AdminError, AdminGate, AdminPageHeader } from "./_shared";
import { CANOPY_IMAGE_SLOTS, resolveCanopyImage, type CanopyImageKey } from "@/lib/canopyImages";
import {
  canopyImagePublicUrl,
  useCanopyImages,
  useResetCanopyImage,
  useUploadCanopyImage,
} from "@/lib/canopyImageStore";

export default function CanopyImagesPage() {
  const { data: map, isLoading, error } = useCanopyImages();
  const upload = useUploadCanopyImage();
  const reset = useResetCanopyImage();
  const { toast } = useToast();
  const [busy, setBusy] = useState<CanopyImageKey | null>(null);

  const onUpload = async (key: CanopyImageKey, file: File) => {
    setBusy(key);
    try {
      await upload.mutateAsync({ key, file });
      toast({ title: "Canopy image updated" });
    } catch (e) {
      toast({
        title: "Upload failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const onReset = async (key: CanopyImageKey) => {
    setBusy(key);
    try {
      await reset.mutateAsync(key);
      toast({ title: "Reset to bundled default" });
    } catch (e) {
      toast({
        title: "Reset failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminGate>
      <div className="p-4 sm:p-6">
        <AdminPageHeader
          title="Canopy Reference Images"
          subtitle="Spray Calculator — the eight canopy illustrations shown in Canopy & Spray Volume."
        />
        <Card className="mb-4 p-4 text-sm text-muted-foreground">
          These images are explanatory only. Replacing one never changes the canopy water rate,
          the recommended L/100 m, the equivalent L/ha, the concentration factor or any spray
          calculation. Bundled defaults are always kept — a removed custom image falls straight
          back to the default.
        </Card>
        <AdminError error={error} />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {CANOPY_IMAGE_SLOTS.map((slot) => {
            const custom = canopyImagePublicUrl(map?.[slot.key]);
            const resolved = resolveCanopyImage(slot.key, custom);
            return (
              <SlotCard
                key={slot.key}
                slotKey={slot.key}
                label={slot.label}
                description={slot.description}
                url={resolved.url}
                defaultUrl={slot.defaultUrl}
                source={resolved.source === "custom" ? "Custom" : "Default"}
                busy={busy === slot.key || isLoading}
                onUpload={(f) => onUpload(slot.key, f)}
                onReset={() => onReset(slot.key)}
              />
            );
          })}
        </div>
      </div>
    </AdminGate>
  );
}

function SlotCard({
  slotKey,
  label,
  description,
  url,
  defaultUrl,
  source,
  busy,
  onUpload,
  onReset,
}: {
  slotKey: string;
  label: string;
  description: string;
  url: string | null;
  defaultUrl: string;
  source: "Custom" | "Default";
  busy: boolean;
  onUpload: (file: File) => void;
  onReset: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [broken, setBroken] = useState(false);

  return (
    <Card className="space-y-3 p-3" data-testid={`canopy-slot-${slotKey}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{label}</div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Badge variant={source === "Custom" ? "secondary" : "outline"}>{source}</Badge>
      </div>

      <div className="flex aspect-square items-center justify-center overflow-hidden rounded border bg-muted/20">
        {url ? (
          <img
            src={broken ? defaultUrl : url}
            alt={`${label} canopy reference`}
            onError={() => setBroken(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          <ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="text-[11px] text-muted-foreground">{slotKey}</div>

      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={`Upload image for ${label}`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload className="mr-1 h-3.5 w-3.5" />
          {source === "Custom" ? "Replace" : "Upload"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || source !== "Custom"} onClick={onReset}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset to default
        </Button>
      </div>
    </Card>
  );
}
